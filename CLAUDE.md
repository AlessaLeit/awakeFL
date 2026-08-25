# AwakeFL — contexto para o Claude Code

Sistema de reputação on-chain para Federated Learning. Projeto de pesquisa
(Iniciação Científica, com intenção de virar TCC), **não** produto em produção.

Leia primeiro: [README.md](README.md) para o que é, e
[README-TECNICO.md](README-TECNICO.md) para como funciona.

## As três camadas

| Onde | O quê | Roda sozinha? |
| --- | --- | --- |
| `programs/awakefl/` | programa Anchor (Rust) — 6 instruções, 3 PDAs | sim, `anchor test` |
| `awakefl-fl/` | simulação de Federated Learning (Python) | sim, `--chain simulado` |
| `web/` | site e painel (Next.js 16, React 19) | sim, `/simulacao` não usa chain |

Elas se encontram em dois pontos: o **hash canônico dos pesos** e a **conta de
reputação**. Mexer num sem o outro é como a maioria dos bugs deste projeto
apareceu.

## Regras do projeto

**Português nos comentários e nas mensagens de commit.** Comentário explica *por
quê*, não *o quê* — o código já diz o quê. Sem emoji em commit.

**Nada de afirmar o que não foi medido.** Vale para README, documentação e
comparação com outros trabalhos. Se um número não veio de execução, ele é
estimativa e precisa estar marcado como tal. Esta regra saiu de erros reais e
está registrada na branch `documentacao`.

**Decisão com alternativa descartada vira registro.** O `registro-de-decisoes.md`
(branch `documentacao`) usa códigos `D01`–`D23`, achados `A01`–`A07` e erros
`E01`–`E06`. Ao mudar um parâmetro, procure-o lá antes — vários foram escolhidos
contra uma alternativa específica.

**Espelhamento off-chain ↔ on-chain.** Toda constante do modelo existe nos dois
lados em escalas diferentes (`0..1` em Python, `0..=1000` em Rust). Mudar uma sem
a outra quebra em silêncio:

| | Python | Rust |
| --- | --- | --- |
| inicial | `0.5` | `INITIAL_REPUTATION = 500` |
| limiar de banimento | `0.4` | `BAN_THRESHOLD = 400` |
| penalidade | `/10` | `PENALTY_DIVISOR = 10` |

A demo web também espelha (`web/src/lib/simulation.ts`) e **lança erro** se o
cenário contar algo que o programa recusaria.

**Variante nova de erro no Anchor vai no FIM do enum.** O Anchor numera por
posição (6000 + índice); inserir no meio renumera os seguintes.

## Comandos

```bash
# Python — o venv fica em awakefl-fl/.venv, o python do PATH NAO tem torch
cd awakefl-fl && .venv/Scripts/python.exe -m pytest -q
.venv/Scripts/python.exe run_experiments.py

# Web
cd web && npx tsc --noEmit && npm run lint && npm run build

# Programa Anchor (precisa de Solana CLI + Anchor via avm)
anchor test --provider.cluster localnet
```

`pytest.ini` desliga o plugin do anchorpy (`-p no:anchorpy`) — sem isso a suíte
inteira quebra com `ModuleNotFoundError: pytest_asyncio`.

## Branches

- `main` — código. É de onde o Vercel publica <https://awake-fl.vercel.app>
- `documentacao` — os documentos longos em `awakefl-fl/docs/`
- Links entre elas precisam de URL completa do GitHub com a branch no caminho,
  senão quebram

## Ambiente (Windows)

- Shell é **PowerShell**; não há heredoc. Mensagem de commit longa vai em arquivo
  e usa `git commit -F`
- O PATH do Bash já quebrou no meio de uma sessão (`grep`, `sed`, `python` sumindo)
- `cargo` foi instalado via winget; Solana CLI e Anchor **não** estão instalados
- SonarCloud analisa este repo sob a chave antiga `AlessaLeit_fl-reputation`

## Estado pendente

- A trava `ReputationAboveThreshold` e a instrução `expire_contribution` estão
  no código e **não** no binário publicado na Devnet — falta redeploy. Até lá,
  o botão "Expirar" do painel falha, e banir acima do limiar continua possível
- `tests/awakefl.ts` foi reescrito e nunca executou
- `--chain devnet` nunca enviou transação real: carteiras não financiadas
- Latência e custo na Solana nunca medidos (objetivo 4 da IC)
