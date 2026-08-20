"""Mede o vies do detector contra participantes com poucos dados.

Por que este script existe
--------------------------
A varredura de 10 seeds produziu um falso positivo: um participante honesto
banido permanentemente. A causa nao foi distribuicao atipica - era o
participante com a distribuicao MAIS equilibrada da federacao - e sim tamanho:
436 amostras contra 2.149 do maior.

O mecanismo e aritmetico, nao estatistico:

    436 amostras / lote 32   = ~14 passos de SGD
    2.149 amostras / lote 32 = ~67 passos de SGD

O ruido da direcao estimada cai com a raiz do numero de passos, entao o update
do participante pequeno chega com ~2,2x mais ruido angular. O cosseno contra o
consenso desaba - mesmo com a direcao verdadeira dele perfeitamente correta. O
detector nao distingue "malicioso" de "pequeno demais para produzir um update
estavel", porque as duas coisas produzem o mesmo sintoma.

Este script quantifica o efeito e compara as configuracoes que tentam corrigi-lo.

Uso::

    python analise_tamanho.py results_sweep
    python analise_tamanho.py results_sweep results_fix_passos results_fix_suave
    python analise_tamanho.py --limiar 800 --por-rodada results_sweep

Espera diretorios no formato produzido pelo `sweep.py`:
`<dir>/seed<NN>_<rotulo>/{resultados.json,ledger_C.json}`.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

from data import build_partitions, load_dataset
from utils import set_seed

# Abaixo deste numero de amostras o update passa a ser dominado por ruido de
# amostragem. Valor empirico, obtido da propria varredura - nao e uma constante
# universal: depende do lote, do modelo e de quantos passos cabem numa epoca.
LIMIAR_PEQUENO = 600

PADRAO_SEED = re.compile(r"seed(\d+)_")


def tamanhos_das_particoes(seed: int, num_clients: int, cfg: dict) -> Dict[int, int]:
    """Reconstroi a particao daquela seed para saber quantas amostras cada um teve.

    A particao nao e salva no resultado (seriam megabytes), mas e deterministica:
    a mesma seed reproduz exatamente a mesma divisao.
    """
    dados = cfg["data"]
    set_seed(seed)
    xtr, ytr, _, _ = load_dataset(
        dataset=dados["dataset"],
        data_dir=dados["data_dir"],
        train_subset=int(dados["train_subset"]),
        test_subset=int(dados["test_subset"]),
        seed=seed,
    )
    parts = build_partitions(
        xtr, ytr,
        num_clients=num_clients,
        partition=dados["partition"],
        dirichlet_alpha=float(dados["dirichlet_alpha"]),
        seed=seed,
    )
    return {cid: sum(p.class_histogram().values()) for cid, p in enumerate(parts)}


def coleta(diretorio: Path, limiar: int) -> Optional[dict]:
    """Junta, para um diretorio de varredura, o S de cada honesto e o tamanho dele."""
    execucoes = sorted(diretorio.glob("seed*_*"))
    if not execucoes:
        return None

    pequenos: List[float] = []
    grandes: List[float] = []
    por_rodada: Dict[int, List[float]] = {}
    precisoes: List[float] = []
    falsos_positivos: List[Tuple[int, int, int]] = []  # (seed, participante, n_amostras)

    for pasta in execucoes:
        arq = pasta / "resultados.json"
        ledger = pasta / "ledger_C.json"
        if not (arq.exists() and ledger.exists()):
            continue
        casamento = PADRAO_SEED.search(pasta.name)
        if not casamento:
            continue
        seed = int(casamento.group(1))

        resultado = json.loads(arq.read_text(encoding="utf-8"))
        cenario = resultado["scenarios"].get("C")
        if not cenario:
            continue
        maliciosos = set(cenario["malicious_ids"])
        deteccao = resultado.get("deteccao") or {}
        if deteccao.get("precision") is not None:
            precisoes.append(float(deteccao["precision"]))

        tamanhos = tamanhos_das_particoes(
            seed, int(resultado["config"]["federation"]["num_clients"]), resultado["config"]
        )

        banidos = {int(k) for k in (cenario.get("ban_events") or {})}
        for cid in banidos - maliciosos:
            falsos_positivos.append((seed, cid, tamanhos.get(cid, -1)))

        blocos = json.loads(ledger.read_text(encoding="utf-8"))
        acumulado: Dict[int, List[float]] = {}
        for contribuicao in blocos["contributions"]:
            cid = contribuicao["participant_id"]
            if contribuicao.get("score") is None or cid in maliciosos:
                continue
            acumulado.setdefault(cid, []).append(float(contribuicao["score"]))
            if tamanhos.get(cid, 10**9) < limiar:
                por_rodada.setdefault(contribuicao["round_number"], []).append(
                    float(contribuicao["score"])
                )

        for cid, notas in acumulado.items():
            destino = pequenos if tamanhos.get(cid, 10**9) < limiar else grandes
            destino.append(float(np.mean(notas)))

    return {
        "nome": diretorio.name,
        "pequenos": pequenos,
        "grandes": grandes,
        "por_rodada": {r: float(np.mean(v)) for r, v in sorted(por_rodada.items())},
        "precisao": float(np.mean(precisoes)) if precisoes else float("nan"),
        "falsos_positivos": falsos_positivos,
    }


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("diretorios", nargs="+", type=Path, help="pastas geradas pelo sweep.py")
    p.add_argument("--limiar", type=int, default=LIMIAR_PEQUENO,
                   help="abaixo deste numero de amostras o participante conta como 'pequeno'")
    p.add_argument("--por-rodada", action="store_true",
                   help="detalha o S dos pequenos rodada a rodada")
    args = p.parse_args(argv)

    coletas = [c for c in (coleta(d, args.limiar) for d in args.diretorios) if c]
    if not coletas:
        print("Nenhuma execucao encontrada. Rode o sweep.py primeiro.", file=sys.stderr)
        return 1

    n_peq = len(coletas[0]["pequenos"])
    n_gra = len(coletas[0]["grandes"])

    print(f"\nParticipantes HONESTOS, agrupados por tamanho da particao (corte: {args.limiar} amostras)")
    print(f"S medio ao longo de toda a execucao | n = {n_peq} pequenos, {n_gra} grandes\n")
    print(f"{'configuracao':<26}{'S pequenos':>12}{'S grandes':>12}{'lacuna':>9}{'precisao':>10}{'falsos+':>9}")
    print("-" * 78)
    for c in coletas:
        mp = float(np.mean(c["pequenos"])) if c["pequenos"] else float("nan")
        mg = float(np.mean(c["grandes"])) if c["grandes"] else float("nan")
        print(f"{c['nome']:<26}{mp:>12.3f}{mg:>12.3f}{mg - mp:>9.3f}"
              f"{c['precisao']:>10.2f}{len(c['falsos_positivos']):>9}")

    for c in coletas:
        for seed, cid, n in c["falsos_positivos"]:
            print(f"\n  ! {c['nome']}: participante {cid} da seed {seed} banido por engano "
                  f"({n} amostras)")

    if args.por_rodada:
        print("\n\nS medio dos participantes pequenos, rodada a rodada")
        rodadas = sorted({r for c in coletas for r in c["por_rodada"]})
        cabecalho = f"{'rodada':>7}" + "".join(f"{c['nome'][:14]:>16}" for c in coletas)
        print("\n" + cabecalho)
        print("-" * len(cabecalho))
        for r in rodadas:
            linha = f"{r:>7}"
            for c in coletas:
                v = c["por_rodada"].get(r)
                linha += f"{v:>16.3f}" if v is not None else f"{'-':>16}"
            print(linha)

    print("\nLeitura: 'lacuna' proxima de zero significa que o detector deixou de "
          "\npenalizar o participante por ser pequeno. Ela precisa cair SEM que a "
          "\nprecisao ou o recall da deteccao caiam junto - senao a correcao virou "
          "\numa brecha.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
