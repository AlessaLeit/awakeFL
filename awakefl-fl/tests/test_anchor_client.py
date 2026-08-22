"""Testes do cliente Anchor.

Divididos em tres grupos, por custo:

1. **Offline** - derivacao de PDA, determinismo das keypairs, montagem das
   contas. Rodam sempre que o extra `[chain]` estiver instalado.
2. **Dry-run** - o fluxo completo de uma contribuicao sem tocar a rede: prova
   que a ordem das instrucoes, os argumentos e os registros produzidos estao
   corretos.
3. **Rede** (`AWAKEFL_DEVNET=1`) - leitura da conta Config real na Devnet.
   Confirma que a derivacao de PDA daqui aponta para o deploy de verdade. Fica
   fora do CI porque depende de RPC publico, que pode estar instavel.

Nenhum teste envia transacao: escrever on-chain custa SOL e exige keypair
financiada, o que e um passo manual e deliberado.
"""

from __future__ import annotations

import json
import os
import urllib.request

import numpy as np
import pytest

anchorpy = pytest.importorskip("anchorpy", reason="extra [chain] nao instalado")

from solders.pubkey import Pubkey  # noqa: E402

from anchor_client import (  # noqa: E402
    DEVNET_RPC,
    IX_ADVANCE,
    IX_INITIALIZE,
    IX_PENALIZE,
    IX_REGISTER,
    IX_SUBMIT,
    IX_VALIDATE,
    AnchorLedger,
    derive_simulation_keypairs,
    load_idl,
    pda_config,
    pda_contribution,
    pda_participant,
)
from onchain_interface import DEVNET_PROGRAM_ID  # noqa: E402

PID = Pubkey.from_string(DEVNET_PROGRAM_ID)

# Endereco derivado de ["config"] sob o Program ID da Devnet. Confirmado contra
# a conta real (ver test_config_pda_existe_na_devnet). Se este valor mudar sem
# o Program ID mudar, a derivacao quebrou.
CONFIG_PDA_ESPERADO = "EYb7UfDzekMg5aXcvy28XFY2NTwGCC3z3AkhxzAWrsan"


# ---------------------------------------------------------------------------
# 1. Offline
# ---------------------------------------------------------------------------


def test_config_pda_e_o_endereco_conhecido():
    assert str(pda_config(PID)) == CONFIG_PDA_ESPERADO


def test_pdas_sao_deterministicos():
    """Duas derivacoes independentes chegam no mesmo endereco.

    O teste so tem valor se as duas pontas forem calculadas do zero: comparar
    o retorno de uma chamada com o dela mesma nao prova determinismo nenhum.
    Derivar a carteira duas vezes tambem cobre o
    `derive_simulation_keypairs`, que e quem alimenta as seeds.
    """
    dono_a = derive_simulation_keypairs(1)[0].pubkey()
    dono_b = derive_simulation_keypairs(1)[0].pubkey()

    p_a = pda_participant(PID, dono_a)
    p_b = pda_participant(PID, dono_b)
    assert p_a == p_b
    assert pda_contribution(PID, p_a, 3) == pda_contribution(PID, p_b, 3)


def test_os_dois_livros_razao_aceitam_a_mesma_chamada():
    """`AnchorLedger` e `SimulatedOnChainLedger` sao intercambiaveis no servidor.

    O servidor nao sabe qual backend esta usando: chama
    `register_contribution(...)` com o mesmo conjunto de argumentos nomeados nos
    dois casos. Quando um ganha um parametro e o outro nao, `--chain devnet`
    quebra na primeira contribuicao — e foi exatamente o que aconteceu com o
    `breakdown`, que existia so no simulado.

    Comparar as assinaturas e mais barato do que rodar a federacao inteira em
    cada backend so para descobrir isso.
    """
    import inspect

    from onchain_interface import SimulatedOnChainLedger

    def nomes(cls, metodo):
        params = inspect.signature(getattr(cls, metodo)).parameters
        return {n for n in params if n != "self"}

    for metodo in ("register_contribution", "register_ban", "advance_round"):
        do_simulado = nomes(SimulatedOnChainLedger, metodo)
        do_anchor = nomes(AnchorLedger, metodo)
        faltando = do_simulado - do_anchor
        assert not faltando, (
            f"AnchorLedger.{metodo} nao aceita {sorted(faltando)}, que o "
            f"servidor passa quando fala com o ledger simulado"
        )


def test_contribuicao_muda_de_endereco_a_cada_rodada():
    """A rodada entra na seed, entao cada rodada tem sua propria conta.

    E o que impede a mesma contribuicao de sobrescrever a anterior - e o que
    faz `advance_round` no meio de uma rodada quebrar os PDAs ja derivados.
    """
    p = pda_participant(PID, derive_simulation_keypairs(1)[0].pubkey())
    enderecos = {str(pda_contribution(PID, p, r)) for r in range(5)}
    assert len(enderecos) == 5


def test_seed_da_contribuicao_usa_o_pda_e_nao_a_wallet():
    """Derivar da wallet gera endereco valido que o programa rejeita."""
    dono = derive_simulation_keypairs(1)[0].pubkey()
    participante = pda_participant(PID, dono)
    correto = pda_contribution(PID, participante, 0)
    errado = pda_contribution(PID, dono, 0)
    assert correto != errado


def test_keypairs_da_simulacao_sao_reproduziveis():
    a = derive_simulation_keypairs(4, seed=7)
    b = derive_simulation_keypairs(4, seed=7)
    assert [k.pubkey() for k in a.values()] == [k.pubkey() for k in b.values()]
    assert len({str(k.pubkey()) for k in a.values()}) == 4  # e distintas entre si

    outra = derive_simulation_keypairs(4, seed=8)
    assert a[0].pubkey() != outra[0].pubkey()


def test_idl_carregado_bate_com_o_programa():
    idl = load_idl()
    nomes = {i.name for i in idl.instructions}
    # camelCase: e assim que o anchorpy expoe as instrucoes depois da conversao
    # de formato, e e por esse nome que `program.rpc[...]` as encontra.
    assert {IX_INITIALIZE, IX_REGISTER, IX_SUBMIT, IX_VALIDATE, IX_PENALIZE, IX_ADVANCE} <= nomes


# ---------------------------------------------------------------------------
# 2. Dry-run
# ---------------------------------------------------------------------------


@pytest.fixture
def ledger():
    chaves = derive_simulation_keypairs(3, seed=1)
    return AnchorLedger(
        authority=derive_simulation_keypairs(1, seed=999)[0],
        participant_keys=chaves,
        dry_run=True,
    )


def test_contas_da_contribuicao_tem_todas_as_exigidas(ledger):
    contas = ledger.contas_da_contribuicao(participant_id=1, round_number=4)
    assert set(contas) == {"config", "participant", "contribution", "owner", "system_program"}
    assert contas["config"] == pda_config(PID)
    assert contas["participant"] == pda_participant(PID, ledger._owner(1))


def test_dry_run_registra_sem_tocar_a_rede(ledger):
    pesos = [np.ones((2, 2), dtype=np.float32), np.zeros(2, dtype=np.float32)]
    registro = ledger.register_contribution(
        round_number=2, participant_id=1, weights=pesos, num_examples=500,
        metrics={"accuracy": 0.9, "loss": 0.2}, score=0.87, reputation=0.9,
    )
    assert len(registro.weights_hash) == 64
    assert registro.tx_signature == ""       # dry-run nao produz assinatura
    assert ledger.contributions == [registro]
    # As duas instrucoes foram planejadas: envio (participante) e validacao
    # (autoridade).
    assert ledger.signatures[0]["submit"] == ""
    assert "validate" in ledger.signatures[0]


def test_ban_entra_no_registro(ledger):
    ledger.register_ban(round_number=5, participant_id=2, reputation=0.03)
    assert ledger.banned_ids == [2]
    assert ledger.bans[0].reason_code == 1


def test_export_json_traz_assinaturas(ledger, tmp_path):
    pesos = [np.ones(4, dtype=np.float32)]
    ledger.register_contribution(1, 0, pesos, 100, {"accuracy": 0.5, "loss": 1.0}, 0.5, 0.5)
    caminho = ledger.export_json(tmp_path / "onchain.json")
    dados = json.loads(caminho.read_text(encoding="utf-8"))
    assert dados["program_id"] == DEVNET_PROGRAM_ID
    assert dados["dry_run"] is True
    assert len(dados["contributions"]) == 1
    assert len(dados["signatures"]) == 1


# ---------------------------------------------------------------------------
# 3. Rede (opcional)
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    os.environ.get("AWAKEFL_DEVNET") != "1",
    reason="teste de rede: rode com AWAKEFL_DEVNET=1",
)
def test_config_pda_existe_na_devnet():
    """A derivacao aponta para a conta real do programa publicado."""
    req = urllib.request.Request(
        DEVNET_RPC,
        data=json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "getAccountInfo",
                "params": [str(pda_config(PID)), {"encoding": "base64"}],
            }
        ).encode(),
        headers={"Content-Type": "application/json"},
    )
    valor = json.loads(urllib.request.urlopen(req, timeout=30).read())["result"]["value"]
    assert valor is not None, "Config nao encontrado - o programa foi inicializado?"
    assert valor["owner"] == DEVNET_PROGRAM_ID
