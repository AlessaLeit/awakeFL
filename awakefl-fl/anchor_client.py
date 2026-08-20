"""Cliente Anchor de verdade: substitui o livro-razao simulado pela Devnet.

Este modulo e a outra metade da ponte que o `onchain_interface.py` documenta.
Ele expoe a classe `AnchorLedger`, que tem **a mesma interface** do
`SimulatedOnChainLedger` (`register_contribution`, `register_ban`,
`export_json`, `banned_ids`, ...). E de proposito: o `server.py` nao sabe nem
precisa saber com qual dos dois esta falando - trocar um pelo outro nao muda
uma linha do loop federado.

    ledger simulado  ->  JSON local, instantaneo, sem custo
    ledger Anchor    ->  transacoes reais, auditavel por terceiros

Dependencias opcionais
----------------------
Instale com o extra::

    pip install -r requirements-chain.txt

Sem elas, importar este modulo levanta um erro explicativo em vez de um
`ModuleNotFoundError` cru - o resto do projeto continua rodando normalmente,
porque nada em `server.py` importa este arquivo no topo.

Um detalhe que costuma pegar
----------------------------
No programa, `submit_contribution` e assinada pelo PARTICIPANTE, nao pela
autoridade: e a instituicao que se compromete com o proprio hash. Numa
simulacao com N participantes isso significa N keypairs, cada uma com saldo
para o rent das contas (~0,0016 SOL por Contribution) e para as taxas. Por isso
`AnchorLedger` recebe um mapa `participant_id -> Keypair` e nao uma keypair so.
`derive_simulation_keypairs()` gera esse mapa de forma deterministica a partir
de uma seed, para o experimento ser reproduzivel; financiar as contas continua
sendo um passo manual (`solana airdrop`), fora do escopo do codigo.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

import numpy as np

from onchain_interface import (
    DEVNET_PROGRAM_ID,
    MAX_HASH_LEN,
    REASON_CODES,
    SEED_CONFIG,
    SEED_CONTRIBUTION,
    SEED_PARTICIPANT,
    BanRecord,
    ContributionRecord,
    hash_weights,
)
from reputation import to_program_scale

logger = logging.getLogger("awakefl.anchor")

DEVNET_RPC = "https://api.devnet.solana.com"

# Nomes das instrucoes como o anchorpy os expoe. O programa as declara em
# snake_case, mas o IDL no formato que o anchorpy consome usa camelCase - e
# `program.rpc["submit_contribution"]` levantaria um KeyError silencioso ate a
# primeira transacao. Centralizados aqui para nao haver string solta no codigo.
IX_SUBMIT = "submitContribution"
IX_VALIDATE = "validateContribution"
IX_PENALIZE = "penalizeParticipant"
IX_ADVANCE = "advanceRound"
IX_REGISTER = "registerParticipant"
IX_INITIALIZE = "initialize"

_FALTA_DEP = (
    "A integracao on-chain precisa de anchorpy e solders.\n"
    "    pip install -r requirements-chain.txt\n"
    "Sem elas, use o SimulatedOnChainLedger (padrao do projeto)."
)

try:
    from anchorpy import Idl, Program, Provider, Wallet
    from anchorpy.program.context import Context
    from solders.keypair import Keypair
    from solders.pubkey import Pubkey
    from solders.system_program import ID as SYSTEM_PROGRAM_ID

    CHAIN_AVAILABLE = True
except ImportError:  # pragma: no cover - depende do ambiente
    CHAIN_AVAILABLE = False
    Keypair = Pubkey = Idl = Program = Provider = Wallet = Context = None  # type: ignore
    SYSTEM_PROGRAM_ID = None  # type: ignore


# ---------------------------------------------------------------------------
# PDAs - espelham `seeds = [...]` do programa e `pda*()` do web/src/lib/anchor
# ---------------------------------------------------------------------------


def pda_config(program_id: "Pubkey") -> "Pubkey":
    """`["config"]`"""
    return Pubkey.find_program_address([SEED_CONFIG], program_id)[0]


def pda_participant(program_id: "Pubkey", owner: "Pubkey") -> "Pubkey":
    """`["participant", owner]` - a wallet dona, nao o PDA."""
    return Pubkey.find_program_address([SEED_PARTICIPANT, bytes(owner)], program_id)[0]


def pda_contribution(program_id: "Pubkey", participant: "Pubkey", round_number: int) -> "Pubkey":
    """`["contribution", participant_PDA, round_u64_le]`.

    A primeira seed e o PDA do Participant, NAO a wallet dona - derivar da
    wallet gera um endereco valido que o programa rejeita com ConstraintSeeds.
    """
    return Pubkey.find_program_address(
        [SEED_CONTRIBUTION, bytes(participant), int(round_number).to_bytes(8, "little")],
        program_id,
    )[0]


def derive_simulation_keypairs(num_participants: int, seed: int = 42) -> Dict[int, "Keypair"]:
    """Keypairs deterministicas para os participantes simulados.

    Deterministicas para o experimento ser reproduzivel: a mesma seed sempre
    produz as mesmas wallets, entao da para financia-las uma vez e reaproveitar
    entre execucoes.

    NAO use isto fora de Devnet/localnet: a chave privada e derivada de um
    inteiro publico e qualquer pessoa que leia este codigo consegue reproduzi-la.
    """
    _exige_dependencias()
    kps: Dict[int, "Keypair"] = {}
    for cid in range(num_participants):
        material = np.random.default_rng([seed, cid]).integers(0, 256, size=32, dtype=np.uint8)
        kps[cid] = Keypair.from_seed(bytes(material))
    return kps


def _exige_dependencias() -> None:
    if not CHAIN_AVAILABLE:
        raise ImportError(_FALTA_DEP)


IDL_CANONICO = Path(__file__).resolve().parent.parent / "web" / "src" / "lib" / "idl" / "awakefl.json"


def _camel(nome: str) -> str:
    partes = nome.split("_")
    return partes[0] + "".join(p.title() for p in partes[1:])


def para_idl_legado(dados: Dict[str, Any]) -> Dict[str, Any]:
    """Converte o IDL do Anchor 0.30+ para o formato que o anchorpy entende.

    O Anchor mudou o formato do IDL na 0.30 (`metadata.spec = "0.1.0"`), e o
    anchorpy 0.21 ainda le o formato antigo. Em vez de manter uma segunda copia
    do IDL - que e exatamente o tipo de duplicata que diverge sem ninguem ver -
    convertemos em memoria, na hora de carregar.

    O que muda:

    * `address` + `metadata` viram `version` + `name`;
    * contas de instrucao: `writable`/`signer` viram `isMut`/`isSigner`, e as
      contas com `address` fixo (system_program) deixam de ser marcadas;
    * nomes snake_case viram camelCase;
    * `accounts` no formato novo so tem nome e discriminador - a definicao do
      struct mora em `types`, e o formato antigo exige as duas juntas.
    """
    tipos = {t["name"]: t for t in dados.get("types", [])}

    def converte_conta(c: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "name": _camel(c["name"]),
            "isMut": bool(c.get("writable", False)),
            "isSigner": bool(c.get("signer", False)),
        }

    def converte_campos(no: Any) -> Any:
        """Renomeia campos para camelCase e traduz os tipos primitivos.

        Duas mudancas de nomenclatura entre os formatos, ambas silenciosas se
        esquecidas: `pubkey` virou o nome curto do que o formato antigo chama
        `publicKey`, e `defined` deixou de ser uma string para virar
        `{"name": ...}`.
        """
        if isinstance(no, dict):
            if set(no) == {"defined"} and isinstance(no["defined"], dict):
                return {"defined": no["defined"]["name"]}
            saida = {}
            for k, v in no.items():
                if k == "name" and isinstance(v, str):
                    saida[k] = _camel(v)
                elif k == "type" and v == "pubkey":
                    saida[k] = "publicKey"
                else:
                    saida[k] = converte_campos(v)
            return saida
        if isinstance(no, list):
            return [converte_campos(i) for i in no]
        return "publicKey" if no == "pubkey" else no

    legado: Dict[str, Any] = {
        "version": dados.get("metadata", {}).get("version", "0.1.0"),
        "name": dados.get("metadata", {}).get("name", "awakefl"),
        "instructions": [
            {
                "name": _camel(i["name"]),
                "accounts": [converte_conta(c) for c in i.get("accounts", [])],
                "args": [converte_campos(a) for a in i.get("args", [])],
            }
            for i in dados.get("instructions", [])
        ],
        "accounts": [
            {"name": a["name"], "type": converte_campos(tipos[a["name"]]["type"])}
            for a in dados.get("accounts", [])
            if a["name"] in tipos
        ],
        "types": [
            converte_campos(t)
            for t in dados.get("types", [])
            # Os structs de conta ja foram para `accounts`; repetir aqui faria o
            # anchorpy registrar o mesmo layout duas vezes.
            if t["name"] not in {a["name"] for a in dados.get("accounts", [])}
        ],
        "errors": dados.get("errors", []),
    }
    return legado


def load_idl(path: Optional[str | Path] = None) -> "Idl":
    """Carrega o IDL canonico - o MESMO arquivo que o site usa.

    Ter uma copia so do IDL evita a classe de bug em que a web e o servidor
    concordam sobre o programa mas discordam entre si. A adaptacao de formato
    acontece em memoria (`para_idl_legado`), nao em disco.
    """
    _exige_dependencias()
    dados = json.loads(Path(path or IDL_CANONICO).read_text(encoding="utf-8"))
    if "metadata" in dados and "spec" in dados.get("metadata", {}):
        dados = para_idl_legado(dados)
    return Idl.from_json(json.dumps(dados))


# ---------------------------------------------------------------------------
# Livro-razao on-chain
# ---------------------------------------------------------------------------


class AnchorLedger:
    """Livro-razao real: cada contribuicao vira uma transacao na Solana.

    Interface identica a do `SimulatedOnChainLedger`, com uma diferenca de
    semantica que o chamador precisa conhecer: aqui as escritas custam SOL e
    demoram (confirmacao de bloco), entao uma rodada de 10 participantes gera
    ~21 transacoes e leva dezenas de segundos.
    """

    def __init__(
        self,
        authority: "Keypair",
        participant_keys: Dict[int, "Keypair"],
        program_id: str = DEVNET_PROGRAM_ID,
        rpc_url: str = DEVNET_RPC,
        idl_path: Optional[str | Path] = None,
        dry_run: bool = False,
    ) -> None:
        """
        Args:
            authority: keypair do agregador - valida contribuicoes, penaliza e
                avanca rodadas. E o `config.authority` criado no `initialize`.
            participant_keys: `{participant_id: Keypair}` das instituicoes.
            dry_run: monta as instrucoes e deriva os PDAs, mas nao envia nada.
                Serve para conferir a integracao sem gastar SOL nem depender da
                rede - e o que os testes usam.
        """
        _exige_dependencias()
        self.authority = authority
        self.participant_keys = participant_keys
        self.program_id = program_id
        self.rpc_url = rpc_url
        self.dry_run = dry_run
        self._pid = Pubkey.from_string(program_id)
        self._idl = load_idl(idl_path)

        # Mesma estrutura de saida do ledger simulado, para o relatorio nao
        # precisar saber de qual backend os dados vieram.
        self.contributions: List[ContributionRecord] = []
        self.bans: List[BanRecord] = []
        self.artifacts: List[Dict[str, Any]] = []
        self.signatures: List[Dict[str, str]] = []
        # Em dry-run o contador vive so na memoria, comecando em 0. Sem isso o
        # ensaio derivaria o MESMO PDA em todas as rodadas - exatamente o bug
        # que o advance_round existe para evitar - e daria a impressao errada
        # de que a integracao esta quebrada.
        self._rodada_cache: Optional[int] = 0 if dry_run else None

    # -- helpers -----------------------------------------------------------

    def _owner(self, participant_id: int) -> "Pubkey":
        return self.participant_keys[participant_id].pubkey()

    def contas_da_contribuicao(self, participant_id: int, round_number: int) -> Dict[str, "Pubkey"]:
        """Todas as contas de um `submit_contribution`. Publico para os testes."""
        owner = self._owner(participant_id)
        participante = pda_participant(self._pid, owner)
        return {
            "config": pda_config(self._pid),
            "participant": participante,
            "contribution": pda_contribution(self._pid, participante, round_number),
            "owner": owner,
            "system_program": SYSTEM_PROGRAM_ID,
        }

    def current_round(self) -> int:
        """Le `config.current_round` da chain.

        A CHAIN e a autoridade sobre o numero da rodada, nao o servidor de FL.
        O programa deriva o PDA da contribuicao a partir de
        `config.current_round`; se o servidor derivar a partir do proprio
        contador, os dois enderecos divergem e a instrucao e rejeitada com
        ConstraintSeeds - um erro que so aparece na primeira transacao real,
        porque o dry-run nao confere nada contra o programa.

        O valor fica em cache e so e relido quando `advance_round()` o
        invalida: sao 10 contribuicoes por rodada, e reler o Config em cada uma
        seria uma ida ao RPC por participante sem nenhuma informacao nova.

        Em dry-run devolve 0: nao ha chain para consultar.
        """
        if self._rodada_cache is not None:
            return self._rodada_cache

        async def _ler():
            program, conexao = await self._com_programa(self.authority)
            try:
                conta = await program.account["Config"].fetch(pda_config(self._pid))
                return int(conta.current_round)
            finally:
                await conexao.close()

        self._rodada_cache = asyncio.run(_ler())
        return self._rodada_cache

    async def _com_programa(self, keypair: "Keypair"):
        """Abre um Program assinando com a keypair dada."""
        from solana.rpc.async_api import AsyncClient

        conexao = AsyncClient(self.rpc_url)
        provider = Provider(conexao, Wallet(keypair))
        return Program(self._idl, self._pid, provider), conexao

    async def _envia(self, keypair: "Keypair", nome: str, args: list, contas: dict) -> str:
        """Envia uma instrucao e devolve a assinatura (ou `""` em dry-run)."""
        if self.dry_run:
            logger.info("[dry-run] %s | contas=%s", nome, {k: str(v)[:8] for k, v in contas.items()})
            return ""
        program, conexao = await self._com_programa(keypair)
        try:
            sig = await program.rpc[nome](*args, ctx=Context(accounts=contas))
            logger.info("%s -> %s", nome, sig)
            return str(sig)
        finally:
            await conexao.close()

    # -- interface compativel com o SimulatedOnChainLedger -----------------

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
        """`submit_contribution` + `validate_contribution`, nesta ordem.

        Sao duas transacoes com signers diferentes: a instituicao se compromete
        com o hash, e so depois a autoridade pontua. Inverter a ordem faria a
        validacao referenciar uma conta que ainda nao existe.
        """
        digest = hash_weights(weights)
        if len(digest) > MAX_HASH_LEN:  # nunca deve acontecer: SHA-256 hex = 64
            raise ValueError(f"hash com {len(digest)} chars excede MAX_HASH_LEN")

        metricas = {k: float(v) for k, v in (metrics or {}).items()}

        # O PDA vem da rodada DA CHAIN, nao da rodada do FL. As duas contagens
        # so coincidem se a federacao comecar com o Config zerado, o que nao da
        # para assumir: o programa e um deploy compartilhado e ja pode ter
        # avancado. `round_number` continua no registro local, para o relatorio.
        rodada_chain = self.current_round()
        contas = self.contas_da_contribuicao(participant_id, rodada_chain)

        sig_envio = asyncio.run(
            self._envia(
                self.participant_keys[participant_id],
                IX_SUBMIT,
                [digest, int(num_examples), metricas.get("loss", 0.0), metricas.get("accuracy", 0.0)],
                contas,
            )
        )

        sig_validacao = ""
        if score is not None:
            sig_validacao = asyncio.run(
                self._envia(
                    self.authority,
                    IX_VALIDATE,
                    [to_program_scale(score)],
                    {
                        "config": contas["config"],
                        "participant": contas["participant"],
                        "contribution": contas["contribution"],
                        "authority": self.authority.pubkey(),
                    },
                )
            )

        registro = ContributionRecord(
            round_number=round_number,
            participant_id=participant_id,
            weights_hash=digest,
            num_examples=int(num_examples),
            metrics=metricas,
            score=None if score is None else round(float(score), 6),
            reputation=None if reputation is None else round(float(reputation), 6),
            reputation_bps=None if reputation is None else int(round(reputation * 10_000)),
            banned=banned,
            tx_signature=sig_envio,
        )
        self.contributions.append(registro)
        self.signatures.append(
            {
                "round": str(round_number),
                "participant": str(participant_id),
                "submit": sig_envio,
                "validate": sig_validacao,
            }
        )
        return registro

    def register_ban(self, round_number: int, participant_id: int, reputation: float) -> BanRecord:
        """`penalize_participant`: reputacao / 10 e banimento permanente."""
        codigo = REASON_CODES["reputation_below_threshold"]
        sig = asyncio.run(
            self._envia(
                self.authority,
                IX_PENALIZE,
                [codigo],
                {
                    "config": pda_config(self._pid),
                    "participant": pda_participant(self._pid, self._owner(participant_id)),
                    "authority": self.authority.pubkey(),
                },
            )
        )
        registro = BanRecord(
            round_number=round_number,
            participant_id=participant_id,
            reputation_bps=int(round(reputation * 10_000)),
            reason_code=codigo,
        )
        self.bans.append(registro)
        self.signatures.append(
            {"round": str(round_number), "participant": str(participant_id), "penalize": sig}
        )
        logger.warning("on-chain BAN | participante %d | rodada %d", participant_id, round_number)
        return registro

    def advance_round(self) -> str:
        """`advance_round` - uma vez por rodada, DEPOIS de validar todas as contribuicoes.

        Avancar antes invalida os PDAs de contribuicao ja derivados para a
        rodada corrente: eles apontariam para a rodada seguinte e o programa
        rejeitaria com ConstraintSeeds.
        """
        sig = asyncio.run(
            self._envia(
                self.authority,
                IX_ADVANCE,
                [],
                {"config": pda_config(self._pid), "authority": self.authority.pubkey()},
            )
        )
        # O cache tem que acompanhar, senao a proxima rodada deriva o PDA da
        # rodada que acabou de fechar.
        if self._rodada_cache is not None:
            self._rodada_cache += 1
        return sig

    @property
    def banned_ids(self) -> List[int]:
        return sorted({b.participant_id for b in self.bans})

    @property
    def _chain(self) -> List[str]:
        """"Blocos" registrados = transacoes enviadas.

        O nome vem da interface do ledger simulado, que o relatorio consome.
        Aqui cada assinatura de transacao faz o papel de um bloco: e o ponteiro
        publico para o registro daquele evento.
        """
        return [s.get("submit") or s.get("penalize") or "" for s in self.signatures]

    def verify_chain(self) -> bool:
        """Integridade da cadeia.

        No ledger simulado isto recalcula os hashes encadeados, porque a
        estrutura mora num JSON que qualquer um poderia editar. Aqui a
        integridade e a da propria Solana: os registros estao em contas do
        programa e a ordem esta nos slots. Nao ha o que recalcular localmente -
        auditar de verdade significa reler as contas pelo RPC, que e o que
        `fetch_participant()` faz.

        Devolvemos True em modo real e True em dry-run (nada foi escrito, logo
        nada esta corrompido) apenas para o relatorio ter um valor coerente.
        """
        return True

    def export_json(self, path: str | Path) -> Path:
        """Exporta o mesmo formato do ledger simulado, mais as assinaturas.

        As assinaturas sao o que permite a qualquer pessoa abrir o explorer e
        conferir a transacao - a diferenca pratica entre "confie no meu JSON" e
        "verifique voce mesmo".
        """
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "program_id": self.program_id,
            "rpc_url": self.rpc_url,
            "dry_run": self.dry_run,
            "contributions": [asdict(c) for c in self.contributions],
            "bans": [asdict(b) for b in self.bans],
            "artifacts": self.artifacts,
            "signatures": self.signatures,
        }
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        logger.info("Registro on-chain exportado para %s", path)
        return path

    # -- leitura -----------------------------------------------------------

    def fetch_participant(self, participant_id: int) -> Dict[str, Any]:
        """Le a conta `Participant` on-chain (reputacao na escala 0..=1000)."""

        async def _ler():
            program, conexao = await self._com_programa(self.authority)
            try:
                conta = await program.account["Participant"].fetch(
                    pda_participant(self._pid, self._owner(participant_id))
                )
                return {
                    "owner": str(conta.owner),
                    "reputation": int(conta.reputation),
                    "contrib_count": int(conta.contrib_count),
                    "is_banned": bool(conta.is_banned),
                    "stake_amount": int(conta.stake_amount),
                }
            finally:
                await conexao.close()

        return asyncio.run(_ler())
