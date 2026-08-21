"""Publica as avaliacoes do agregador para o painel web consumir.

Por que isto existe
-------------------
A tela do validador tinha um campo onde a autoridade DIGITAVA o score. Isso
contradizia o desenho inteiro: se um humano escolhe a nota no olho, a frase "o
sistema julga a contribuicao, nao a declaracao" deixa de ser verdade - quem
julgou foi uma pessoa.

Pior: uma nota digitada **nao pode ser contestada**. Nao ha o que recalcular. Ja
uma nota que sai de uma funcao deterministica e publica, aplicada a artefatos
publicados, pode ser refeita por qualquer um. Automatizar o score nao e um
detalhe de usabilidade - e o pre-requisito da contestabilidade.

Este script transforma o livro-razao de um experimento no arquivo que o painel
le. A chave e o **hash da contribuicao**, e nao o id do participante: o hash e o
que esta gravado na conta on-chain, entao a tela consegue ligar uma contribuicao
pendente a sua avaliacao sem precisar de nenhum mapeamento de carteiras.

    python publicar_avaliacoes.py results_demo
    python publicar_avaliacoes.py results_demo --saida ../web/public/avaliacoes.json

O arquivo carrega DUAS coisas, de autores diferentes, e o painel as trata de
formas diferentes:

* `declarado`  - o que a INSTITUICAO afirmou (amostras, loss, acuracia).
  Serve para preencher o formulario de contribuicao sem digitacao manual.
* `avaliacao`  - o que o AGREGADOR calculou (score e a conta que levou a ele).
  Serve para a tela do validador mostrar a nota e o porque, sem ninguem opinar.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

PROGRAM_MAX_REPUTATION = 1_000
# Metade da escala e o limiar entre Aprovado e Rejeitado no programa
# (`score >= MAX_REPUTATION / 2` em lib.rs).
LIMIAR_APROVACAO = PROGRAM_MAX_REPUTATION // 2

# Os dois lugares que este script toca sao FIXOS: le de uma pasta de resultados
# dentro de awakefl-fl/, escreve em web/public/. O usuario escolhe o *nome* de
# cada um, nunca o lugar — ver `nome_simples` la embaixo.
RAIZ_FL = Path(__file__).resolve().parent
DESTINO_DIR = RAIZ_FL.parent / "web" / "public"
NOME_PADRAO = "avaliacoes.json"


def nome_simples(valor: str) -> str:
    """Reduz o argumento ao nome final, sem diretorio nenhum.

    E a forma mais curta de nao ter caminho vindo de fora: em vez de validar
    o que o usuario mandou, descartamos a parte que poderia escapar. O que
    sobra so pode ser um item direto da pasta fixa correspondente.
    """
    nome = Path(str(valor)).name
    if not nome or nome in {".", ".."}:
        raise ValueError(f"nome invalido: {valor!r}")
    return nome


def para_escala_do_programa(valor: float) -> int:
    return int(round(max(0.0, min(1.0, valor)) * PROGRAM_MAX_REPUTATION))


def construir(ledger: dict, cenario: str) -> dict:
    registros: dict = {}
    for c in ledger.get("contributions", []):
        if c.get("score") is None:
            continue
        score = para_escala_do_programa(c["score"])
        metricas = c.get("metrics") or {}
        registros[c["weights_hash"]] = {
            "rodada": c["round_number"],
            "participante": c["participant_id"],
            "declarado": {
                "n_samples": c["num_examples"],
                "loss": round(float(metricas.get("train_loss", 0.0)), 6),
                # A chain guarda acuracia como fracao; a tela pede porcentagem.
                "accuracy": round(float(metricas.get("train_accuracy", 0.0)), 6),
            },
            "avaliacao": {
                "score": score,
                "aprovado": score >= LIMIAR_APROVACAO,
                "justificativa": c.get("score_breakdown"),
            },
        }
    return {
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "programa": ledger.get("program_id", ""),
        "cenario": cenario,
        "total": len(registros),
        "por_hash": registros,
    }


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("diretorio", help="pasta de resultados dentro de awakefl-fl/ (ex.: results_demo)")
    p.add_argument("--cenario", default="C", choices=["A", "B", "C"])
    p.add_argument("--saida", default=NOME_PADRAO, help="nome do arquivo gerado em web/public/")
    args = p.parse_args(argv)

    # `nome_simples` joga fora qualquer diretorio que venha no argumento, entao
    # nao existe caminho a validar: o lugar e sempre o mesmo, o usuario so
    # escolhe o nome. `--saida ../../../etc/passwd` vira `passwd` aqui dentro.
    origem = RAIZ_FL / nome_simples(args.diretorio) / f"ledger_{args.cenario}.json"
    destino = DESTINO_DIR / nome_simples(args.saida)
    if not origem.exists():
        print(f"{origem} nao existe. Rode o experimento primeiro.", file=sys.stderr)
        return 1

    ledger = json.loads(origem.read_text(encoding="utf-8"))
    saida = construir(ledger, args.cenario)

    if not saida["por_hash"]:
        print("Nenhuma contribuicao pontuada no livro-razao.", file=sys.stderr)
        return 1

    sem_justificativa = [
        h for h, v in saida["por_hash"].items() if not v["avaliacao"]["justificativa"]
    ]

    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(json.dumps(saida, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"{saida['total']} avaliacoes publicadas em {destino}")
    if sem_justificativa:
        print(
            f"  aviso: {len(sem_justificativa)} sem justificativa - o experimento e "
            "anterior ao score_breakdown. Rode de novo para a tela poder explicar a nota."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
