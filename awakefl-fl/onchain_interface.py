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
from typing import Any, Dict, Iterator, List, Optional, Sequence

import numpy as np

logger = logging.getLogger("awakefl.onchain")

# Program ID do AwakeFL publicado na Devnet, identico ao `declare_id!` de
# programs/awakefl/src/lib.rs e ao Anchor.toml. A integracao real deve ler esse
# valor do IDL; aqui ele serve de default e de documentacao.
DEVNET_PROGRAM_ID = "GhMhTkv7jeHMejEyypQaEFPqduHgXDSzE5g7jE3rXGRA"

# --- Constantes espelhadas do programa (programs/awakefl/src/state.rs) ------
# Se qualquer uma destas mudar do lado Rust, muda aqui tambem: sao o contrato
# entre as duas camadas.
SEED_CONFIG = b"config"
SEED_PARTICIPANT = b"participant"
SEED_CONTRIBUTION = b"contribution"
MAX_HASH_LEN = 64          # SHA-256 em hexadecimal, do jeito que a conta guarda
PROGRAM_MAX_REPUTATION = 1_000
PENALTY_DIVISOR = 10

# `penalize_participant` recebe um `reason_code: u8`. O programa nao interpreta
# o codigo (so o emite no evento), mas fixamos a tabela aqui para que a trilha
# de auditoria seja legivel.
REASON_CODES: Dict[str, int] = {
    "reputation_below_threshold": 1,
    "manual_authority_action": 2,
}


# ---------------------------------------------------------------------------
# Hashing
# ---------------------------------------------------------------------------


# Extensao do artefato canonico. E este arquivo que a instituicao sobe no
# painel web para gerar o compromisso da rodada.
CANONICAL_EXT = ".awfl"


def canonical_chunks(weights: Sequence[np.ndarray]) -> Iterator[bytes]:
    """Gera o byte stream canonico de um conjunto de pesos, em pedacos.

    UNICA definicao do formato em todo o projeto - `hash_weights` e
    `export_weights` consomem daqui. Ter o formato escrito em dois lugares e
    exatamente como o hash do arquivo deixa de bater com o hash calculado em
    memoria, sem ninguem perceber ate a auditoria falhar.

    Formato (precisa ser identico do lado Rust para a verificacao on-chain):

    1. tensores na ordem do `state_dict` do modelo;
    2. para cada tensor: ndim (u32 LE) + cada dimensao (u32 LE) + os dados em
       float32 little-endian, em ordem C;
    3. concatenacao, sem cabecalho global e sem padding.

    Fixamos float32 mesmo quando internamente se usa float64 porque e a precisao
    em que os pesos realmente trafegam - e evita que uma diferenca de ULP em
    float64 (ordem de soma diferente entre maquinas) mude o hash.

    O formato e auto-descritivo: da para ler de volta so com os bytes, sem
    conhecer o modelo (ver `load_weights`).
    """
    for tensor in weights:
        arr = np.ascontiguousarray(np.asarray(tensor, dtype=np.float32))
        cabecalho = struct.pack("<I", arr.ndim)
        cabecalho += b"".join(struct.pack("<I", int(d)) for d in arr.shape)
        yield cabecalho
        yield arr.tobytes(order="C")


def hash_weights(weights: Sequence[np.ndarray]) -> str:
    """SHA-256 canonico de um conjunto de pesos. Retorna hex de 64 caracteres."""
    digest = hashlib.sha256()
    for chunk in canonical_chunks(weights):
        digest.update(chunk)
    return digest.hexdigest()


def export_weights(weights: Sequence[np.ndarray], path: str | Path) -> Path:
    """Grava os pesos no formato canonico e devolve o caminho.

    O ponto deste arquivo: `sha256(bytes_do_arquivo) == hash_weights(weights)`.
    A tela `/painel/contribuir` da web calcula SHA-256 do conteudo bruto do
    arquivo que a instituicao sobe (`sha256DeArquivo`); gravando o mesmo byte
    stream que hasheamos em memoria, os dois lados chegam ao mesmo compromisso
    sem precisar combinar mais nada.

    Sem isto a integracao nao fecha: qualquer outro formato (`torch.save`,
    `.npz`, pickle) carrega metadados, ordem de chaves ou compressao que mudam
    os bytes e, portanto, o hash.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as fh:
        for chunk in canonical_chunks(weights):
            fh.write(chunk)
    return path


def load_weights(path: str | Path) -> List[np.ndarray]:
    """Le de volta um artefato canonico. E o lado auditor da historia.

    Qualquer terceiro que tenha o arquivo consegue reconstruir os tensores,
    recalcular o hash e conferir contra o que esta registrado on-chain - sem
    precisar do codigo do modelo, porque o formato carrega os shapes.
    """
    dados = Path(path).read_bytes()
    saida: List[np.ndarray] = []
    i = 0
    while i < len(dados):
        (ndim,) = struct.unpack_from("<I", dados, i)
        i += 4
        shape = struct.unpack_from(f"<{ndim}I", dados, i)
        i += 4 * ndim
        n = int(np.prod(shape)) if ndim else 1
        arr = np.frombuffer(dados, dtype="<f4", count=n, offset=i).reshape(shape)
        i += 4 * n
        saida.append(np.array(arr))  # copia: o buffer original e imutavel
    return saida


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
    # Como o score foi obtido: cosseno, direcao calibrada, magnitude, veto.
    # Sem isto o participante recebe um numero sem recurso, e nenhum terceiro
    # consegue refazer a conta para contestar.
    score_breakdown: Optional[Dict[str, Any]] = None
    reputation: Optional[float] = None
    reputation_bps: Optional[int] = None
    banned: bool = False
    tx_signature: str = ""  # preenchido pela integracao real; vazio na simulacao


@dataclass
class BanRecord:
    """Evento de banimento permanente (equivale a instrucao `penalize_participant`)."""

    round_number: int
    participant_id: int
    reputation_bps: int
    reason: str = "reputation_below_threshold"
    # `reason_code: u8` e o argumento que a instrucao realmente recebe; o texto
    # acima existe so para o JSON exportado ficar legivel.
    reason_code: int = 1


class SimulatedOnChainLedger:
    """Livro-razao em memoria com encadeamento por hash (mini-blockchain didatica).

    Cada registro guarda o hash do registro anterior, o que torna o historico
    a prova de adulteracao *dentro da simulacao* - da para demonstrar em banca
    que alterar uma metrica antiga quebra a cadeia inteira (`verify_chain`).
    """

    GENESIS = "0" * 64

    def __init__(
        self,
        program_id: str = DEVNET_PROGRAM_ID,
        export_dir: Optional[str | Path] = None,
        export_rounds: Optional[Sequence[int]] = None,
    ) -> None:
        """
        Args:
            export_dir: se informado, grava o artefato canonico dos pesos de cada
                contribuicao ali - o arquivo que a instituicao sobe no painel web.
            export_rounds: de quais rodadas exportar. `None` = todas. Restringir
                importa: cada artefato tem o tamanho do modelo (~860 KB aqui), e
                12 rodadas x 10 participantes encheriam 100 MB sem necessidade.
        """
        self.program_id = program_id
        self.contributions: List[ContributionRecord] = []
        self.bans: List[BanRecord] = []
        self._chain: List[str] = []  # hash de cada bloco, em ordem
        self.export_dir = Path(export_dir) if export_dir else None
        self.export_rounds = set(export_rounds) if export_rounds is not None else None
        # Indice dos artefatos gravados. Fica FORA da cadeia de blocos de
        # proposito: o caminho do arquivo e um detalhe da maquina que rodou o
        # experimento, e incluir isso no hash faria a mesma federacao produzir
        # cadeias diferentes so por ter exportado ou nao os pesos.
        self.artifacts: List[Dict[str, Any]] = []

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
        breakdown: Optional[Dict[str, Any]] = None,
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
            score_breakdown=breakdown,
            reputation=None if reputation is None else round(float(reputation), 6),
            reputation_bps=None if reputation is None else to_basis_points(reputation),
            banned=banned,
        )
        self.contributions.append(record)
        self._append_block(asdict(record))
        self._export_artifact(record, weights)
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

        record = BanRecord(
            round_number,
            participant_id,
            to_basis_points(reputation),
            reason_code=REASON_CODES["reputation_below_threshold"],
        )
        self.bans.append(record)
        self._append_block(asdict(record))
        logger.info(
            "on-chain <- BANIMENTO do participante %d na rodada %d", participant_id, round_number
        )
        return record

    def advance_round(self) -> str:
        """Fecha a rodada. Aqui nao faz nada - existe para a interface bater.

        No `AnchorLedger` esta chamada e obrigatoria: o programa deriva o PDA da
        contribuicao a partir de `config.current_round`, entao a rodada precisa
        ser avancada on-chain ao fim de cada rodada de FL. O livro-razao
        simulado carrega o numero da rodada em cada registro e nao precisa de
        contador global — mas o servidor chama os dois do mesmo jeito, e e essa
        simetria que permite trocar um pelo outro sem tocar no loop federado.
        """
        return ""

    def _export_artifact(
        self, record: ContributionRecord, weights: Sequence[np.ndarray]
    ) -> Optional[Path]:
        """Grava o artefato canonico da contribuicao, se a exportacao estiver ligada.

        E o que fecha a auditoria de ponta a ponta: o arquivo daqui, subido em
        /painel/contribuir, produz no navegador o mesmo hash que esta no registro.
        """
        if self.export_dir is None:
            return None
        if self.export_rounds is not None and record.round_number not in self.export_rounds:
            return None

        nome = f"rodada{record.round_number:02d}_participante{record.participant_id:02d}{CANONICAL_EXT}"
        caminho = export_weights(weights, self.export_dir / nome)
        self.artifacts.append(
            {
                "round_number": record.round_number,
                "participant_id": record.participant_id,
                "file": nome,
                "weights_hash": record.weights_hash,
                "bytes": caminho.stat().st_size,
            }
        )
        return caminho

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
            # Indice dos artefatos: para cada arquivo exportado, o hash que ele
            # deve produzir. E o roteiro da auditoria manual pelo painel web.
            "artifacts": self.artifacts,
        }
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        logger.info("Livro-razao simulado exportado para %s", path)
        return path


# ---------------------------------------------------------------------------
# Stubs da integracao real com o programa Anchor
# ---------------------------------------------------------------------------
#
# Quando a camada on-chain estiver pronta, estas funcoes passam a usar
# `solana-py` + `anchorpy`. Cada uma corresponde a UMA instrucao do programa,
# com o mesmo nome e a mesma lista de argumentos - se um nome divergir, a
# integracao falha em runtime com um erro obscuro de IDL, entao a regra e:
# um stub por instrucao, batendo com programs/awakefl/src/lib.rs.
#
# Quem chama o que (o programa separa os papeis por signer):
#
#     participante  -> register_participant, submit_contribution
#     autoridade    -> initialize, validate_contribution,
#                      penalize_participant, advance_round
#
# A autoridade e o agregador da rodada, ou seja, o `server.py` deste projeto.


# --- Derivacao dos PDAs ----------------------------------------------------
# Reproduzem exatamente os `seeds = [...]` dos contextos de conta do programa.
# Ficam como funcoes puras (recebem o resolvedor) para poderem ser testadas sem
# a dependencia de solders/solana-py instalada.


def derive_config_pda(find_program_address, program_id: str):
    """PDA do Config global: seeds `["config"]`."""
    return find_program_address([SEED_CONFIG], program_id)


def derive_participant_pda(find_program_address, owner_pubkey, program_id):
    """PDA do Participant: seeds `["participant", owner]` - a *wallet* dona."""
    return find_program_address([SEED_PARTICIPANT, bytes(owner_pubkey)], program_id)


def derive_contribution_pda(find_program_address, participant_pda, round_number: int, program_id):
    """PDA da Contribution: seeds `["contribution", participant_PDA, round_u64_le]`.

    Atencao a primeira seed: e o **PDA do Participant**, nao a wallet dona.
    Derivar a partir da wallet gera um endereco que existe, mas que o programa
    rejeita com ConstraintSeeds - erro classico e chato de diagnosticar.
    """
    return find_program_address(
        [SEED_CONTRIBUTION, bytes(participant_pda), round_number.to_bytes(8, "little")],
        program_id,
    )


# --- Instrucoes ------------------------------------------------------------


def anchor_initialize(authority_pubkey: str, program_id: str = DEVNET_PROGRAM_ID) -> str:
    """[STUB] `initialize()` - cria o Config global. Chamado uma unica vez.

    O signer vira `config.authority`, que e quem podera validar contribuicoes,
    penalizar participantes e avancar a rodada.

    Returns:
        Assinatura da transacao (base58).
    """
    raise NotImplementedError(
        "Integracao Anchor ainda nao conectada. Use SimulatedOnChainLedger nesta etapa."
    )


def anchor_register_participant(owner_pubkey: str, program_id: str = DEVNET_PROGRAM_ID) -> str:
    """[STUB] `register_participant()` - registra o signer como participante.

    Quem assina e a propria instituicao (nao a autoridade): entrar na federacao
    e um ato voluntario e a conta fica presa aquela wallet via `has_one = owner`.
    A conta nasce com `reputation = INITIAL_REPUTATION` (500 na escala 0..1000).
    """
    raise NotImplementedError("Integracao Anchor ainda nao conectada.")


def anchor_submit_contribution(
    owner_pubkey: str,
    round_number: int,
    update_hash: str,
    n_samples: int,
    loss: float,
    accuracy: float,
    program_id: str = DEVNET_PROGRAM_ID,
) -> str:
    """[STUB] `submit_contribution(update_hash, n_samples, loss, accuracy)`.

    Args:
        owner_pubkey: wallet da instituicao (assina a transacao).
        round_number: usado apenas para derivar o PDA; o programa grava
            `config.current_round`, entao os dois precisam coincidir.
        update_hash: SHA-256 dos pesos em **hexadecimal** (string de 64 chars,
            o que `hash_weights()` ja devolve). O programa recebe `String`, nao
            bytes - passar `bytes.fromhex(...)` quebra a serializacao.
        n_samples: numero de amostras locais (o peso do FedAvg).
        loss, accuracy: metricas AUTO-DECLARADAS. O programa as guarda como
            evidencia; elas nao influenciam o score.

    Implementacao prevista::

        program = anchorpy.Program(idl, Pubkey.from_string(program_id), provider)
        config_pda, _ = derive_config_pda(Pubkey.find_program_address, program.program_id)
        part_pda,   _ = derive_participant_pda(
            Pubkey.find_program_address, Pubkey.from_string(owner_pubkey), program.program_id)
        contrib_pda, _ = derive_contribution_pda(
            Pubkey.find_program_address, part_pda, round_number, program.program_id)
        await program.rpc["submit_contribution"](
            update_hash, n_samples, loss, accuracy,
            ctx=Context(accounts={
                "config": config_pda, "participant": part_pda,
                "contribution": contrib_pda, "owner": owner_pubkey,
                "system_program": SYS_PROGRAM_ID}))

    Raises (do lado do programa):
        HashTooLong se `len(update_hash) > MAX_HASH_LEN`;
        ParticipantBanned se a conta ja estiver banida.
    """
    raise NotImplementedError("Integracao Anchor ainda nao conectada.")


def anchor_validate_contribution(
    owner_pubkey: str,
    round_number: int,
    score: int,
    program_id: str = DEVNET_PROGRAM_ID,
) -> str:
    """[STUB] `validate_contribution(score)` - a autoridade avalia e a EMA roda on-chain.

    O programa aplica `R(t) = (R(t-1) + S(t)) / 2` em aritmetica inteira sobre a
    conta do participante. Repare que o servidor envia **apenas o score**, nunca
    a reputacao ja calculada: quem detem a formula e a cadeia, e por isso o
    resultado e auditavel por terceiros.

    Args:
        score: inteiro em 0..=1000. Converta o S(t) off-chain com
            `reputation.to_program_scale()`. Acima de 1000 o programa
            responde InvalidScore; `score >= 500` marca a contribuicao como
            Aprovado, abaixo disso Rejeitado.

    Raises (do lado do programa):
        AlreadyValidated se a contribuicao nao estiver mais Pendente.
    """
    raise NotImplementedError("Integracao Anchor ainda nao conectada.")


def anchor_penalize_participant(
    owner_pubkey: str,
    reason_code: int = REASON_CODES["reputation_below_threshold"],
    program_id: str = DEVNET_PROGRAM_ID,
) -> str:
    """[STUB] `penalize_participant(reason_code)` - reputacao / 10 e ban permanente.

    Nao existe instrucao de reversao no programa: o banimento e definitivo por
    design. `reason_code` e um u8 livre, so emitido no evento
    `ParticipantPenalized`; use a tabela `REASON_CODES`.

    Raises (do lado do programa):
        AlreadyBanned se a conta ja estiver banida.
    """
    raise NotImplementedError("Integracao Anchor ainda nao conectada.")


def anchor_advance_round(authority_pubkey: str, program_id: str = DEVNET_PROGRAM_ID) -> str:
    """[STUB] `advance_round()` - incrementa `config.current_round`.

    Deve ser chamada UMA vez ao fim de cada rodada de FL, depois de todas as
    contribuicoes daquela rodada terem sido validadas. Avancar antes da hora
    inutiliza os PDAs de contribuicao ja derivados para a rodada corrente.
    """
    raise NotImplementedError("Integracao Anchor ainda nao conectada.")


def anchor_fetch_participant(
    owner_pubkey: str, program_id: str = DEVNET_PROGRAM_ID
) -> Dict[str, Any]:
    """[STUB] Le a conta `Participant` on-chain.

    Returns:
        `{owner, reputation, contrib_count, is_banned, stake_amount}` -
        `reputation` na escala 0..=1000 do programa. Use
        `reputation / PROGRAM_MAX_REPUTATION` para voltar a escala [0,1] usada
        pelo `reputation.py`.
    """
    raise NotImplementedError("Integracao Anchor ainda nao conectada.")
