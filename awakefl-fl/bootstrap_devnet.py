"""Prepara a Devnet para uma execucao real do AwakeFL.

O `--chain devnet` do run_experiments precisa de um mundo ja montado: cada
instituicao simulada tem a propria carteira, cada carteira precisa de saldo, e
cada participante precisa estar registrado no programa antes de conseguir
submeter. Este script faz esses tres passos, em ordem, e verifica antes de
gastar.

    python bootstrap_devnet.py checar    --participants 3
    python bootstrap_devnet.py financiar --participants 3
    python bootstrap_devnet.py registrar --participants 3
    python bootstrap_devnet.py plano     --participants 3 --rounds 3

Depois disso::

    python run_experiments.py --chain devnet --scenarios C \\
        --clients 3 --rounds 3 --malicious-ids 2 \\
        --authority-keypair ~/.config/solana/id.json

Por que carteiras separadas
---------------------------
No programa, `submit_contribution` e assinada pelo PARTICIPANTE, nao pela
autoridade: e a instituicao que se compromete com o proprio hash, e e isso que
torna o registro uma evidencia e nao uma afirmacao do servidor. Uma keypair so
para todos destruiria essa propriedade.

As chaves sao derivadas deterministicamente da seed do experimento
(`derive_simulation_keypairs`), entao a mesma seed reproduz as mesmas carteiras
e o financiamento e reaproveitado entre execucoes.

AVISO: essas chaves privadas sao derivadas de um inteiro publico. Servem para
Devnet e localnet e para mais nada.

Custo
-----
Cada `Contribution` e uma conta nova de 142 bytes: ~0,0016 SOL de rent, que NAO
volta (o programa nao tem instrucao de close). Some as taxas de assinatura. O
subcomando `plano` estima o total antes de voce comecar.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

LAMPORTS_POR_SOL = 1_000_000_000

# Rent de cada conta do programa, em SOL. Valores de `space` vindos do state.rs
# (8 bytes de discriminador + INIT_SPACE), na tabela de rent da Solana.
RENT_PARTICIPANT = 0.00133
RENT_CONTRIBUTION = 0.00186
TAXA_POR_TX = 0.000005

# Saldo minimo por carteira antes de considerar que ela esta pronta.
SALDO_MINIMO = 0.05


def _exige_deps():
    try:
        import anchorpy  # noqa: F401
        import solana  # noqa: F401
    except ImportError:
        print(
            "Faltam dependencias da integracao on-chain.\n"
            "    pip install -r requirements-chain.txt",
            file=sys.stderr,
        )
        raise SystemExit(2)


def carteiras(n: int, seed: int) -> Dict[int, object]:
    from anchor_client import derive_simulation_keypairs

    return derive_simulation_keypairs(n, seed=seed)


def cliente(rpc: str):
    from solana.rpc.api import Client

    return Client(rpc)


def saldos(rpc: str, chaves: Dict[int, object]) -> Dict[int, float]:
    c = cliente(rpc)
    return {
        cid: c.get_balance(kp.pubkey()).value / LAMPORTS_POR_SOL
        for cid, kp in sorted(chaves.items())
    }


def registrados(rpc: str, chaves: Dict[int, object], program_id: str) -> Dict[int, bool]:
    """Quais participantes ja tem a conta PDA criada on-chain."""
    from solders.pubkey import Pubkey

    from anchor_client import pda_participant

    c = cliente(rpc)
    pid = Pubkey.from_string(program_id)
    saida = {}
    for cid, kp in sorted(chaves.items()):
        conta = c.get_account_info(pda_participant(pid, kp.pubkey())).value
        saida[cid] = conta is not None
    return saida


# ---------------------------------------------------------------------------
# Subcomandos
# ---------------------------------------------------------------------------


def cmd_checar(args) -> int:
    """Mostra carteiras, saldos e quem ja esta registrado. So leitura."""
    chaves = carteiras(args.participants, args.seed)
    saldo = saldos(args.rpc, chaves)
    reg = registrados(args.rpc, chaves, args.program_id)

    print(f"\nRPC .......... {args.rpc}")
    print(f"Programa ..... {args.program_id}")
    print(f"Seed ......... {args.seed}  (as carteiras derivam dela)\n")
    print(f"{'id':>3}  {'carteira':<46}{'saldo (SOL)':>13}  registrado")
    print("-" * 78)
    for cid, kp in sorted(chaves.items()):
        marca = "sim" if reg[cid] else "NAO"
        print(f"{cid:>3}  {str(kp.pubkey()):<46}{saldo[cid]:>13.6f}  {marca}")

    sem_saldo = [c for c, v in saldo.items() if v < SALDO_MINIMO]
    sem_reg = [c for c, v in reg.items() if not v]
    print()
    if sem_saldo:
        print(f"  {len(sem_saldo)} carteira(s) abaixo de {SALDO_MINIMO} SOL -> rode 'financiar'")
    if sem_reg:
        print(f"  {len(sem_reg)} participante(s) sem conta on-chain -> rode 'registrar'")
    if not sem_saldo and not sem_reg:
        print("  Tudo pronto para --chain devnet.")
    return 0


def cmd_plano(args) -> int:
    """Estima o custo da execucao ANTES de gastar. So aritmetica, sem rede."""
    n, r = args.participants, args.rounds
    contribuicoes = n * r

    rent = n * RENT_PARTICIPANT + contribuicoes * RENT_CONTRIBUTION
    # submit + validate por contribuicao, mais o registro de cada participante,
    # mais um advance_round por rodada.
    txs = contribuicoes * 2 + n + r
    taxas = txs * TAXA_POR_TX
    total = rent + taxas

    print(f"\nPlano: {n} participantes x {r} rodadas = {contribuicoes} contribuicoes\n")
    print(f"  transacoes ............... {txs}")
    print(f"  rent (nao volta) ......... {rent:.5f} SOL")
    print(f"  taxas .................... {taxas:.5f} SOL")
    print(f"  TOTAL .................... {total:.5f} SOL")
    print(f"  por carteira ............. ~{total / n:.5f} SOL\n")
    print("  O rent das contas Contribution nao e recuperavel: o programa nao")
    print("  tem instrucao de close. Cada rodada cria N contas novas.\n")
    if txs > 100:
        print(f"  AVISO: {txs} transacoes na Devnet levam varios minutos e podem")
        print("  esbarrar em limite de taxa do RPC publico. Para uma demonstracao,")
        print("  3 participantes x 3 rodadas ja mostra o fluxo inteiro.\n")
    return 0


def cmd_financiar(args) -> int:
    """Pede airdrop para as carteiras abaixo do saldo minimo."""
    from solders.pubkey import Pubkey  # noqa: F401

    chaves = carteiras(args.participants, args.seed)
    c = cliente(args.rpc)
    saldo = saldos(args.rpc, chaves)
    alvos = [cid for cid, v in saldo.items() if v < args.saldo_alvo]

    if not alvos:
        print(f"Todas as carteiras ja tem pelo menos {args.saldo_alvo} SOL.")
        return 0

    print(f"Pedindo airdrop de {args.airdrop} SOL para {len(alvos)} carteira(s)...\n")
    falhas = []
    for cid in alvos:
        kp = chaves[cid]
        try:
            resp = c.request_airdrop(kp.pubkey(), int(args.airdrop * LAMPORTS_POR_SOL))
            c.confirm_transaction(resp.value)
            print(f"  [{cid}] {kp.pubkey()}  ok")
        except Exception as e:  # a torneira da Devnet falha com frequencia
            falhas.append(cid)
            print(f"  [{cid}] {kp.pubkey()}  FALHOU: {str(e)[:70]}")
        time.sleep(args.intervalo)  # limite de taxa do RPC publico

    if falhas:
        print(
            f"\n{len(falhas)} airdrop(s) falharam. A torneira da Devnet e limitada por IP e"
            "\nrecusa pedidos seguidos. Espere alguns minutos e rode de novo, ou use"
            "\n  solana airdrop 1 <endereco> --url devnet"
        )
        return 1
    print("\nFinanciamento concluido. Rode 'checar' para confirmar.")
    return 0


def cmd_registrar(args) -> int:
    """Registra na chain os participantes que ainda nao existem."""
    import asyncio

    from solders.pubkey import Pubkey

    from anchor_client import (
        IX_REGISTER,
        AnchorLedger,
        derive_simulation_keypairs,
        pda_config,
        pda_participant,
    )

    chaves = carteiras(args.participants, args.seed)
    reg = registrados(args.rpc, chaves, args.program_id)
    faltando = [cid for cid, ok in reg.items() if not ok]

    if not faltando:
        print("Todos os participantes ja estao registrados.")
        return 0

    saldo = saldos(args.rpc, chaves)
    sem_saldo = [cid for cid in faltando if saldo[cid] < SALDO_MINIMO]
    if sem_saldo:
        print(f"Participantes {sem_saldo} sem saldo. Rode 'financiar' primeiro.", file=sys.stderr)
        return 1

    ledger = AnchorLedger(
        authority=derive_simulation_keypairs(1, seed=args.seed)[0],  # nao assina nada aqui
        participant_keys=chaves,
        program_id=args.program_id,
        rpc_url=args.rpc,
    )
    pid = Pubkey.from_string(args.program_id)

    print(f"Registrando {len(faltando)} participante(s)...\n")
    for cid in faltando:
        kp = chaves[cid]
        contas = {
            "config": pda_config(pid),
            "participant": pda_participant(pid, kp.pubkey()),
            "owner": kp.pubkey(),
            "system_program": __import__("solders.system_program", fromlist=["ID"]).ID,
        }
        try:
            sig = asyncio.run(ledger._envia(kp, IX_REGISTER, [], contas))
            print(f"  [{cid}] {kp.pubkey()}  ok  {sig[:24]}...")
        except Exception as e:
            print(f"  [{cid}] {kp.pubkey()}  FALHOU: {str(e)[:90]}")
            return 1
        time.sleep(args.intervalo)

    print("\nRegistro concluido. Rode 'checar' para confirmar.")
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv=None) -> int:
    from onchain_interface import DEVNET_PROGRAM_ID

    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("comando", choices=["checar", "plano", "financiar", "registrar"])
    p.add_argument("--participants", type=int, default=3, help="quantas instituicoes simuladas")
    p.add_argument("--rounds", type=int, default=3, help="rodadas previstas (subcomando 'plano')")
    p.add_argument("--seed", type=int, default=42,
                   help="MESMA seed do experimento - e dela que as carteiras derivam")
    p.add_argument("--rpc", default="https://api.devnet.solana.com")
    p.add_argument("--program-id", default=DEVNET_PROGRAM_ID)
    p.add_argument("--airdrop", type=float, default=1.0, help="SOL por pedido de airdrop")
    p.add_argument("--saldo-alvo", type=float, default=SALDO_MINIMO,
                   help="abaixo disso, a carteira e financiada")
    p.add_argument("--intervalo", type=float, default=1.5,
                   help="pausa entre chamadas, para nao bater no limite do RPC publico")
    args = p.parse_args(argv)

    if args.comando != "plano":
        _exige_deps()

    return {
        "checar": cmd_checar,
        "plano": cmd_plano,
        "financiar": cmd_financiar,
        "registrar": cmd_registrar,
    }[args.comando](args)


if __name__ == "__main__":
    sys.exit(main())
