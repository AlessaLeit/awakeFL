"""Ponte entre a simulacao de FL e o livro-razao on-chain (Solana/Anchor).

Nesta etapa do projeto a blockchain e *simulada*: em vez de enviar transacoes,
guardamos os registros em memoria e exportamos para JSON. O que e real e o
formato dos registros e o calculo do hash - de modo que trocar
`SimulatedOnChainLedger` por um cliente Anchor de verdade nao mude nada no
resto do codigo.

O que vai para a cadeia (e por que):

* `weights_hash` - SHA-256 dos pesos submetidos. A cadeia NAO guarda os pesos
  (caros e privados); guarda o compromisso criptografico deles. Depois qualquer
  auditor recalcula o hash a partir do artefato off-chain e prova que aquele
  participante submeteu exatamente aquilo naquela rodada.
* `metrics` - metricas declaradas pelo participante (perda/acuracia local).
  Sao *declaradas*, ou seja, potencialmente mentira - e justamente por isso que a
  reputacao e calculada a partir do update, nao a partir do que o cliente diz.
* `score` e `reputation_bps` - resultado da avaliacao, em ponto fixo.
* `banned` - evento de banimento, irreversivel.

Determinismo do hash (contrato com o programa Anchor): serializamos os tensores
na ordem do `state_dict`, cada um convertido para float32 little-endian, com o
shape prefixado. Ver `hash_weights`.
"""

from __future__ import annotations

import hashlib
import json
import logging
import struct
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

import numpy as np

logger = logging.getLogger("awakefl.onchain")

# Program ID do AwakeFL publicado na Devnet (mantido em sincronia com o Anchor.toml
# do repositorio principal). Serve como documentacao aqui; a integracao real le
# esse valor do IDL.
DEVNET_PROGRAM_ID = "AwakeFLprogram11111111111111111111111111111"


# ---------------------------------------------------------------------------
# Hashing
# ---------------------------------------------------------------------------


def hash_weights(weights: Sequence[np.ndarray]) -> str:
    """SHA-256 canonico de um conjunto de pesos. Retorna hex de 64 caracteres.

    Regras de serializacao (precisam ser identicas do lado Rust para a
    verificacao on-chain funcionar):

    1. tensores na ordem do `state_dict` do modelo;
    2. para cada tensor: ndim (u32 LE) + cada dimensao (u32 LE) + bytes dos
       dados em float32 little-endian, em ordem C;
    3. hash acumulado sobre a concatenacao.

    Fixamos float32 mesmo internamente usando float64 porque e a precisao em que
    os pesos realmente trafegam - e evita que uma diferenca de ULP em float64
    (ordem de soma diferente entre maquinas) mude o hash.
    """
    digest = hashlib.sha256()
    for tensor in weights:
        arr = np.ascontiguousarray(np.asarray(tensor, dtype=np.float32))
        digest.update(struct.pack("<I", arr.ndim))
        for dim in arr.shape:
            digest.update(struct.pack("<I", int(dim)))
        digest.update(arr.tobytes(order="C"))
    return digest.hexdigest()


def hash_record(payload: Dict[str, Any]) -> str:
    """Hash de um registro (JSON com chaves ordenadas) - usado para encadear os blocos."""
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Registros
# ---------------------------------------------------------------------------


@dataclass
class ContributionRecord:
    """Uma submissao de contribuicao (equivale a instrucao `submit_contribution`)."""

    round_number: int
    participant_id: int
    weights_hash: str
    num_examples: int
    metrics: Dict[str, float] = field(default_factory=dict)
    score: Optional[float] = None
    reputation: Optional[float] = None
    reputation_bps: Optional[int] = None
    banned: bool = False
    tx_signature: str = ""  # preenchido pela integracao real; vazio na simulacao


@dataclass
class BanRecord:
    """Evento de banimento permanente (equivale a instrucao `ban_participant`)."""

    round_number: int
    participant_id: int
    reputation_bps: int
    reason: str = "reputation_below_threshold"


class SimulatedOnChainLedger:
    """Livro-razao em memoria com encadeamento por hash (mini-blockchain didatica).

    Cada registro guarda o hash do registro anterior, o que torna o historico
    a prova de adulteracao *dentro da simulacao* - da para demonstrar em banca
    que alterar uma metrica antiga quebra a cadeia inteira (`verify_chain`).
    """

    GENESIS = "0" * 64

    def __init__(self, program_id: str = DEVNET_PROGRAM_ID) -> None:
        self.program_id = program_id
        self.contributions: List[ContributionRecord] = []
        self.bans: List[BanRecord] = []
        self._chain: List[str] = []  # hash de cada bloco, em ordem

    # -- escrita -----------------------------------------------------------

    def register_contribution(
        self,
        round_number: int,
        participant_id: int,
        weights: Sequence[np.ndarray],
        num_examples: int,
        metrics: Optional[Dict[str, float]] = None,
        score: Optional[float] = None,
        reputation: Optional[float] = None,
        banned: bool = False,
    ) -> ContributionRecord:
        """Registra (participante, rodada, hash, metricas, score) no livro-razao."""
        from reputation import to_basis_points  # import local evita ciclo

        record = ContributionRecord(
            round_number=round_number,
            participant_id=participant_id,
            weights_hash=hash_weights(weights),
            num_examples=int(num_examples),
            metrics={k: float(v) for k, v in (metrics or {}).items()},
            score=None if score is None else round(float(score), 6),
            reputation=None if reputation is None else round(float(reputation), 6),
            reputation_bps=None if reputation is None else to_basis_points(reputation),
            banned=banned,
        )
        self.contributions.append(record)
        self._append_block(asdict(record))
        logger.debug(
            "on-chain <- rodada %d, participante %d, hash %s...",
            round_number,
            participant_id,
            record.weights_hash[:12],
        )
        return record

    def register_ban(self, round_number: int, participant_id: int, reputation: float) -> BanRecord:
        """Registra o banimento permanente de um participante."""
        from reputation import to_basis_points

        record = BanRecord(round_number, participant_id, to_basis_points(reputation))
        self.bans.append(record)
        self._append_block(asdict(record))
        logger.info(
            "on-chain <- BANIMENTO do participante %d na rodada %d", participant_id, round_number
        )
        return record

    def _append_block(self, payload: Dict[str, Any]) -> str:
        previous = self._chain[-1] if self._chain else self.GENESIS
        block_hash = hash_record({"prev": previous, "data": payload})
        self._chain.append(block_hash)
        return block_hash

    # -- leitura / auditoria ----------------------------------------------

    def verify_contribution(self, record: ContributionRecord, weights: Sequence[np.ndarray]) -> bool:
        """Confere se um conjunto de pesos off-chain corresponde ao hash registrado."""
        return hash_weights(weights) == record.weights_hash

    def verify_chain(self) -> bool:
        """Recalcula a cadeia inteira. `False` = algum registro foi adulterado."""
        previous = self.GENESIS
        blocks: List[Dict[str, Any]] = [asdict(c) for c in self.contributions]
        # Os blocos foram intercalados na ordem de escrita; reconstruimos na
        # mesma ordem juntando contribuicoes e bans pelo indice de insercao.
        ordered = self._ordered_payloads()
        if len(ordered) != len(self._chain):
            return False
        for payload, expected in zip(ordered, self._chain):
            previous = hash_record({"prev": previous, "data": payload})
            if previous != expected:
                return False
        del blocks
        return True

    def _ordered_payloads(self) -> List[Dict[str, Any]]:
        """Reconstroi a ordem cronologica de escrita (contribuicoes e bans por rodada)."""
        events: List[tuple] = []
        for i, c in enumerate(self.contributions):
            events.append((c.round_number, 0, i, asdict(c)))
        for i, b in enumerate(self.bans):
            events.append((b.round_number, 1, i, asdict(b)))
        events.sort(key=lambda e: (e[0], e[1], e[2]))
        return [e[3] for e in events]

    def export_json(self, path: str | Path) -> Path:
        """Exporta o livro-razao completo (o "explorer" offline do experimento)."""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "program_id": self.program_id,
            "num_blocks": len(self._chain),
            "chain_head": self._chain[-1] if self._chain else self.GENESIS,
            "contributions": [asdict(c) for c in self.contributions],
            "bans": [asdict(b) for b in self.bans],
        }
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        logger.info("Livro-razao simulado exportado para %s", path)
        return path


# ---------------------------------------------------------------------------
# Stubs da integracao real com o programa Anchor
# ---------------------------------------------------------------------------
#
# Quando a camada on-chain estiver pronta, estas funcoes passam a usar
# `solana-py` + `anchorpy`. A assinatura ja esta no formato final para que o
# `server.py` nao precise mudar - basta injetar um ledger real no lugar do
# `SimulatedOnChainLedger`.


def anchor_submit_contribution(
    participant_pubkey: str,
    round_number: int,
    weights_hash: str,
    metrics: Dict[str, float],
    program_id: str = DEVNET_PROGRAM_ID,
) -> str:
    """[STUB] Chama a instrucao `submit_contribution` do programa Anchor.

    Implementacao prevista::

        provider = anchorpy.Provider.local()               # ou Devnet + keypair
        program  = anchorpy.Program(idl, PublicKey(program_id), provider)
        pda, _   = PublicKey.find_program_address(
            [b"contribution", bytes(PublicKey(participant_pubkey)),
             round_number.to_bytes(8, "little")], program.program_id)
        await program.rpc["submit_contribution"](
            bytes.fromhex(weights_hash), int(metrics["accuracy"] * 10_000),
            ctx=Context(accounts={"contribution": pda, ...}))

    Returns:
        Assinatura da transacao (base58).
    """
    raise NotImplementedError(
        "Integracao Anchor ainda nao conectada. Use SimulatedOnChainLedger nesta etapa."
    )


def anchor_update_reputation(
    participant_pubkey: str,
    round_number: int,
    score_bps: int,
    program_id: str = DEVNET_PROGRAM_ID,
) -> str:
    """[STUB] Chama `update_reputation`, que recalcula R(t) = 0,5R(t-1) + 0,5S(t) on-chain.

    O calculo e refeito *dentro* do programa (nao confiamos no valor enviado pelo
    servidor): a instrucao recebe apenas `score_bps` e aplica a formula com
    aritmetica inteira sobre a conta PDA de reputacao do participante.
    """
    raise NotImplementedError("Integracao Anchor ainda nao conectada.")


def anchor_ban_participant(
    participant_pubkey: str, round_number: int, program_id: str = DEVNET_PROGRAM_ID
) -> str:
    """[STUB] Chama `ban_participant`: divide a reputacao por 10 e marca `banned = true`.

    A conta nao tem instrucao de reversao - o banimento e permanente por design.
    """
    raise NotImplementedError("Integracao Anchor ainda nao conectada.")


def anchor_fetch_reputation(
    participant_pubkey: str, program_id: str = DEVNET_PROGRAM_ID
) -> Dict[str, Any]:
    """[STUB] Le a conta de reputacao on-chain (`{reputation_bps, banned, last_round}`)."""
    raise NotImplementedError("Integracao Anchor ainda nao conectada.")
