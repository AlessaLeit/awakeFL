# Versão Solana Playground

Arquivos adaptados para rodar em [beta.solpg.io](https://beta.solpg.io) sem
toolchain local. A **fonte da verdade** continua sendo
`programs/fl-reputation/src/{lib,state}.rs` — ao alterar o programa lá,
regenere estes arquivos.

| Arquivo daqui | Onde cola no Playground |
|---|---|
| `lib.rs` | `src/lib.rs` |
| `anchor.test.ts` | `tests/anchor.test.ts` |

## Passo a passo

1. **Criar projeto** — em beta.solpg.io: `Create a new project` → framework **Anchor**.
2. **Conectar wallet** — botão `Not connected` no rodapé. O Playground cria uma
   keypair descartável e guarda no browser.
3. **Cluster** — confirme `devnet` no seletor do rodapé.
4. **Airdrop** — no terminal do Playground: `solana airdrop 2`. Se der rate
   limit, use https://faucet.solana.com com o endereço de `solana address`.
5. **Colar `lib.rs`** — substitua todo o conteúdo de `src/lib.rs`.
6. **Build** — o Playground reescreve o `declare_id!` com o Program ID real.
   Não edite essa linha à mão.
7. **Deploy** — custa ~2 SOL na primeira vez (aluguel do bytecode).
8. **Colar `anchor.test.ts`** e rodar **Test**.

Depois do deploy, traga o Program ID de volta para o repo: `solana address -k`
no Playground, ou copie do painel `Build & Deploy`. Cole em `Anchor.toml`
(`[programs.devnet]`) e em `programs/fl-reputation/src/lib.rs` (`declare_id!`).

## Diferenças que quebram se ignoradas

- **Sem imports no teste.** `anchor`, `web3`, `BN`, `assert` e `pg` são globais
  no Playground. Adicionar `import` quebra a execução.
- **Sem `require("crypto")`.** Roda no browser. O teste usa um gerador
  determinístico de 64 chars hex no lugar do SHA-256.
- **Sem `requestAirdrop` nos testes.** A Devnet limita airdrops; as wallets de
  teste são financiadas por transferência da `pg.wallet`.
- **O estado da Devnet persiste entre execuções.** O `initialize` é idempotente
  e a rodada corrente é lida do `Config`, nunca assumida como 0. As keypairs de
  participante são geradas a cada execução, então os PDAs nunca colidem.
- **`ctx.bumps.config`** exige Anchor ≥ 0.30. Se o Playground reclamar, a
  sintaxe antiga é `*ctx.bumps.get("config").unwrap()`.

## Custo aproximado na Devnet

Uma execução completa dos testes cria 2 `Participant` (~0,00135 SOL cada) e
6 `Contribution` (~0,00188 SOL cada), mais taxas: **~0,015 SOL**. O deploy
inicial é o gasto real (~2 SOL), e só acontece uma vez.
