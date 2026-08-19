"""Geracao de graficos e do relatorio comparativo dos cenarios A/B/C.

Separado do `run_experiments.py` para que a orquestracao do experimento fique
legivel e para que os graficos possam ser regerados a partir do JSON sem
retreinar nada.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Dict, List, Optional

import matplotlib

matplotlib.use("Agg")  # backend sem janela: roda em servidor/CI sem display
import matplotlib.pyplot as plt  # noqa: E402

from server import History  # noqa: E402

logger = logging.getLogger("awakefl.report")

CORES = {"A": "#2e7d32", "B": "#c62828", "C": "#1565c0"}
NOMES = {
    "A": "A - baseline (sem atacante)",
    "B": "B - ataque (sem defesa)",
    "C": "C - defesa (reputacao + banimento)",
}


# ---------------------------------------------------------------------------
# Graficos
# ---------------------------------------------------------------------------


def plot_convergence(histories: Dict[str, History], path: Path) -> Path:
    """Curvas de convergencia (acuracia e perda) dos tres cenarios lado a lado."""
    fig, (ax_acc, ax_loss) = plt.subplots(1, 2, figsize=(13, 5))

    for key, hist in histories.items():
        rounds = [r.round_number for r in hist.rounds]
        ax_acc.plot(rounds, [a * 100 for a in hist.accuracies], marker="o", ms=4,
                    color=CORES.get(key), label=NOMES.get(key, key))
        ax_loss.plot(rounds, hist.losses, marker="o", ms=4,
                     color=CORES.get(key), label=NOMES.get(key, key))

    # Marca as rodadas de banimento do cenario C: e onde a curva azul deve virar.
    hist_c = histories.get("C")
    if hist_c is not None:
        for cid, rnd in hist_c.ban_events().items():
            ax_acc.axvline(rnd, color=CORES["C"], ls="--", alpha=0.35, lw=1)
            ax_acc.annotate(
                f"ban p{cid}",
                xy=(rnd, ax_acc.get_ylim()[0]),
                xytext=(rnd, ax_acc.get_ylim()[0] + 2),
                fontsize=7,
                color=CORES["C"],
                rotation=90,
            )

    ax_acc.set_title("Acuracia do modelo global por rodada")
    ax_acc.set_xlabel("Rodada")
    ax_acc.set_ylabel("Acuracia (%)")
    ax_acc.grid(alpha=0.3)
    ax_acc.legend(fontsize=8)

    ax_loss.set_title("Perda do modelo global por rodada")
    ax_loss.set_xlabel("Rodada")
    ax_loss.set_ylabel("Cross-entropy")
    ax_loss.grid(alpha=0.3)
    ax_loss.legend(fontsize=8)

    fig.suptitle("AwakeFL - convergencia sob ataque e sob defesa", fontweight="bold")
    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=150)
    plt.close(fig)
    logger.info("Grafico de convergencia salvo em %s", path)
    return path


def plot_reputation(history: History, path: Path, title: Optional[str] = None) -> Path:
    """Evolucao da reputacao de cada participante (vermelho = malicioso)."""
    if history.ledger is None:
        raise ValueError("Historico sem ledger de reputacao.")

    fig, ax = plt.subplots(figsize=(9, 5))
    malicious = set(history.malicious_ids)
    for cid, serie in history.reputation_series().items():
        ax.plot(
            range(len(serie)),
            serie,
            color="#c62828" if cid in malicious else "#90a4ae",
            lw=2.0 if cid in malicious else 1.2,
            alpha=1.0 if cid in malicious else 0.7,
            label=f"p{cid} {'(malicioso)' if cid in malicious else ''}".strip(),
        )

    threshold = history.ledger.ban_threshold
    ax.axhline(threshold, color="black", ls="--", lw=1,
               label=f"limiar de banimento ({threshold})")
    ax.set_ylim(-0.02, 1.05)
    ax.set_xlabel("Rodada")
    ax.set_ylabel("Reputacao R(t)")
    ax.set_title(title or f"Reputacao por participante - cenario {history.scenario}")
    ax.grid(alpha=0.3)
    ax.legend(fontsize=7, ncol=2)
    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=150)
    plt.close(fig)
    logger.info("Grafico de reputacao salvo em %s", path)
    return path


# ---------------------------------------------------------------------------
# Relatorio
# ---------------------------------------------------------------------------


def _fmt_pct(value: Optional[float]) -> str:
    return "-" if value is None else f"{value * 100:.2f}%"


def build_summary(histories: Dict[str, History], config: dict) -> dict:
    """Consolida as metricas comparativas dos tres cenarios em um dict serializavel."""
    a, b, c = histories.get("A"), histories.get("B"), histories.get("C")
    summary: dict = {"config": config, "scenarios": {k: h.to_dict() for k, h in histories.items()}}

    if a and b:
        summary["degradacao_ataque_pp"] = round((a.final_accuracy - b.final_accuracy) * 100, 2)
    if b and c:
        summary["recuperacao_defesa_pp"] = round((c.final_accuracy - b.final_accuracy) * 100, 2)
    if a and c:
        summary["gap_para_baseline_pp"] = round((a.final_accuracy - c.final_accuracy) * 100, 2)

    if c and c.ledger is not None:
        summary["deteccao"] = c.ledger.detection_metrics(c.malicious_ids)
        summary["rodadas_ate_detectar"] = {
            str(k): v for k, v in c.ledger.rounds_to_detect(c.malicious_ids).items()
        }
        summary["banidos"] = c.ledger.banned_ids
        summary["cadeia_integra"] = bool(c.chain.verify_chain()) if c.chain else None
    return summary


def build_markdown(histories: Dict[str, History], summary: dict, images: Dict[str, Path]) -> str:
    """Monta o relatorio em Markdown que vai para `results/relatorio.md`."""
    cfg = summary["config"]
    a, b, c = histories.get("A"), histories.get("B"), histories.get("C")
    lines: List[str] = []

    lines.append("# AwakeFL - Relatorio comparativo (cenarios A / B / C)\n")
    lines.append("## 1. Configuracao do experimento\n")
    lines.append("| Parametro | Valor |")
    lines.append("| --- | --- |")
    lines.append(f"| Dataset | {cfg['data']['dataset']} ({cfg['data']['partition']}) |")
    lines.append(f"| Participantes | {cfg['federation']['num_clients']} |")
    lines.append(f"| Rodadas | {cfg['federation']['rounds']} |")
    lines.append(f"| Epocas locais | {cfg['federation']['local_epochs']} |")
    lines.append(f"| Ataque | `{cfg['attack']['type']}` |")
    lines.append(f"| Participantes maliciosos | {summary['scenarios'].get('B', {}).get('malicious_ids')} |")
    rep_cfg = cfg["reputation"]
    inicial = rep_cfg.get("initial", 0.5)
    lines.append(
        f"| Reputacao inicial | {inicial} "
        f"(= {int(round(inicial * 1000))} na escala 0..1000 do Anchor) |"
    )
    lines.append(f"| Limiar de banimento | {rep_cfg['ban_threshold']} |")
    lines.append(
        f"| Graca | {rep_cfg.get('grace_rounds', 2)} primeiras contribuicoes de cada participante |"
    )
    lines.append(f"| Formula | R(t) = {rep_cfg['alpha']}*R(t-1) + {round(1 - rep_cfg['alpha'], 3)}*S(t) |")
    lines.append(f"| Seed | {cfg['seed']} |\n")

    lines.append("## 2. Resultado final\n")
    lines.append("| Cenario | Acuracia final | Melhor acuracia | Perda final | Banidos |")
    lines.append("| --- | --- | --- | --- | --- |")
    for key in ("A", "B", "C"):
        h = histories.get(key)
        if not h:
            continue
        banned = h.ledger.banned_ids if h.ledger else []
        lines.append(
            f"| {NOMES[key]} | {_fmt_pct(h.final_accuracy)} | {_fmt_pct(h.best_accuracy)} | "
            f"{h.losses[-1]:.4f} | {banned or '-'} |"
        )
    lines.append("")

    if "degradacao_ataque_pp" in summary:
        lines.append(
            "- **Queda de acuracia causada pelo ataque (A -> B):** "
            f"{summary['degradacao_ataque_pp']:.2f} pontos percentuais "
            "(quanto maior, mais eficaz foi o ataque)."
        )
    if "recuperacao_defesa_pp" in summary:
        lines.append(
            "- **Acuracia recuperada pela defesa (B -> C):** "
            f"{summary['recuperacao_defesa_pp']:+.2f} pontos percentuais."
        )
    if "gap_para_baseline_pp" in summary:
        lines.append(
            "- **Distancia que ainda separa C do baseline (A -> C):** "
            f"{summary['gap_para_baseline_pp']:.2f} pontos percentuais "
            "(custo residual da defesa; idealmente proximo de zero)."
        )
    lines.append("")

    if "deteccao" in summary:
        d = summary["deteccao"]
        lines.append("## 3. Qualidade da deteccao (cenario C)\n")
        lines.append("| Metrica | Valor |")
        lines.append("| --- | --- |")
        lines.append(f"| Precisao | {d['precision']:.2f} |")
        lines.append(f"| Recall | {d['recall']:.2f} |")
        lines.append(f"| F1 | {d['f1']:.2f} |")
        lines.append(f"| Verdadeiros positivos | {d['true_positives']} |")
        lines.append(f"| Falsos positivos | {d['false_positives']} |")
        lines.append(f"| Falsos negativos | {d['false_negatives']} |\n")
        lines.append("**Rodadas ate a deteccao de cada atacante:**\n")
        lines.append("| Participante | Rodada do banimento |")
        lines.append("| --- | --- |")
        for cid, rnd in summary["rodadas_ate_detectar"].items():
            lines.append(f"| {cid} | {rnd if rnd is not None else 'nao detectado'} |")
        lines.append("")

    if c is not None and c.attack_type == "backdoor":
        lines.append("## 3b. Taxa de sucesso do backdoor (ASR)\n")
        lines.append("| Cenario | ASR final |")
        lines.append("| --- | --- |")
        for key in ("B", "C"):
            h = histories.get(key)
            if h and h.rounds and h.rounds[-1].backdoor_asr is not None:
                lines.append(f"| {NOMES[key]} | {_fmt_pct(h.rounds[-1].backdoor_asr)} |")
        lines.append("")

    lines.append("## 4. Curvas\n")
    for caption, path in images.items():
        lines.append(f"**{caption}**\n")
        lines.append(f"![{caption}]({Path(path).name})\n")

    lines.append("## 5. Livro-razao simulado\n")
    if c and c.chain:
        lines.append(f"- Blocos registrados no cenario C: **{len(c.chain._chain)}**")
        lines.append(f"- Contribuicoes com hash SHA-256: **{len(c.chain.contributions)}**")
        lines.append(f"- Eventos de banimento: **{len(c.chain.bans)}**")
        lines.append(f"- Integridade da cadeia verificada: **{summary.get('cadeia_integra')}**")
        lines.append("- Exportacao completa: `ledger_C.json`\n")

    lines.append("## 6. Como interpretar\n")
    lines.append(
        "1. **A vs B** prova que o ataque funciona: se a acuracia de B nao cair, o ataque "
        "esta fraco demais (aumente `malicious_fraction` ou `poison_scale`).\n"
        "2. **B vs C** prova que a defesa funciona: a curva de C deve descolar de B logo "
        "apos as linhas tracejadas (rodadas de banimento) e se aproximar de A.\n"
        "3. **Precisao/recall** medem o custo da defesa: recall 1.0 com precisao 1.0 = todos "
        "os atacantes banidos e nenhum honesto punido. Precisao < 1.0 indica falso positivo, "
        "normalmente sintoma de particao nao-IID agressiva (`dirichlet_alpha` baixo) ou de "
        "`ban_threshold` alto demais.\n"
        "4. **Curva de reputacao** mostra o mecanismo: R(t) do atacante decai geometricamente "
        "por causa da media movel, cruza o limiar e e dividida por 10 no banimento.\n"
    )
    return "\n".join(lines)


def save_report(
    histories: Dict[str, History], config: dict, results_dir: Path
) -> Dict[str, Path]:
    """Gera PNGs + relatorio.md + resultados.json. Retorna os caminhos criados."""
    results_dir = Path(results_dir)
    results_dir.mkdir(parents=True, exist_ok=True)

    images: Dict[str, Path] = {}
    images["Convergencia (A/B/C)"] = plot_convergence(histories, results_dir / "convergencia.png")
    for key in ("B", "C"):
        h = histories.get(key)
        if h is not None and h.ledger is not None:
            images[f"Reputacao - cenario {key}"] = plot_reputation(
                h, results_dir / f"reputacao_{key}.png"
            )

    summary = build_summary(histories, config)
    (results_dir / "resultados.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (results_dir / "relatorio.md").write_text(
        build_markdown(histories, summary, images), encoding="utf-8"
    )

    for key, h in histories.items():
        if h.chain is not None:
            h.chain.export_json(results_dir / f"ledger_{key}.json")

    paths = {"relatorio": results_dir / "relatorio.md", "json": results_dir / "resultados.json"}
    paths.update({k: Path(v) for k, v in images.items()})
    return paths
