import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Awakefl } from "../target/types/awakefl";
import { assert } from "chai";
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createHash } from "crypto";

describe("awakefl", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Awakefl as Program<Awakefl>;
  const authority = provider.wallet as anchor.Wallet;

  // honesto = contribui bem sempre; sleepy = constroi reputacao e depois envenena
  const honest = Keypair.generate();
  const sleepy = Keypair.generate();

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );

  const participantPda = (owner: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("participant"), owner.toBuffer()],
      program.programId,
    )[0];

  const contributionPda = (participant: PublicKey, round: number) =>
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("contribution"),
        participant.toBuffer(),
        new BN(round).toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    )[0];

  // SHA-256 em hex: 64 chars, exatamente o MAX_HASH_LEN do programa
  const hashOf = (s: string) => createHash("sha256").update(s).digest("hex");

  const fund = async (kp: Keypair) => {
    const sig = await provider.connection.requestAirdrop(
      kp.publicKey,
      2 * LAMPORTS_PER_SOL,
    );
    const bh = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({ signature: sig, ...bh });
  };

  const submit = (who: Keypair, roundNo: number, tag: string) => {
    const p = participantPda(who.publicKey);
    return program.methods
      .submitContribution(hashOf(tag), new BN(1000), 0.42, 0.91)
      .accounts({
        config: configPda,
        participant: p,
        contribution: contributionPda(p, roundNo),
        owner: who.publicKey,
      })
      .signers([who])
      .rpc();
  };

  const validate = (who: PublicKey, roundNo: number, score: number) => {
    const p = participantPda(who);
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

  const reputationOf = async (owner: PublicKey) =>
    (
      await program.account.participant.fetch(participantPda(owner))
    ).reputation.toNumber();

  // Rodada completa: submeter -> validar -> devolver a reputacao resultante
  const round = async (
    who: Keypair,
    roundNo: number,
    score: number,
    tag: string,
  ) => {
    await submit(who, roundNo, tag);
    await validate(who.publicKey, roundNo, score);
    return reputationOf(who.publicKey);
  };

  const advance = () =>
    program.methods
      .advanceRound()
      .accounts({ config: configPda, authority: authority.publicKey })
      .rpc();

  before(async () => {
    await Promise.all([fund(honest), fund(sleepy)]);
  });

  it("inicializa o config com a autoridade e rodada 0", async () => {
    await program.methods
      .initialize()
      .accounts({ config: configPda, authority: authority.publicKey })
      .rpc();

    const config = await program.account.config.fetch(configPda);
    assert.ok(config.authority.equals(authority.publicKey));
    assert.equal(config.currentRound.toNumber(), 0);
    assert.equal(config.totalParticipants.toNumber(), 0);
  });

  it("registra participantes com reputacao inicial 500", async () => {
    for (const kp of [honest, sleepy]) {
      await program.methods
        .registerParticipant()
        .accounts({
          config: configPda,
          participant: participantPda(kp.publicKey),
          owner: kp.publicKey,
        })
        .signers([kp])
        .rpc();
    }

    const p = await program.account.participant.fetch(
      participantPda(honest.publicKey),
    );
    assert.equal(p.reputation.toNumber(), 500);
    assert.isFalse(p.isBanned);
    assert.equal(p.contribCount.toNumber(), 0);
    assert.equal(p.stakeAmount.toNumber(), 0);

    const config = await program.account.config.fetch(configPda);
    assert.equal(config.totalParticipants.toNumber(), 2);
  });

  it("grava hash, metricas e status Pendente na submissao", async () => {
    await submit(honest, 0, "honest-r0");

    const c = await program.account.contribution.fetch(
      contributionPda(participantPda(honest.publicKey), 0),
    );
    assert.equal(c.updateHash, hashOf("honest-r0"));
    assert.equal(c.updateHash.length, 64);
    assert.equal(c.nSamples.toNumber(), 1000);
    assert.approximately(c.accuracy, 0.91, 1e-9);
    assert.deepEqual(c.status, { pendente: {} });
  });

  it("aplica a EMA R(t) = (R(t-1) + S(t)) / 2 e aprova a contribuicao", async () => {
    await validate(honest.publicKey, 0, 900); // (500 + 900) / 2 = 700
    assert.equal(await reputationOf(honest.publicKey), 700);

    const c = await program.account.contribution.fetch(
      contributionPda(participantPda(honest.publicKey), 0),
    );
    assert.deepEqual(c.status, { aprovado: {} });
  });

  it("marca como Rejeitado quando o score fica abaixo de 500", async () => {
    await advance(); // rodada 1
    assert.equal(await round(honest, 1, 200, "honest-r1"), 450); // (700 + 200) / 2

    const c = await program.account.contribution.fetch(
      contributionPda(participantPda(honest.publicKey), 1),
    );
    assert.deepEqual(c.status, { rejeitado: {} });
  });

  it("rejeita score acima de 1000", async () => {
    await advance(); // rodada 2
    await submit(honest, 2, "honest-r2");

    try {
      await validate(honest.publicKey, 2, 1001);
      assert.fail("deveria ter rejeitado score 1001");
    } catch (e) {
      assert.include(e.toString(), "InvalidScore");
    }
  });

  it("nao valida duas vezes a mesma contribuicao", async () => {
    await validate(honest.publicKey, 2, 800);

    try {
      await validate(honest.publicKey, 2, 800);
      assert.fail("deveria ter rejeitado a revalidacao");
    } catch (e) {
      assert.include(e.toString(), "AlreadyValidated");
    }
  });

  it("so a autoridade valida contribuicoes", async () => {
    await advance(); // rodada 3
    await submit(sleepy, 3, "sleepy-r3");

    const p = participantPda(sleepy.publicKey);
    try {
      await program.methods
        .validateContribution(new BN(1000))
        .accounts({
          config: configPda,
          participant: p,
          contribution: contributionPda(p, 3),
          authority: sleepy.publicKey,
        })
        .signers([sleepy])
        .rpc();
      assert.fail("um impostor nao deveria conseguir validar");
    } catch (e) {
      assert.include(e.toString(), "ConstraintHasOne");
    }

    // a autoridade legitima valida: 500 -> 700
    await validate(sleepy.publicKey, 3, 900);
    assert.equal(await reputationOf(sleepy.publicKey), 700);
  });

  it("rejeita update_hash maior que 64 caracteres", async () => {
    await advance(); // rodada 4
    const p = participantPda(honest.publicKey);

    try {
      await program.methods
        .submitContribution("f".repeat(65), new BN(1000), 0.1, 0.9)
        .accounts({
          config: configPda,
          participant: p,
          contribution: contributionPda(p, 4),
          owner: honest.publicKey,
        })
        .signers([honest])
        .rpc();
      assert.fail("deveria ter rejeitado hash de 65 chars");
    } catch (e) {
      assert.include(e.toString(), "HashTooLong");
    }
  });

  const penalizar = (who: PublicKey, reasonCode = 1) =>
    program.methods
      .penalizeParticipant(reasonCode)
      .accounts({
        config: configPda,
        participant: participantPda(who),
        authority: authority.publicKey,
      })
      .rpc();

  it("nao bane quem o proprio registro nao condena", async () => {
    // esta em 700 apos a rodada 3. Mais duas rodadas honestas:
    assert.equal(await round(sleepy, 4, 900, "sleepy-r4"), 800); // (700 + 900) / 2
    await advance(); // rodada 5
    assert.equal(await round(sleepy, 5, 950, "sleepy-r5"), 875); // (800 + 950) / 2

    // Com reputacao 875 nao ha o que justifique um banimento, e o programa se
    // recusa a executa-lo — mesmo vindo da autoridade. Sem esta trava, ela
    // poderia banir permanentemente um participante impecavel, e o registro
    // on-chain atestaria isso com a mesma imutabilidade de um ban legitimo.
    try {
      await penalizar(sleepy.publicKey);
      assert.fail("deveria ter recusado: reputacao 875 esta acima do limiar");
    } catch (e) {
      assert.include(e.toString(), "ReputationAboveThreshold");
    }
  });

  it("sleepy adversary: envenena, a reputacao desaba e ai sim e banido", async () => {
    // Comeca a envenenar. O agregador pontua a inconsistencia com 0, e a media
    // movel leva duas rodadas para cruzar o limiar de 400.
    await advance(); // rodada 6
    assert.equal(await round(sleepy, 6, 0, "sleepy-r6"), 437); // (875 + 0) / 2
    await advance(); // rodada 7
    assert.equal(await round(sleepy, 7, 0, "sleepy-r7"), 218); // (437 + 0) / 2

    await penalizar(sleepy.publicKey); // agora o registro justifica

    const acc = await program.account.participant.fetch(
      participantPda(sleepy.publicKey),
    );
    assert.equal(acc.reputation.toNumber(), 21); // 218 / 10, divisao inteira
    assert.isTrue(acc.isBanned);
  });

  it("expira pendencia de rodada passada sem apagar o registro", async () => {
    // `honest` submeteu na rodada 4 e nunca foi validado (a rodada 4 so teve o
    // teste de hash grande). Essa contribuicao ficou orfa quando a rodada
    // avancou — exatamente o caso que a instrucao existe para resolver.
    const p = participantPda(honest.publicKey);
    await submit(honest, 7, "honest-orfa"); // a rodada corrente e a 7

    const expirar = (owner: PublicKey, roundNo: number) =>
      program.methods
        .expireContribution()
        .accounts({
          config: configPda,
          contribution: contributionPda(participantPda(owner), roundNo),
          authority: authority.publicKey,
        })
        .rpc();

    // Na rodada corrente a autoridade tem que pontuar, nao expirar.
    try {
      await expirar(honest.publicKey, 7);
      assert.fail("deveria ter recusado: a rodada 7 ainda esta aberta");
    } catch (e) {
      assert.include(e.toString(), "RoundStillOpen");
    }

    const antes = await program.account.contribution.fetch(
      contributionPda(p, 7),
    );
    const contribsAntes = (
      await program.account.participant.fetch(p)
    ).contribCount.toNumber();

    await advance(); // rodada 8 — agora a 7 esta encerrada
    await expirar(honest.publicKey, 7);

    const depois = await program.account.contribution.fetch(
      contributionPda(p, 7),
    );
    assert.deepEqual(depois.status, { expirado: {} });

    // O que o "expirar" NAO faz, que e o ponto do desenho: nada some. O
    // compromisso, a rodada e as metricas declaradas continuam gravados, e a
    // contagem de submissoes do participante nao e reescrita.
    assert.equal(depois.updateHash, antes.updateHash);
    assert.equal(depois.round.toNumber(), antes.round.toNumber());
    assert.equal(depois.nSamples.toNumber(), antes.nSamples.toNumber());
    assert.equal(
      (await program.account.participant.fetch(p)).contribCount.toNumber(),
      contribsAntes,
    );
  });

  it("nao expira duas vezes nem expira o que ja foi julgado", async () => {
    const p = participantPda(honest.publicKey);
    try {
      await program.methods
        .expireContribution()
        .accounts({
          config: configPda,
          contribution: contributionPda(p, 7),
          authority: authority.publicKey,
        })
        .rpc();
      assert.fail("deveria ter recusado: ja esta expirada");
    } catch (e) {
      assert.include(e.toString(), "AlreadyValidated");
    }
  });

  it("participante banido nao consegue mais contribuir", async () => {
    await advance(); // rodada 9
    try {
      await submit(sleepy, 9, "sleepy-after-ban");
      assert.fail("banido nao deveria conseguir submeter");
    } catch (e) {
      assert.include(e.toString(), "ParticipantBanned");
    }
  });

  it("nao penaliza duas vezes o mesmo participante", async () => {
    try {
      await penalizar(sleepy.publicKey);
      assert.fail("deveria ter rejeitado a segunda penalidade");
    } catch (e) {
      assert.include(e.toString(), "AlreadyBanned");
    }
  });
});
