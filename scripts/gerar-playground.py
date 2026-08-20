#!/usr/bin/env python3
"""Gera `playground/lib.rs` a partir do programa real.

O Solana Playground nao tem `Anchor.toml` nem multiplos modulos: espera um
`src/lib.rs` unico. Manter esse arquivo na mao significa manter DUAS copias do
programa — e duas copias divergem, sempre. Aqui ele passa a ser um artefato
gerado, e o CI confere que esta em dia.

Uso::

    python scripts/gerar-playground.py            # regrava playground/lib.rs
    python scripts/gerar-playground.py --check    # so verifica (usado no CI)

O que a geracao faz:

1. concatena `state.rs` dentro de `lib.rs`, no lugar do `pub mod state;`
   (o Playground nao resolve modulos irmaos);
2. troca o `declare_id!` pelo placeholder do Playground, que sincroniza o ID
   sozinho no build — deixar o ID da Devnet ali faria o deploy do Playground
   falhar com uma incompatibilidade dificil de diagnosticar;
3. carimba um cabecalho avisando que o arquivo e gerado.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
LIB = RAIZ / "programs" / "awakefl" / "src" / "lib.rs"
STATE = RAIZ / "programs" / "awakefl" / "src" / "state.rs"
DESTINO = RAIZ / "playground" / "lib.rs"

# ID padrao do Solana Playground. Ele reescreve isto no build.
PLAYGROUND_ID = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"

CABECALHO = """// ============================================================================
// ARQUIVO GERADO — nao edite a mao.
//
// Fonte: programs/awakefl/src/lib.rs + programs/awakefl/src/state.rs
// Gerar : python scripts/gerar-playground.py
//
// Esta e a versao achatada para o Solana Playground, que espera um unico
// src/lib.rs. A logica e identica a do programa real; muda so o declare_id!,
// que o Playground sincroniza sozinho no build.
// ============================================================================

"""


def gerar() -> str:
    lib = LIB.read_text(encoding="utf-8")
    state = STATE.read_text(encoding="utf-8")

    # `state.rs` repete o prelude que o lib.rs ja importa.
    state = re.sub(r"^use anchor_lang::prelude::\*;\s*\n", "", state, count=1, flags=re.M)

    # Remove a declaracao do modulo irmao: o conteudo dele vai para o fim.
    lib = re.sub(r"^pub mod state;\s*\n", "", lib, count=1, flags=re.M)
    lib = re.sub(r"^pub use state::\*;\s*\n", "", lib, count=1, flags=re.M)

    lib = re.sub(r'declare_id!\("[^"]+"\)', f'declare_id!("{PLAYGROUND_ID}")', lib, count=1)

    return CABECALHO + lib.rstrip() + "\n\n" + state.strip() + "\n"


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--check", action="store_true",
                   help="nao escreve; sai com codigo 1 se estiver desatualizado")
    args = p.parse_args(argv)

    novo = gerar()
    atual = DESTINO.read_text(encoding="utf-8") if DESTINO.exists() else ""

    if args.check:
        if novo != atual:
            print("playground/lib.rs esta DESATUALIZADO em relacao ao programa.", file=sys.stderr)
            print("Rode: python scripts/gerar-playground.py", file=sys.stderr)
            return 1
        print("playground/lib.rs esta em dia.")
        return 0

    if novo == atual:
        print("playground/lib.rs ja estava em dia.")
        return 0

    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    DESTINO.write_text(novo, encoding="utf-8")
    print(f"playground/lib.rs regerado ({len(novo.splitlines())} linhas).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
