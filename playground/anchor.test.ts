// ============================================================================
// VERSAO SOLANA PLAYGROUND — cole em `tests/anchor.test.ts`
//
// Diferencas em relacao a tests/awakefl.ts (versao Anchor local):
//
//  1. `pg.program` / `pg.wallet` / `pg.connection` no lugar de
//     `anchor.workspace.Awakefl` e do provider.
//  2. `anchor`, `web3`, `BN` e `assert` sao GLOBAIS no Playground — nao ha
//     imports neste arquivo, e adicionar imports quebra a execucao.
//  3. Nada de `require("crypto")`: o Playground roda no browser. O hash e
//     gerado por uma funcao deterministica de 64 chars hex (o programa so
//     valida o comprimento, nao recomputa o hash).
//  4. Nada de `requestAirdrop`: a Devnet limita airdrops com agressividade.
//     As wallets de teste sao financiadas por transferencia da pg.wallet.
//  5. O estado da Devnet PERSISTE entre execucoes. Por isso o `initialize`
//     e idempotente e a rodada corrente e LIDA do Config, nunca assumida
//     como zero. Sem isso, a segunda execucao falha inteira.
// ============================================================================

describe("awakefl", () => {
  const program = pg.program;
  const authority = pg.wallet;

  // Keypairs novas a cada execucao => PDAs de Participant/Contribution sempre
  // ineditos, mesmo com o Config sobrevivendo de execucoes anteriores.
  const honest = web3.Keypair.generate();
  const sleepy = web3.Keypair.generate();

  const [configPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  const participantPda = (owner) =>
    web3.PublicKey.findProgramAddressSync(
      [Buffer.from("participant"), owner.toBuffer()],
      program.programId
    )[0];

  const contributionPda = (participant, round) =>
    web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("contribution"),
        participant.toBuffer(),
        new BN(round).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    )[0];

  // 64 chars hex deterministicos a partir de uma tag. Substitui o SHA-256 real,
  // que exigiria crypto.subtle (async) sem ganho nenhum para este teste.
  const hashOf = (tag) => {
    let hex = "";
    for (let i = 0; i < tag.length; i++) {
      hex += tag.charCodeAt(i).toString(16).padStart(2, "0");
    }
    return (hex + "0".repeat(64)).slice(0, 64);
  };

  const fund = async (to, sol) => {
    const tx = new web3.Transaction().add(
      web3.SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: to,
        lamports: Math.floor(sol * web3.LAMPORTS_PER_SOL),
      })
    );
    await web3.sendAndConfirmTransaction(pg.connection, tx, [authority.keypair]);
  };

  // Rodada corrente do Config — lida, nunca assumida.
  let round;

  const submit = (who, roundNo, tag) => {
    const p = participantPda(who.publicKey);
    return program.methods
      .submitContribution(hashOf(tag), new BN(1000), 0.42, 0.91)
      .accounts({
        config: configPda,
        participant: p,
        contribution: contributionPda(p, roundNo),
        owner: who.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([who])
      .rpc();
  };

  const validate = (ownerPk, roundNo, score) => {
    const p = participantPda(ownerPk);
    return program.methods
      .validateContribution(new BN(score))
      .accounts({
        config: configPda,
        participant: p,
        contribution: contributionPda(p, roundNo),
        authority: authority.publicKey,
      })
      .rpc();
  };

  const reputationOf = async (ownerPk) =>
    (await program.account.participant.fetch(participantPda(ownerPk))).reputation.toNumber();

  const statusOf = async (ownerPk, roundNo) =>
    (
      await program.account.contribution.fetch(
        contributionPda(participantPda(ownerPk), roundNo)
      )
    ).status;

  // Rodada completa: submeter -> validar -> devolver a reputacao resultante
  const fullRound = async (who, roundNo, score, tag) => {
    await submit(who, roundNo, tag);
    await validate(who.publicKey, roundNo, score);
    return reputationOf(who.publicKey);
  };

  const advance = async () => {
    await program.methods
      .advanceRound()
      .accounts({ config: configPda, authority: authority.publicKey })
      .rpc();
    round += 1;
  };

  // assert.fail() lanca AssertionError, que o proprio catch capturaria e
  // mascararia o teste. O flag `falhou` evita esse falso positivo.
  const expectError = async (fn, code) => {
    let falhou = false;
    try {
      await fn();
    } catch (e) {
      falhou = true;
      assert.include(`${e}`, code, `esperava o erro ${code}, veio: ${e}`);
    }
    assert.isTrue(falhou, `esperava o erro ${code}, mas a instrucao passou`);
  };

  before(async () => {
    console.log("programId:", program.programId.toBase58());
    console.log("configPda:", configPda.toBase58());
    const saldo = await pg.connection.getBalance(authority.publicKey);
    console.log("saldo da wallet:", saldo / web3.LAMPORTS_PER_SOL, "SOL");

    await fund(honest.publicKey, 0.05);
    await fund(sleepy.publicKey, 0.05);

    // Idempotente em re-execucoes na Devnet, onde o Config sobrevive.
    // ATENCAO: so engolir o erro de "conta ja existe". Qualquer outra falha
    // precisa estourar aqui — senao o fetch seguinte quebra com
    // "Account does not exist" e esconde a causa real.
    try {
      await program.methods
        .initialize()
        .accounts({
          config: configPda,
          authority: authority.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc();
      console.log("Config criado");
    } catch (e) {
      const msg = `${e}`;
      const jaExiste =
        msg.includes("already in use") ||
        msg.includes("custom program error: 0x0");

      if (!jaExiste) {
        console.error("=== initialize FALHOU ===");
        console.error(msg);
        if (e.logs) console.error(e.logs.join("\n"));
        throw e;
      }
      console.log("Config ja existia, reaproveitando");
    }

    const config = await program.account.config.fetch(configPda);
    round = config.currentRound.toNumber();
    console.log("Rodada inicial:", round);
  });

  it("config tem a autoridade correta", async () => {
    const config = await program.account.config.fetch(configPda);
    assert.ok(config.authority.equals(authority.publicKey));
  });

  it("registra participantes com reputacao inicial 500", async () => {
    for (const kp of [honest, sleepy]) {
      await program.methods
        .registerParticipant()
        .accounts({
          config: configPda,
          participant: participantPda(kp.publicKey),
          owner: kp.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([kp])
        .rpc();
    }

    const p = await program.account.participant.fetch(participantPda(honest.publicKey));
    assert.equal(p.reputation.toNumber(), 500);
    assert.isFalse(p.isBanned);
    assert.equal(p.contribCount.toNumber(), 0);
    assert.equal(p.stakeAmount.toNumber(), 0);
  });

  it("grava hash, metricas e status Pendente na submissao", async () => {
    await submit(honest, round, "honest-a");

    const c = await program.account.contribution.fetch(
      contributionPda(participantPda(honest.publicKey), round)
    );
    assert.equal(c.updateHash, hashOf("honest-a"));
    assert.equal(c.updateHash.length, 64);
    assert.equal(c.nSamples.toNumber(), 1000);
    assert.approximately(c.accuracy, 0.91, 1e-9);
    assert.deepEqual(c.status, { pendente: {} });
    assert.equal(c.round.toNumber(), round);
  });

  it("aplica a EMA R(t) = (R(t-1) + S(t)) / 2 e aprova a contribuicao", async () => {
    await validate(honest.publicKey, round, 900); // (500 + 900) / 2 = 700
    assert.equal(await reputationOf(honest.publicKey), 700);
    assert.deepEqual(await statusOf(honest.publicKey, round), { aprovado: {} });
  });

  it("marca como Rejeitado quando o score fica abaixo de 500", async () => {
    await advance();
    assert.equal(await fullRound(honest, round, 200, "honest-b"), 450); // (700 + 200) / 2
    assert.deepEqual(await statusOf(honest.publicKey, round), { rejeitado: {} });
  });

  it("rejeita score acima de 1000", async () => {
    await advance();
    await submit(honest, round, "honest-c");
    await expectError(() => validate(honest.publicKey, round, 1001), "InvalidScore");
  });

  it("nao valida duas vezes a mesma contribuicao", async () => {
    await validate(honest.publicKey, round, 800);
    await expectError(() => validate(honest.publicKey, round, 800), "AlreadyValidated");
  });

  it("so a autoridade valida contribuicoes", async () => {
    await advance();
    await submit(sleepy, round, "sleepy-a");

    const p = participantPda(sleepy.publicKey);
    await expectError(
      () =>
        program.methods
          .validateContribution(new BN(1000))
          .accounts({
            config: configPda,
            participant: p,
            contribution: contributionPda(p, round),
            authority: sleepy.publicKey,
          })
          .signers([sleepy])
          .rpc(),
      "ConstraintHasOne"
    );

    // a autoridade legitima valida: 500 -> 700
    await validate(sleepy.publicKey, round, 900);
    assert.equal(await reputationOf(sleepy.publicKey), 700);
  });

  it("rejeita update_hash maior que 64 caracteres", async () => {
    await advance();
    const p = participantPda(honest.publicKey);
    await expectError(
      () =>
        program.methods
          .submitContribution("f".repeat(65), new BN(1000), 0.1, 0.9)
          .accounts({
            config: configPda,
            participant: p,
            contribution: contributionPda(p, round),
            owner: honest.publicKey,
            systemProgram: web3.SystemProgram.programId,
          })
          .signers([honest])
          .rpc(),
      "HashTooLong"
    );
  });

  it("sleepy adversary: acumula reputacao e perde tudo na penalidade", async () => {
    // esta em 700. Mais duas rodadas honestas para inflar a reputacao:
    assert.equal(await fullRound(sleepy, round, 900, "sleepy-b"), 800); // (700 + 900) / 2
    await advance();
    assert.equal(await fullRound(sleepy, round, 950, "sleepy-c"), 875); // (800 + 950) / 2

    // detectado envenenando o modelo
    await program.methods
      .penalizeParticipant(1) // reason_code 1 = label flipping
      .accounts({
        config: configPda,
        participant: participantPda(sleepy.publicKey),
        authority: authority.publicKey,
      })
      .rpc();

    const acc = await program.account.participant.fetch(participantPda(sleepy.publicKey));
    assert.equal(acc.reputation.toNumber(), 87); // 875 / 10, divisao inteira
    assert.isTrue(acc.isBanned);
    console.log("sleepy: 875 -> 87, banido permanentemente");
  });

  it("participante banido nao consegue mais contribuir", async () => {
    await advance();
    await expectError(() => submit(sleepy, round, "sleepy-pos-ban"), "ParticipantBanned");
  });

  it("nao penaliza duas vezes o mesmo participante", async () => {
    await expectError(
      () =>
        program.methods
          .penalizeParticipant(1)
          .accounts({
            config: configPda,
            participant: participantPda(sleepy.publicKey),
            authority: authority.publicKey,
          })
          .rpc(),
      "AlreadyBanned"
    );
  });
});
