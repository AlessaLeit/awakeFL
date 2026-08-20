"""Varredura experimental do AwakeFL: multiplas seeds e multiplos ataques.

Por que este arquivo existe
---------------------------
Um experimento com UMA seed e uma anedota, nao um resultado. A diferenca entre
"a defesa recuperou 14 pontos percentuais" e "a defesa recuperou 14,2 +- 1,3 pp
em 10 execucoes independentes" e a diferenca entre uma demonstracao e uma
evidencia defensavel em banca.

Este modulo nao reimplementa nada: ele chama o `run_experiments.main()` com
seeds diferentes, coleta os `resultados.json` de cada execucao e agrega. Assim
nao existe risco de a varredura e o experimento principal divergirem.

Uso::

    python sweep.py                                   # 10 seeds, ataque do config
    python sweep.py --seeds 5
    python sweep.py --attacks label_flipping backdoor --seeds 5
    python sweep.py --seed-list 1 7 42 99            # seeds especificas

Saidas em `results_sweep/`::

    seed<NN>_<ataque>/         execucao individual (relatorio, graficos, ledger)
    sumario.json               todas as metricas agregadas
    sumario.md                 tabelas prontas para o texto da IC
    convergencia_media.png     curva media com faixa de +-1 desvio padrao
"""

from __future__ import annotations

import argparse
import json
import logging
import statistics
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Sequence

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

import run_experiments
from utils import setup_logging

logger = logging.getLogger("awakefl.sweep")

CENARIOS = ("A", "B", "C")
NOMES = {"A": "A - baseline", "B": "B - ataque", "C": "C - defesa"}
CORES = {"A": "#2f7d0a", "B": "#c2410c", "D": "#666", "C": "#1d4ed8"}


# ---------------------------------------------------------------------------
# Estatistica
# ---------------------------------------------------------------------------


def media_dp(valores: Sequence[float]) -> tuple[float, float]:
    """Media e desvio padrao AMOSTRAL (n-1).

    Usamos o amostral e nao o populacional porque as seeds sao uma amostra do
    universo de inicializacoes possiveis, nao a populacao inteira. Com n < 2 o
    desvio nao existe; devolvemos 0.0 para o relatorio nao quebrar.
    """
    vs = [float(v) for v in valores if v is not None and np.isfinite(v)]
    if not vs:
        return float("nan"), 0.0
    if len(vs) < 2:
        return vs[0], 0.0
    return statistics.mean(vs), statistics.stdev(vs)


def _fmt(media: float, dp: float, pct: bool = True) -> str:
    if not np.isfinite(media):
        return "-"
    if pct:
        return f"{media * 100:.2f}% ± {dp * 100:.2f}"
    return f"{media:.2f} ± {dp:.2f}"


# ---------------------------------------------------------------------------
# Execucao
# ---------------------------------------------------------------------------


def roda_uma(seed: int, ataque: Optional[str], destino: Path, extra: List[str]) -> Optional[dict]:
    """Executa um experimento completo e devolve o `resultados.json` lido."""
    argv = ["--seed", str(seed), "--results-dir", str(destino), *extra]
    if ataque:
        argv += ["--attack", ataque]

    t0 = time.time()
    codigo = run_experiments.main(argv)
    if codigo != 0:
        logger.error("seed %d / %s falhou (codigo %d)", seed, ataque, codigo)
        return None

    arquivo = destino / "resultados.json"
    if not arquivo.exists():
        logger.error("seed %d: %s nao foi gerado", seed, arquivo)
        return None
    logger.info("seed %d / %s concluida em %.0fs", seed, ataque or "config", time.time() - t0)
    return json.loads(arquivo.read_text(encoding="utf-8"))


def agrega(execucoes: List[dict]) -> dict:
    """Consolida as metricas de N execucoes de um mesmo ataque."""
    if not execucoes:
        return {}

    resumo: dict = {"n_execucoes": len(execucoes)}

    for chave in CENARIOS:
        finais = [e["scenarios"][chave]["final_accuracy"] for e in execucoes if chave in e["scenarios"]]
        melhores = [e["scenarios"][chave]["best_accuracy"] for e in execucoes if chave in e["scenarios"]]
        if not finais:
            continue
        m, d = media_dp(finais)
        mb, db = media_dp(melhores)
        resumo[chave] = {
            "acuracia_final_media": round(m, 6),
            "acuracia_final_dp": round(d, 6),
            "acuracia_melhor_media": round(mb, 6),
            "acuracia_melhor_dp": round(db, 6),
            "valores": [round(v, 6) for v in finais],
        }

    # Efeitos - calculados POR EXECUCAO e so depois agregados. Fazer a diferenca
    # das medias esconderia a variabilidade do proprio efeito, que e o numero
    # que interessa para dizer se a defesa funciona de forma consistente.
    quedas, ganhos = [], []
    for e in execucoes:
        s = e["scenarios"]
        if "A" in s and "B" in s:
            quedas.append(s["A"]["final_accuracy"] - s["B"]["final_accuracy"])
        if "B" in s and "C" in s:
            ganhos.append(s["C"]["final_accuracy"] - s["B"]["final_accuracy"])
    if quedas:
        m, d = media_dp(quedas)
        resumo["queda_ataque_pp"] = {"media": round(m * 100, 4), "dp": round(d * 100, 4)}
    if ganhos:
        m, d = media_dp(ganhos)
        resumo["ganho_defesa_pp"] = {"media": round(m * 100, 4), "dp": round(d * 100, 4)}

    # Deteccao no cenario C.
    precisoes, recalls, f1s, latencias, banidos_por_exec = [], [], [], [], []
    for e in execucoes:
        c = e["scenarios"].get("C")
        if not c:
            continue
        det = e.get("deteccao") or {}
        precisoes.append(det.get("precision"))
        recalls.append(det.get("recall"))
        f1s.append(det.get("f1"))
        eventos = c.get("ban_events") or {}
        maliciosos = [str(m) for m in c.get("malicious_ids", [])]
        rodadas = [eventos[m] for m in maliciosos if m in eventos]
        latencias.extend(rodadas)
        banidos_por_exec.append(len(rodadas) / len(maliciosos) if maliciosos else 0.0)

    if any(p is not None for p in precisoes):
        mp, dp_ = media_dp([p for p in precisoes if p is not None])
        mr, dr = media_dp([r for r in recalls if r is not None])
        mf, df = media_dp([f for f in f1s if f is not None])
        ml, dl = media_dp(latencias)
        mb, db = media_dp(banidos_por_exec)
        resumo["deteccao"] = {
            "precisao": {"media": round(mp, 4), "dp": round(dp_, 4)},
            "recall": {"media": round(mr, 4), "dp": round(dr, 4)},
            "f1": {"media": round(mf, 4), "dp": round(df, 4)},
            "rodadas_ate_banir": {"media": round(ml, 3), "dp": round(dl, 3), "n": len(latencias)},
            "fracao_atacantes_banidos": {"media": round(mb, 4), "dp": round(db, 4)},
        }
    return resumo


# ---------------------------------------------------------------------------
# Saidas
# ---------------------------------------------------------------------------


def grafico_convergencia(execucoes: List[dict], destino: Path, titulo: str) -> Optional[Path]:
    """Curva media por rodada com faixa de +-1 desvio padrao.

    E a figura que substitui a curva de uma seed so no texto da IC: mostra
    simultaneamente o efeito medio e o quanto ele varia entre execucoes.
    """
    if not execucoes:
        return None

    fig, ax = plt.subplots(figsize=(9, 5))
    for chave in CENARIOS:
        series = [
            e["scenarios"][chave]["accuracy_per_round"]
            for e in execucoes
            if chave in e["scenarios"]
        ]
        if not series:
            continue
        n = min(len(s) for s in series)
        m = np.array([s[:n] for s in series], dtype=float)
        media, dp = m.mean(axis=0), m.std(axis=0, ddof=1 if len(series) > 1 else 0)
        x = np.arange(1, n + 1)
        cor = CORES[chave]
        ax.plot(x, media * 100, label=f"{NOMES[chave]} (n={len(series)})", color=cor, lw=2)
        ax.fill_between(x, (media - dp) * 100, (media + dp) * 100, color=cor, alpha=0.15)

    ax.set_xlabel("rodada")
    ax.set_ylabel("acuracia global (%)")
    ax.set_title(titulo)
    ax.grid(alpha=0.3)
    ax.legend()
    fig.tight_layout()
    destino.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(destino, dpi=150)
    plt.close(fig)
    logger.info("Grafico agregado salvo em %s", destino)
    return destino


def markdown(sumario: dict, seeds: Sequence[int]) -> str:
    linhas: List[str] = []
    linhas.append("# AwakeFL - Varredura experimental\n")
    linhas.append(
        f"Cada linha agrega **{len(seeds)} execucoes independentes** "
        f"(seeds {', '.join(map(str, seeds))}), com particao, inicializacao e "
        "amostragem diferentes. Valores sao media ± desvio padrao amostral.\n"
    )

    for ataque, resumo in sumario["ataques"].items():
        if not resumo:
            continue
        linhas.append(f"\n## Ataque: `{ataque}`\n")
        linhas.append("| Cenario | Acuracia final | Melhor acuracia |")
        linhas.append("| --- | --- | --- |")
        for chave in CENARIOS:
            if chave not in resumo:
                continue
            r = resumo[chave]
            linhas.append(
                f"| {NOMES[chave]} | {_fmt(r['acuracia_final_media'], r['acuracia_final_dp'])} | "
                f"{_fmt(r['acuracia_melhor_media'], r['acuracia_melhor_dp'])} |"
            )
        linhas.append("")

        if "queda_ataque_pp" in resumo:
            q = resumo["queda_ataque_pp"]
            linhas.append(f"- **Queda causada pelo ataque (A -> B):** {q['media']:.2f} ± {q['dp']:.2f} pp")
        if "ganho_defesa_pp" in resumo:
            g = resumo["ganho_defesa_pp"]
            linhas.append(f"- **Ganho da defesa (B -> C):** {g['media']:+.2f} ± {g['dp']:.2f} pp")

        det = resumo.get("deteccao")
        if det:
            linhas.append("\n| Metrica de deteccao | Valor |")
            linhas.append("| --- | --- |")
            linhas.append(f"| Precisao | {_fmt(det['precisao']['media'], det['precisao']['dp'], pct=False)} |")
            linhas.append(f"| Recall | {_fmt(det['recall']['media'], det['recall']['dp'], pct=False)} |")
            linhas.append(f"| F1 | {_fmt(det['f1']['media'], det['f1']['dp'], pct=False)} |")
            lat = det["rodadas_ate_banir"]
            linhas.append(f"| Rodadas ate banir | {lat['media']:.2f} ± {lat['dp']:.2f} (n={lat['n']}) |")
            fr = det["fracao_atacantes_banidos"]
            linhas.append(f"| Atacantes banidos | {fr['media'] * 100:.1f}% ± {fr['dp'] * 100:.1f} |")
        linhas.append("")

    linhas.append("\n## Como ler\n")
    linhas.append(
        "1. **Desvio pequeno na queda A->B** significa que o ataque e consistente, "
        "e nao um acidente de uma inicializacao infeliz.\n"
        "2. **Desvio pequeno no ganho B->C** e o resultado central: a defesa "
        "funciona sempre, nao em media.\n"
        "3. **Recall < 1** em alguma execucao aparece como desvio > 0 na tabela de "
        "deteccao - vale investigar aquela seed individualmente em "
        "`results_sweep/seed<NN>_<ataque>/`.\n"
        "4. **Rodadas ate banir** e a latencia da defesa: quantas rodadas o "
        "atacante conseguiu envenenar antes de ser pego.\n"
    )
    return "\n".join(linhas)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Varredura de seeds e ataques do AwakeFL.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("--seeds", type=int, default=10, help="quantas seeds (1, 2, 3, ...)")
    p.add_argument("--seed-list", type=int, nargs="+", help="seeds explicitas (ignora --seeds)")
    p.add_argument("--attacks", nargs="+", default=[None],
                   help="ataques a varrer; omitido = usa o do config.yaml")
    p.add_argument("--results-dir", type=Path, default=Path("./results_sweep"))
    p.add_argument("--rounds", type=int, help="repassado ao run_experiments")
    p.add_argument("--clients", type=int, help="repassado ao run_experiments")
    p.add_argument("--train-subset", type=int, help="repassado ao run_experiments")
    p.add_argument("--log-level", default="WARNING",
                   help="nivel das execucoes individuais (WARNING deixa a saida limpa)")
    return p.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    setup_logging("INFO")
    logging.getLogger("awakefl.sweep").setLevel(logging.INFO)

    seeds = args.seed_list or list(range(1, args.seeds + 1))
    destino = args.results_dir
    destino.mkdir(parents=True, exist_ok=True)

    extra: List[str] = ["--log-level", args.log_level]
    for flag, valor in (("--rounds", args.rounds), ("--clients", args.clients),
                        ("--train-subset", args.train_subset)):
        if valor is not None:
            extra += [flag, str(valor)]

    total = len(seeds) * len(args.attacks)
    logger.info("=" * 78)
    logger.info("VARREDURA | %d seeds x %d ataque(s) = %d execucoes", len(seeds), len(args.attacks), total)
    logger.info("=" * 78)

    t0 = time.time()
    sumario: dict = {"seeds": seeds, "ataques": {}}
    feitas = 0

    for ataque in args.attacks:
        rotulo = ataque or "config"
        execucoes: List[dict] = []
        for seed in seeds:
            feitas += 1
            logger.info("[%d/%d] seed=%d ataque=%s", feitas, total, seed, rotulo)
            saida = roda_uma(seed, ataque, destino / f"seed{seed:02d}_{rotulo}", extra)
            if saida:
                execucoes.append(saida)

        sumario["ataques"][rotulo] = agrega(execucoes)
        grafico_convergencia(
            execucoes,
            destino / f"convergencia_media_{rotulo}.png",
            f"AwakeFL - convergencia media ({rotulo}, n={len(execucoes)})",
        )

    (destino / "sumario.json").write_text(json.dumps(sumario, indent=2), encoding="utf-8")
    (destino / "sumario.md").write_text(markdown(sumario, seeds), encoding="utf-8")

    logger.info("=" * 78)
    logger.info("VARREDURA CONCLUIDA em %.0f min", (time.time() - t0) / 60)
    for rotulo, resumo in sumario["ataques"].items():
        if not resumo:
            continue
        g = resumo.get("ganho_defesa_pp", {})
        q = resumo.get("queda_ataque_pp", {})
        logger.info(
            "%-20s | queda A->B: %.2f ± %.2f pp | ganho B->C: %+.2f ± %.2f pp",
            rotulo, q.get("media", float("nan")), q.get("dp", 0),
            g.get("media", float("nan")), g.get("dp", 0),
        )
    logger.info("Sumario: %s", destino / "sumario.md")
    logger.info("=" * 78)
    return 0


if __name__ == "__main__":
    sys.exit(main())
