import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { FlReputation } from "../target/types/fl_reputation";
import { assert } from "chai";
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createHash } from "crypto";

describe("fl-reputation", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.FlReputation as Program<FlReputation>;
  const authority = provider.wallet as anchor.Wallet;

  // honesto = contribui bem sempre; sleepy = constroi reputacao e depois envenena
  const honest = Keypair.generate();
  const sleepy = Keypair.generate();

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  const participantPda = (owner: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("participant"), owner.toBuffer()],
      program.programId
    )[0];

  const contributionPda = (participant: PublicKey, round: number) =>
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("contribution"),
        participant.toBuffer(),
        new anchor.BN(round).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    )[0];

  const hashOf = (s: string): number[] =>
    Array.from(createHash("sha256").update(s).digest());

  const fund = async (kp: Keypair) => {
    const sig = await provider.connection.requestAirdrop(
      kp.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    const bh = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({ signature: sig, ...bh });
  };

  // Fluxo completo de uma rodada: submeter -> validar
  const round = async (who: Keypair, roundNo: number, score: number, tag: string) => {
    const p = participantPda(who.publicKey);
    const c = contributionPda(p, roundNo);

    await program.methods
      .submitContribution(hashOf(tag))
      .accounts({ config: configPda, participant: p, contribution: c, owner: who.publicKey })
      .signers([who])
      .rpc();

    await program.methods
      .validateContribution(score)
      .accounts({ config: configPda, participant: p, contribution: c, authority: authority.publicKey })
      .rpc();

    return (await program.account.participant.fetch(p)).reputation;
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

    const p = await program.account.participant.fetch(participantPda(honest.publicKey));
    assert.equal(p.reputation, 500);
    assert.isFalse(p.banned);
    assert.equal(p.contributionsCount.toNumber(), 0);

    const config = await program.account.config.fetch(configPda);
    assert.equal(config.totalParticipants.toNumber(), 2);
  });

  it("aplica a EMA R(t) = (R(t-1) + S(t)) / 2 na validacao", async () => {
    // 500 -> (500 + 900) / 2 = 700
    const rep = await round(honest, 0, 900, "honest-r0");
    assert.equal(rep, 700);

    const c = await program.account.contribution.fetch(
      contributionPda(participantPda(honest.publicKey), 0)
    );
    assert.isTrue(c.validated);
    assert.equal(c.score, 900);
  });

  it("rejeita score acima de 1000", async () => {
    await advance(); // rodada 1
    const p = participantPda(honest.publicKey);
    const c = contributionPda(p, 1);

    await program.methods
      .submitContribution(hashOf("honest-r1"))
      .accounts({ config: configPda, participant: p, contribution: c, owner: honest.publicKey })
      .signers([honest])
      .rpc();

    try {
      await program.methods
        .validateContribution(1001)
        .accounts({ config: configPda, participant: p, contribution: c, authority: authority.publicKey })
        .rpc();
      assert.fail("deveria ter rejeitado score 1001");
    } catch (e) {
      assert.include(e.toString(), "InvalidScore");
    }
  });

  it("nao valida duas vezes a mesma contribuicao", async () => {
    const p = participantPda(honest.publicKey);
    const c = contributionPda(p, 1);

    await program.methods
      .validateContribution(800)
      .accounts({ config: configPda, participant: p, contribution: c, authority: authority.publicKey })
      .rpc();

    try {
      await program.methods
        .validateContribution(800)
        .accounts({ config: configPda, participant: p, contribution: c, authority: authority.publicKey })
        .rpc();
      assert.fail("deveria ter rejeitado a revalidacao");
    } catch (e) {
      assert.include(e.toString(), "AlreadyValidated");
    }
  });

  it("so a autoridade valida contribuicoes", async () => {
    await advance(); // rodada 2
    const p = participantPda(sleepy.publicKey);
    const c = contributionPda(p, 2);

    await program.methods
      .submitContribution(hashOf("sleepy-r2"))
      .accounts({ config: configPda, participant: p, contribution: c, owner: sleepy.publicKey })
      .signers([sleepy])
      .rpc();

    try {
      await program.methods
        .validateContribution(1000)
        .accounts({ config: configPda, participant: p, contribution: c, authority: sleepy.publicKey })
        .signers([sleepy])
        .rpc();
      assert.fail("um impostor nao deveria conseguir validar");
    } catch (e) {
      assert.include(e.toString(), "ConstraintHasOne");
    }

    // a autoridade legitima valida: 500 -> 700
    await program.methods
      .validateContribution(900)
      .accounts({ config: configPda, participant: p, contribution: c, authority: authority.publicKey })
      .rpc();
    const acc = await program.account.participant.fetch(p);
    assert.equal(acc.reputation, 700);
  });

  it("sleepy adversary: acumula reputacao e perde tudo na penalidade", async () => {
    // ja esta em 700 apos a rodada 2. Mais duas rodadas honestas:
    await advance();
    assert.equal(await round(sleepy, 3, 900, "sleepy-r3"), 800); // (700+900)/2
    await advance();
    assert.equal(await round(sleepy, 4, 950, "sleepy-r4"), 875); // (800+950)/2

    // rodada 5: envenena o modelo e e detectado
    const p = participantPda(sleepy.publicKey);
    await program.methods
      .penalizeParticipant(1) // reason_code 1 = label flipping
      .accounts({ config: configPda, participant: p, authority: authority.publicKey })
      .rpc();

    const acc = await program.account.participant.fetch(p);
    assert.equal(acc.reputation, 87); // 875 / 10, divisao inteira
    assert.isTrue(acc.banned);
  });

  it("participante banido nao consegue mais contribuir", async () => {
    await advance();
    const config = await program.account.config.fetch(configPda);
    const roundNo = config.currentRound.toNumber();
    const p = participantPda(sleepy.publicKey);

    try {
      await program.methods
        .submitContribution(hashOf("sleepy-after-ban"))
        .accounts({
          config: configPda,
          participant: p,
          contribution: contributionPda(p, roundNo),
          owner: sleepy.publicKey,
        })
        .signers([sleepy])
        .rpc();
      assert.fail("banido nao deveria conseguir submeter");
    } catch (e) {
      assert.include(e.toString(), "ParticipantBanned");
    }
  });

  it("nao penaliza duas vezes o mesmo participante", async () => {
    try {
      await program.methods
        .penalizeParticipant(1)
        .accounts({
          config: configPda,
          participant: participantPda(sleepy.publicKey),
          authority: authority.publicKey,
        })
        .rpc();
      assert.fail("deveria ter rejeitado a segunda penalidade");
    } catch (e) {
      assert.include(e.toString(), "AlreadyBanned");
    }
  });
});
