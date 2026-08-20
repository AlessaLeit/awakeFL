"""Gera o roteiro da demonstracao a partir de um experimento ja executado.

Para o pitch, cada passo na tela precisa de numeros exatos: qual arquivo subir,
qual hash tem que aparecer, quantas amostras informar, e qual score digitar na
tela do validador para a reputacao andar como no experimento. Calcular isso na
hora, ao vivo, e pedir para errar.

Este script le o `ledger_*.json` e os artefatos `.awfl` de um experimento e
imprime a sequencia inteira, ja conferindo que o hash do arquivo em disco bate
com o registrado - a mesma verificacao que o navegador vai fazer.

    python roteiro_demo.py results_demo

A reputacao mostrada e calculada com a MESMA aritmetica inteira do programa
Anchor (`(R + S) / 2`, truncando), partindo de INITIAL_REPUTATION = 500. E o
numero que vai aparecer na tela, nao o float da simulacao - os dois andam
juntos, mas quem manda no painel e o inteiro.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional

INITIAL_REPUTATION = 500
MAX_REPUTATION = 1000
PENALTY_DIVISOR = 10
CANONICAL_EXT = ".awfl"


def para_escala_do_programa(valor: float) -> int:
    """R in [0,1] -> 0..=1000, a escala que o programa aceita."""
    return int(round(max(0.0, min(1.0, valor)) * MAX_REPUTATION))


def ema_inteira(anterior: int, score: int) -> int:
    """`(R + S) / 2` com divisao inteira - identico ao `apply_ema` do state.rs."""
    return (anterior + score) // 2


def carrega(diretorio: Path, cenario: str) -> dict:
    caminho = diretorio / f"ledger_{cenario}.json"
    if not caminho.exists():
        raise SystemExit(f"{caminho} nao existe. Rode o experimento com --export-weights todas.")
    return json.loads(caminho.read_text(encoding="utf-8"))


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("diretorio", type=Path, help="pasta de resultados (ex.: results_demo)")
    p.add_argument("--cenario", default="C", choices=["A", "B", "C"])
    p.add_argument("--ao-vivo", type=int, default=None,
                   help="rodada a ser feita ao vivo no pitch (default: a do banimento)")
    args = p.parse_args(argv)

    led = carrega(args.diretorio, args.cenario)
    pesos_dir = args.diretorio / "pesos" / args.cenario
    contribuicoes = led["contributions"]
    bans = {b["participant_id"]: b["round_number"] for b in led["bans"]}
    indice = {(a["round_number"], a["participant_id"]): a for a in led.get("artifacts", [])}

    participantes = sorted({c["participant_id"] for c in contribuicoes})
    rodada_ao_vivo = args.ao_vivo or (min(bans.values()) if bans else max(c["round_number"] for c in contribuicoes))

    print("=" * 78)
    print("ROTEIRO DA DEMONSTRACAO")
    print("=" * 78)
    print(f"\nExperimento .......... {args.diretorio}  (cenario {args.cenario})")
    print(f"Participantes ........ {participantes}")
    print(f"Atacante(s) .......... {sorted(bans)} -> banido(s) na rodada {sorted(bans.values())}")
    print(f"Rodada AO VIVO ....... {rodada_ao_vivo}")
    print(f"Pre-carregar ......... rodadas 1 a {rodada_ao_vivo - 1}")

    # -- conferencia dos artefatos ------------------------------------------
    print("\n" + "-" * 78)
    print("1. CONFERENCIA DOS ARQUIVOS  (o navegador vai fazer a mesma conta)")
    print("-" * 78)
    conferidos, divergentes = 0, []
    for chave, art in sorted(indice.items()):
        caminho = pesos_dir / art["file"]
        if not caminho.exists():
            divergentes.append((art["file"], "arquivo ausente"))
            continue
        digest = hashlib.sha256(caminho.read_bytes()).hexdigest()
        if digest == art["weights_hash"]:
            conferidos += 1
        else:
            divergentes.append((art["file"], "hash divergente"))
    print(f"\n  {conferidos} artefato(s) conferem com o livro-razao.")
    for nome, motivo in divergentes:
        print(f"  ! {nome}: {motivo}")
    if not indice:
        print("  (nenhum artefato exportado - rode com --export-weights todas)")

    # -- reputacao rodada a rodada, na aritmetica do programa ---------------
    print("\n" + "-" * 78)
    print("2. REPUTACAO ON-CHAIN, RODADA A RODADA")
    print("-" * 78)
    print("\n   Como o programa calcula: R = (R + score) / 2, comecando em 500.")
    print("   O score voce digita na tela do validador.\n")

    reputacao: Dict[int, int] = {cid: INITIAL_REPUTATION for cid in participantes}
    banido: Dict[int, bool] = {cid: False for cid in participantes}
    linhas_por_rodada: Dict[int, List[str]] = {}

    for c in sorted(contribuicoes, key=lambda x: (x["round_number"], x["participant_id"])):
        r, cid = c["round_number"], c["participant_id"]
        if banido[cid] or c.get("score") is None:
            continue
        score = para_escala_do_programa(c["score"])
        antes = reputacao[cid]
        reputacao[cid] = ema_inteira(antes, score)
        marca = ""
        if bans.get(cid) == r:
            reputacao[cid] //= PENALTY_DIVISOR
            banido[cid] = True
            marca = "  <<< PENALIZAR: reputacao /10 e banimento permanente"
        linhas_por_rodada.setdefault(r, []).append(
            f"     P{cid}  score {score:>4}   reputacao {antes:>4} -> {reputacao[cid]:>4}{marca}"
        )

    for r in sorted(linhas_por_rodada):
        etiqueta = "  <-- AO VIVO" if r == rodada_ao_vivo else ""
        print(f"   Rodada {r}{etiqueta}")
        for linha in linhas_por_rodada[r]:
            print(linha)
        print()

    # -- o que digitar na rodada ao vivo ------------------------------------
    print("-" * 78)
    print(f"3. O QUE PREENCHER NA RODADA {rodada_ao_vivo}  (a que voce faz ao vivo)")
    print("-" * 78)
    for c in sorted(contribuicoes, key=lambda x: x["participant_id"]):
        if c["round_number"] != rodada_ao_vivo:
            continue
        cid = c["participant_id"]
        art = indice.get((rodada_ao_vivo, cid))
        metricas = c.get("metrics", {})
        papel = "ATACANTE" if cid in bans else "honesto"
        print(f"\n   Participante {cid}  ({papel})")
        print(f"     Origem do compromisso ... 'Arquivo de pesos local'")
        print(f"     Arquivo ................. {art['file'] if art else '(nao exportado)'}")
        print(f"     Hash esperado ........... {c['weights_hash']}")
        print(f"     No de amostras .......... {c['num_examples']}")
        print(f"     Training loss ........... {metricas.get('train_loss', 0):.4f}")
        acc = metricas.get("train_accuracy")
        if acc is not None:
            print(f"     Acuracia (%) ............ {acc * 100:.1f}")
        if c.get("score") is not None:
            print(f"     -> score no validador ... {para_escala_do_programa(c['score'])}")

    if bans:
        atacante = min(bans)
        print(f"\n   Depois de validar, penalize o participante {atacante} em /painel/validador.")
        print(f"   Ele fica banido para sempre e o proximo submit dele falha com")
        print(f"   ParticipantBanned - vale mostrar essa tentativa, e a prova mais direta.")

    print("\n" + "=" * 78)
    return 0 if not divergentes else 1


if __name__ == "__main__":
    sys.exit(main())
