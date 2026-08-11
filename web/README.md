# fl-reputation — site

Landing + duas demos do ciclo de reputação, em Next.js 16 (App Router),
React 19 e Tailwind v4.

| Rota | O que é |
|---|---|
| `/` | Landing: o problema do sleepy adversary e o mecanismo |
| `/simulacao` | Simulação determinística das regras, **sem** blockchain |
| `/devnet` | Console **on-chain**: carteira, transações reais na Devnet |

## Rodar local

```bash
cd web
npm install
cp .env.example .env.local   # e preencha NEXT_PUBLIC_PROGRAM_ID
npm run dev                  # http://localhost:3000
```

Build de produção:

```bash
npm run build
npm run start
```

## Deploy na Vercel

O repositório tem o programa Anchor na raiz e o site em `web/`, então a Vercel
precisa saber onde olhar:

1. https://vercel.com/new → importe `AlessaLeit/fl-reputation`
2. **Root Directory: `web`** ← o passo que quebra se for esquecido
3. Framework Preset: `Next.js` (detectado sozinho)
4. Build Command, Output e Install: deixe os padrões
5. **Environment Variables**: `NEXT_PUBLIC_PROGRAM_ID` = o Program ID da Devnet
6. Deploy

⚠️ Variáveis `NEXT_PUBLIC_*` são **inlinadas no bundle durante o build**. Trocar o
Program ID no painel não muda nada até um novo deploy — use *Redeploy* depois de
alterá-la, senão o site continua servindo o valor antigo.

As páginas são todas estáticas (`○ prerendered as static content`); `/devnet`
busca o estado da chain no browser, depois da hidratação.

## Estrutura

```
web/src/
├── app/
│   ├── layout.tsx           metadata, tema antes da 1ª pintura
│   ├── globals.css          tokens de cor (claro/escuro)
│   ├── page.tsx             landing
│   ├── simulacao/           demo determinística (sem chain)
│   └── devnet/
│       ├── layout.tsx       metadata + providers de carteira
│       └── page.tsx         console on-chain
├── components/
│   ├── Nav.tsx  Footer.tsx  ThemeToggle.tsx
│   ├── SolanaProviders.tsx  Connection/Wallet/Modal + polyfill de Buffer
│   ├── StatTile.tsx         KPI
│   ├── StatusBadge.tsx      status sempre com ícone + rótulo
│   └── ReputationChart.tsx  gráfico SVG próprio
└── lib/
    ├── simulation.ts        as regras do programa, em TypeScript
    ├── idl/
    │   └── fl_reputation.json   ★ IDL do programa (spec 0.1.0, snake_case)
    └── anchor/
        └── program.ts       PDAs, Program, normalização das contas
```

## A ligação com a chain (`/devnet`)

Cada botão da página assina e envia uma transação de verdade; nada é simulado.

- **Leitura sem carteira.** `Config` via `fetchNullable`, participantes e
  contribuições via `getProgramAccounts` filtrado por discriminador (`.all()`).
- **Escrita com carteira.** Phantom ou Solflare, rede em Devnet. Quem chama
  `initialize` vira a autoridade; validar e penalizar só aparecem para ela.
- **O hash é calculado no browser** (SHA-256 da semente + pubkey + rodada). Só o
  compromisso de 64 caracteres vai para a chain — nunca os pesos.

### O IDL

`src/lib/idl/fl_reputation.json` é escrito em **snake_case**, o formato cru do
Anchor ≥ 0.31; o construtor de `Program` converte para camelCase sozinho. Os
discriminadores são `sha256("global:"|"account:"|"event:" + nome)[0..8]`.

**Ele precisa acompanhar o programa.** Se `programs/fl-reputation/src/` mudar
(instrução nova, campo novo, ordem de campos, ordem das contas), o IDL fica
dessincronizado e as transações passam a falhar com erros de desserialização
que não apontam para a causa. O `address` dentro do JSON é ignorado em runtime —
vale o `NEXT_PUBLIC_PROGRAM_ID`.

Layouts conferidos contra os comentários do `state.rs`: `Config` 57 bytes,
`Participant` 66, `Contribution` 142.

## O gráfico

SVG escrito à mão, sem biblioteca de charts. É um gráfico de **ênfase**: o
sleepy adversary na cor de acento, as demais instituições em cinza de recuo —
a forma certa quando uma série *é* a história, em vez de cinco cores
competindo entre si.

Especificações seguidas: linha de 2px, grade hairline sólida (nunca tracejada),
anel de 2px na cor da superfície nos pontos que se sobrepõem, rótulo direto só
na série em destaque, legenda sempre presente, crosshair com tooltip, navegação
por seta do teclado e alternância para **visão de tabela** — nenhum valor existe
apenas dentro de um tooltip.

O par acento/cinza foi validado nos dois modos: separação CVD ΔE 15,9 e
contraste ≥ 3:1 sobre as duas superfícies.

## Sobre os dados

`src/lib/simulation.ts` reimplementa as regras do programa Anchor em TypeScript:

| Regra | Implementação |
|---|---|
| Reputação inicial | `500` |
| EMA | `Math.floor((reputação + score) / 2)` |
| Penalidade | `Math.floor(reputação / 10)` + banimento |

Os scores são tabelados, sem aleatoriedade: a demo mostra os mesmos números a
cada carregamento. O Instituto Delta chega a **935** de reputação em oito
rodadas honestas e cai para **30** quando é penalizado.

**Não há conexão com a Devnet em `/simulacao`.** As assinaturas exibidas na
trilha de auditoria daquela página são decorativas — para transações reais e
verificáveis no explorador, use `/devnet`.
