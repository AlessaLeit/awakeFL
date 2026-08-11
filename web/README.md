# fl-reputation — site

Landing SaaS + demo interativa do ciclo de reputação, em Next.js 16 (App Router),
React 19 e Tailwind v4.

## Rodar local

```bash
cd web
npm install
npm run dev          # http://localhost:3000
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
5. Deploy

Não há variáveis de ambiente. As duas páginas são estáticas
(`○ prerendered as static content`), então o site inteiro sai da CDN.

## Estrutura

```
web/src/
├── app/
│   ├── layout.tsx           metadata, tema antes da 1ª pintura
│   ├── globals.css          tokens de cor (claro/escuro)
│   ├── page.tsx             landing
│   └── dashboard/
│       ├── layout.tsx       metadata da demo
│       └── page.tsx         demo interativa
├── components/
│   ├── Nav.tsx  Footer.tsx  ThemeToggle.tsx
│   ├── StatTile.tsx         KPI
│   ├── StatusBadge.tsx      status sempre com ícone + rótulo
│   └── ReputationChart.tsx  gráfico SVG próprio
└── lib/
    └── simulation.ts        ★ as regras do programa, em TypeScript
```

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

**Não há conexão com a Devnet nesta página.** O site é uma vitrine do modelo;
as assinaturas exibidas na trilha de auditoria são decorativas.
