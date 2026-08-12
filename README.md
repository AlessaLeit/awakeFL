# AwakeFL

Camada de reputação on-chain para **Federated Learning**, em Anchor/Solana.

Registra cada contribuição de forma imutável, mede reputação continuamente e
pune participantes maliciosos — em especial o *sleepy adversary*, que acumula
reputação com rodadas honestas antes de envenenar o modelo.

O site fica em [`web/`](web/README.md): landing, demo determinística e a **área
do participante** (`/painel`), que fala com o programa na Devnet.

## Modelo

| Parâmetro | Valor |
|---|---|
| Escala de reputação | `0..=1000` |
| Reputação inicial | `500` |
| Atualização | `R(t) = 0.5·R(t-1) + 0.5·S(t)` → `(R(t-1) + S(t)) / 2` |
| Penalidade | `reputação / 10` + banimento permanente |
| Rede | Devnet |

## Contas (PDAs)

| Conta | Seeds | Papel |
|---|---|---|
| `Config` | `["config"]` | autoridade, rodada corrente, total de participantes |
| `Participant` | `["participant", owner]` | reputação, contadores, flag de banimento |
| `Contribution` | `["contribution", participant, round_le]` | hash do modelo, score, validada |

## Instruções

| Instrução | Signer | Efeito |
|---|---|---|
| `initialize` | autoridade | cria o `Config` |
| `register_participant` | participante | cria o `Participant` com reputação 500 |
| `submit_contribution(model_hash)` | participante | registra o hash da rodada corrente |
| `validate_contribution(score)` | autoridade | aplica a EMA sobre a reputação |
| `penalize_participant(reason_code)` | autoridade | reputação / 10 + ban permanente |
| `advance_round` | autoridade | incrementa a rodada global |

## Rodando localmente

Requer Rust, Solana CLI e Anchor (via `avm`). No Windows, use **WSL2**.

```bash
# 1. Sincronize o Program ID (atualiza declare_id! e Anchor.toml)
anchor keys sync

# 2. Build + testes num validator efêmero
anchor test --provider.cluster localnet
```

Para reaproveitar um validator já rodando:

```bash
# terminal 1
solana-test-validator --reset

# terminal 2
solana config set --url localhost
anchor test --skip-local-validator --provider.cluster localnet
```

## Deploy na Devnet

```bash
solana config set --url devnet
solana airdrop 2
anchor build
anchor keys sync          # se o ID mudou
anchor deploy --provider.cluster devnet
```

## Solana Playground

O Playground usa uma estrutura mais enxuta. Copie:

- `programs/awakefl/src/lib.rs` → `src/lib.rs`
- `tests/awakefl.ts` → `tests/anchor.test.ts`

No Playground o `declare_id!` é sincronizado automaticamente no build, e o
cluster é escolhido na UI (canto inferior esquerdo) — não há `Anchor.toml`.
Nos testes, troque `anchor.workspace.Awakefl` por `pg.program`.

## Ciclo da demo

```
initialize → register_participant → submit_contribution
           → validate_contribution (reputação sobe pela EMA)
           → advance_round  ×N
           → penalize_participant (reputação /10, ban permanente)
           → submit_contribution falha com ParticipantBanned
```
