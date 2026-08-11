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
no Playground, ou copie do painel `Build & Deploy`. Cole em três lugares:

1. `Anchor.toml` → `[programs.devnet]` e `[programs.localnet]`
2. `programs/fl-reputation/src/lib.rs` → `declare_id!`
3. **O site** → variável `NEXT_PUBLIC_PROGRAM_ID`, em `web/.env.local` para
   rodar local e no painel da Vercel para produção. Sem ela, `/devnet` mostra
   "programa ainda não configurado". Ela é inlinada no build, então depois de
   alterá-la na Vercel é preciso **Redeploy**.

## Se você mexer no programa

`web/src/lib/idl/fl_reputation.json` é o IDL que o site usa para montar as
transações, e ele foi derivado de `programs/fl-reputation/src/`. Toda mudança de
instrução, de campo, de ordem de campos ou de ordem das contas precisa ser
refletida ali — senão o site assina transações que o programa rejeita, com erros
de desserialização que não apontam para a causa. O Playground exporta o IDL
gerado no painel `Build & Deploy`: baixar e substituir o arquivo é a forma mais
segura de sincronizar.

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
