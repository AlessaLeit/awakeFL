"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { BN, type Wallet } from "@coral-xyz/anchor";
import {
  useAnchorWallet,
  useConnection,
  useWallet,
} from "@solana/wallet-adapter-react";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import StatTile from "@/components/StatTile";
import {
  encurta,
  explorerConta,
  explorerTx,
  mensagemDeErro,
  normalizaConfig,
  normalizaContribuicao,
  normalizaParticipante,
  pdaConfig,
  pdaContribution,
  pdaParticipant,
  programIdOrNull,
  readProgram,
  sha256Hex,
  SYSTEM_PROGRAM_ID,
  walletProgram,
  type ConfigConta,
  type ContribuicaoConta,
  type FlProgram,
  type ParticipanteConta,
} from "@/lib/anchor/program";

// O botão da carteira lê `window` na primeira renderização; renderizá-lo no
// servidor produz um mismatch de hidratação a cada carregamento.
const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false, loading: () => <div className="h-[38px] w-[168px]" /> },
);

const FAUCET = "https://faucet.solana.com";

interface Registro {
  sig: string;
  rotulo: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Metodos = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export default function Devnet() {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const anchorWallet = useAnchorWallet();

  const programId = useMemo(() => programIdOrNull(), []);

  const [config, setConfig] = useState<ConfigConta | null>(null);
  const [participantes, setParticipantes] = useState<ParticipanteConta[]>([]);
  const [contribuicoes, setContribuicoes] = useState<ContribuicaoConta[]>([]);
  // O saldo guarda de quem ele é: sem isso, trocar de carteira mostra por um
  // instante o saldo da anterior.
  const [saldo, setSaldo] = useState<{ dono: string; sol: number } | null>(
    null,
  );
  const [carregando, setCarregando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [registros, setRegistros] = useState<Registro[]>([]);

  // Formulário de contribuição
  const [semente, setSemente] = useState("pesos-locais-rodada-atual");
  const [nSamples, setNSamples] = useState("1200");
  const [loss, setLoss] = useState("0.31");
  const [accuracy, setAccuracy] = useState("0.87");
  const [scores, setScores] = useState<Record<string, string>>({});

  const meuParticipantePda = useMemo(
    () =>
      programId && publicKey ? pdaParticipant(programId, publicKey) : null,
    [programId, publicKey],
  );

  const meuParticipante = useMemo(
    () =>
      meuParticipantePda
        ? (participantes.find((p) => p.endereco.equals(meuParticipantePda)) ??
          null)
        : null,
    [participantes, meuParticipantePda],
  );

  const souAutoridade = Boolean(
    config && publicKey && config.authority.equals(publicKey),
  );

  // -------------------------------------------------------------------------
  // Leitura on-chain
  // -------------------------------------------------------------------------

  const carregar = useCallback(async () => {
    if (!programId) return;
    setCarregando(true);
    setErro(null);
    try {
      const program = readProgram(connection, programId);
      const conta = program.account as Metodos;

      const cfgRaw = await conta.config.fetchNullable(pdaConfig(programId));
      setConfig(cfgRaw ? normalizaConfig(cfgRaw) : null);

      const [ps, cs] = await Promise.all([
        conta.participant.all(),
        conta.contribution.all(),
      ]);

      setParticipantes(
        (ps as Metodos[])
          .map((p) => normalizaParticipante(p.publicKey, p.account))
          .sort((a, b) => b.reputation - a.reputation),
      );
      setContribuicoes(
        (cs as Metodos[])
          .map((c) => normalizaContribuicao(c.publicKey, c.account))
          .sort((a, b) => b.round - a.round),
      );
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setCarregando(false);
    }
  }, [connection, programId]);

  useEffect(() => {
    // Ler a chain é sincronizar com um sistema externo — o caso de uso do
    // useEffect. O que a regra flagra é o `setCarregando(true)` síncrono dentro
    // de `carregar`, que só acende o indicador de leitura.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void carregar();
  }, [carregar]);

  useEffect(() => {
    if (!publicKey) return;
    const dono = publicKey.toBase58();
    let vivo = true;
    connection
      .getBalance(publicKey)
      .then((l) => vivo && setSaldo({ dono, sol: l / LAMPORTS_PER_SOL }))
      .catch(() => vivo && setSaldo(null));
    return () => {
      vivo = false;
    };
  }, [connection, publicKey, registros.length]);

  // Só exibe o saldo se ele for da carteira conectada agora.
  const saldoSol =
    publicKey && saldo?.dono === publicKey.toBase58() ? saldo.sol : null;

  // -------------------------------------------------------------------------
  // Escrita on-chain
  // -------------------------------------------------------------------------

  /** Envolve toda transação: trava o botão, traduz o erro e recarrega o estado. */
  const enviar = useCallback(
    async (
      chave: string,
      rotulo: string,
      fn: (
        program: FlProgram,
        programId: PublicKey,
        dono: PublicKey,
      ) => Promise<string>,
    ) => {
      if (!programId || !anchorWallet || !publicKey) return;
      setOcupado(chave);
      setErro(null);
      try {
        const program = walletProgram(
          connection,
          anchorWallet as Wallet,
          programId,
        );
        const sig = await fn(program, programId, publicKey);
        setRegistros((r) => [{ sig, rotulo }, ...r].slice(0, 12));
        await carregar();
      } catch (e) {
        setErro(mensagemDeErro(e));
      } finally {
        setOcupado(null);
      }
    },
    [anchorWallet, carregar, connection, programId, publicKey],
  );

  const inicializar = () =>
    enviar("init", "initialize", async (program, pid, dono) =>
      (program.methods as Metodos)
        .initialize()
        .accountsPartial({
          config: pdaConfig(pid),
          authority: dono,
          systemProgram: SYSTEM_PROGRAM_ID,
        })
        .rpc(),
    );

  const registrar = () =>
    enviar("registrar", "register_participant", async (program, pid, dono) =>
      (program.methods as Metodos)
        .registerParticipant()
        .accountsPartial({
          config: pdaConfig(pid),
          participant: pdaParticipant(pid, dono),
          owner: dono,
          systemProgram: SYSTEM_PROGRAM_ID,
        })
        .rpc(),
    );

  const submeter = () =>
    enviar("submeter", "submit_contribution", async (program, pid, dono) => {
      if (!config) throw new Error("Config ainda não carregado.");
      const participante = pdaParticipant(pid, dono);
      // O hash é calculado no browser a partir da semente: o que vai para a
      // chain é o compromisso, nunca o tensor de pesos.
      const hash = await sha256Hex(
        `${semente}|${dono.toBase58()}|${config.currentRound}`,
      );
      return (program.methods as Metodos)
        .submitContribution(
          hash,
          new BN(nSamples || "0"),
          Number(loss),
          Number(accuracy),
        )
        .accountsPartial({
          config: pdaConfig(pid),
          participant: participante,
          contribution: pdaContribution(pid, participante, config.currentRound),
          owner: dono,
          systemProgram: SYSTEM_PROGRAM_ID,
        })
        .rpc();
    });

  const validar = (c: ContribuicaoConta, score: number) =>
    enviar(
      `validar-${c.endereco.toBase58()}`,
      "validate_contribution",
      async (program, pid, dono) =>
        (program.methods as Metodos)
          .validateContribution(new BN(score))
          .accountsPartial({
            config: pdaConfig(pid),
            participant: c.participant,
            contribution: c.endereco,
            authority: dono,
          })
          .rpc(),
    );

  const penalizar = (p: ParticipanteConta) =>
    enviar(
      `penalizar-${p.endereco.toBase58()}`,
      "penalize_participant",
      async (program, pid, dono) =>
        (program.methods as Metodos)
          .penalizeParticipant(1)
          .accountsPartial({
            config: pdaConfig(pid),
            participant: p.endereco,
            authority: dono,
          })
          .rpc(),
    );

  const avancarRodada = () =>
    enviar("rodada", "advance_round", async (program, pid, dono) =>
      (program.methods as Metodos)
        .advanceRound()
        .accountsPartial({ config: pdaConfig(pid), authority: dono })
        .rpc(),
    );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const jaContribuiuNestaRodada = Boolean(
    config &&
    meuParticipantePda &&
    contribuicoes.some(
      (c) =>
        c.round === config.currentRound &&
        c.participant.equals(meuParticipantePda),
    ),
  );

  const pendentes = config
    ? contribuicoes.filter((c) => c.status === "Pendente")
    : [];

  const semSaldo = saldoSol !== null && saldoSol < 0.01;

  if (!programId) {
    return (
      <>
        <Nav />
        <main className="mx-auto max-w-3xl px-5 py-16">
          <h1 className="text-2xl font-semibold tracking-tight">
            Console da Devnet
          </h1>
          <div
            className="vidro mt-6 p-6"
            style={{
              borderColor: "var(--aviso)",
            }}
          >
            <h2 className="text-base font-semibold">
              Programa ainda não configurado
            </h2>
            <p
              className="mt-2 text-sm leading-relaxed"
              style={{ color: "var(--tinta-2)" }}
            >
              Esta página fala com um programa Anchor publicado na Devnet, e
              nenhum Program ID foi informado. Depois do deploy, defina a
              variável de ambiente <code>NEXT_PUBLIC_PROGRAM_ID</code> com o
              endereço do programa e publique de novo.
            </p>
            <p className="mt-4 text-sm" style={{ color: "var(--tinta-2)" }}>
              Enquanto isso, a{" "}
              <a
                href="/simulacao"
                className="underline"
                style={{ color: "var(--acento)" }}
              >
                simulação do ciclo
              </a>{" "}
              mostra as mesmas regras sem precisar de carteira.
            </p>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-6xl px-5 py-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Console da Devnet
            </h1>
            <p
              className="mt-1.5 max-w-2xl text-sm"
              style={{ color: "var(--tinta-2)" }}
            >
              Aqui não há simulação: cada botão assina e envia uma transação
              real para a Devnet da Solana, e cada número abaixo foi lido das
              contas do programa. Esta é a visão crua de todas as contas — para
              operar como participante, use a{" "}
              <Link
                href="/painel"
                className="underline"
                style={{ color: "var(--acento)" }}
              >
                área do participante
              </Link>
              .
            </p>
            <p className="mt-2 text-xs" style={{ color: "var(--tinta-muda)" }}>
              programa{" "}
              <a
                href={explorerConta(programId)}
                target="_blank"
                rel="noopener noreferrer"
                className="tabular underline"
              >
                {encurta(programId, 6)}
              </a>
            </p>
          </div>
          <div className="flex items-center gap-3">
            {saldoSol !== null && (
              <span
                className="tabular text-sm"
                style={{ color: "var(--tinta-2)" }}
              >
                {saldoSol.toFixed(3)} SOL
              </span>
            )}
            <WalletMultiButton />
          </div>
        </div>

        {erro && (
          <div
            className="vidro mb-6 p-4 text-sm"
            style={{
              borderColor: "var(--critico)",
              background: "var(--critico-lavado)",
            }}
          >
            <strong style={{ color: "var(--critico)" }}>Falhou:</strong>{" "}
            <span style={{ color: "var(--tinta-2)" }}>{erro}</span>
          </div>
        )}

        {connected && semSaldo && (
          <div
            className="vidro mb-6 p-4 text-sm"
            style={{ borderColor: "var(--aviso)" }}
          >
            <span style={{ color: "var(--tinta-2)" }}>
              Sua carteira está sem SOL de Devnet — toda conta criada aqui paga
              aluguel. Peça no{" "}
              <a
                href={FAUCET}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                faucet oficial
              </a>{" "}
              e recarregue.
            </span>
          </div>
        )}

        {/* Estado global do programa */}
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            rotulo="Rodada corrente"
            valor={config ? config.currentRound : "—"}
            nota={
              config ? "lida do Config on-chain" : "config não inicializado"
            }
          />
          <StatTile
            rotulo="Participantes"
            valor={config ? config.totalParticipants : "—"}
            nota={`${participantes.length} contas encontradas`}
          />
          <StatTile
            rotulo="Contribuições"
            valor={contribuicoes.length}
            nota={`${pendentes.length} pendentes`}
          />
          <StatTile
            rotulo="Banidos"
            valor={participantes.filter((p) => p.isBanned).length}
            nota="banimento permanente"
            tom={participantes.some((p) => p.isBanned) ? "critico" : "neutro"}
          />
        </div>

        {!connected && (
          <div className="vidro mb-6 p-5">
            <h2 className="text-base font-semibold">Conecte uma carteira</h2>
            <p className="mt-2 text-sm" style={{ color: "var(--tinta-2)" }}>
              Phantom ou Solflare, com a rede em <strong>Devnet</strong>. Sem
              carteira a página só lê o estado do programa.
            </p>
          </div>
        )}

        {/* Config / autoridade */}
        <section className="vidro mb-6 p-5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
            <h2 className="text-base font-semibold">Config do sistema</h2>
            {config ? (
              <span className="text-sm" style={{ color: "var(--tinta-2)" }}>
                autoridade{" "}
                <a
                  href={explorerConta(config.authority)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tabular underline"
                >
                  {encurta(config.authority)}
                </a>
                {souAutoridade && (
                  <span className="ml-2" style={{ color: "var(--texto-bom)" }}>
                    (é você)
                  </span>
                )}
              </span>
            ) : (
              <span className="text-sm" style={{ color: "var(--tinta-muda)" }}>
                ainda não existe
              </span>
            )}
          </div>

          {!config ? (
            <>
              <p className="mt-2 text-sm" style={{ color: "var(--tinta-2)" }}>
                O <code>Config</code> é criado uma única vez e quem assinar vira
                a autoridade — o agregador que valida contribuições e pune
                maliciosos.
              </p>
              <button
                onClick={inicializar}
                disabled={!connected || ocupado !== null}
                className="btn-neon mt-4 px-4 py-2.5 text-sm disabled:opacity-50"
              >
                {ocupado === "init" ? "Assinando…" : "Inicializar programa"}
              </button>
            </>
          ) : souAutoridade ? (
            <>
              <p className="mt-2 text-sm" style={{ color: "var(--tinta-2)" }}>
                Você é o agregador desta instância. Avançar a rodada libera um
                novo slot de contribuição para todos os participantes.
              </p>
              <button
                onClick={avancarRodada}
                disabled={ocupado !== null}
                className="btn-contorno mt-4 px-4 py-2.5 text-sm disabled:opacity-50"
              >
                {ocupado === "rodada"
                  ? "Assinando…"
                  : `Avançar para a rodada ${config.currentRound + 1}`}
              </button>
            </>
          ) : (
            <p className="mt-2 text-sm" style={{ color: "var(--tinta-2)" }}>
              Validar e penalizar exige a chave da autoridade. Com esta carteira
              você pode se registrar e contribuir.
            </p>
          )}
        </section>

        {/* Meu participante */}
        {connected && config && (
          <section className="vidro mb-6 p-5">
            <h2 className="text-base font-semibold">Meu nó de treinamento</h2>

            {!meuParticipante ? (
              <>
                <p className="mt-2 text-sm" style={{ color: "var(--tinta-2)" }}>
                  Esta carteira ainda não tem conta de participante. O registro
                  cria um PDA com reputação inicial 500.
                </p>
                <button
                  onClick={registrar}
                  disabled={ocupado !== null}
                  className="btn-neon mt-4 px-4 py-2.5 text-sm disabled:opacity-50"
                >
                  {ocupado === "registrar"
                    ? "Assinando…"
                    : "Registrar participante"}
                </button>
              </>
            ) : (
              <>
                <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
                  <span style={{ color: "var(--tinta-2)" }}>
                    reputação{" "}
                    <span
                      className="tabular text-lg font-semibold"
                      style={{
                        color: meuParticipante.isBanned
                          ? "var(--critico)"
                          : "var(--tinta)",
                      }}
                    >
                      {meuParticipante.reputation}
                    </span>
                  </span>
                  <span style={{ color: "var(--tinta-2)" }}>
                    contribuições{" "}
                    <span
                      className="tabular font-semibold"
                      style={{ color: "var(--tinta)" }}
                    >
                      {meuParticipante.contribCount}
                    </span>
                  </span>
                  <a
                    href={explorerConta(meuParticipante.endereco)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tabular text-xs underline"
                    style={{ color: "var(--tinta-muda)" }}
                  >
                    conta {encurta(meuParticipante.endereco)}
                  </a>
                </div>

                {meuParticipante.isBanned ? (
                  <p
                    className="mt-4 text-sm"
                    style={{ color: "var(--critico)" }}
                  >
                    Banido. O programa não expõe nenhuma instrução que reverta
                    isto — nem para a autoridade.
                  </p>
                ) : jaContribuiuNestaRodada ? (
                  <p
                    className="mt-4 text-sm"
                    style={{ color: "var(--tinta-2)" }}
                  >
                    Você já submeteu na rodada {config.currentRound}. O PDA da
                    contribuição é único por rodada, então uma segunda tentativa
                    falharia on-chain. Aguarde a autoridade avançar a rodada.
                  </p>
                ) : (
                  <div className="mt-5">
                    <h3 className="text-sm font-semibold">
                      Submeter contribuição da rodada {config.currentRound}
                    </h3>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <label
                        className="text-xs"
                        style={{ color: "var(--tinta-2)" }}
                      >
                        Semente do hash
                        <input
                          value={semente}
                          onChange={(e) => setSemente(e.target.value)}
                          className="campo mt-2"
                        />
                      </label>
                      <label
                        className="text-xs"
                        style={{ color: "var(--tinta-2)" }}
                      >
                        Amostras (n_samples)
                        <input
                          value={nSamples}
                          onChange={(e) =>
                            setNSamples(e.target.value.replace(/\D/g, ""))
                          }
                          inputMode="numeric"
                          className="campo tabular mt-2"
                        />
                      </label>
                      <label
                        className="text-xs"
                        style={{ color: "var(--tinta-2)" }}
                      >
                        Loss
                        <input
                          value={loss}
                          onChange={(e) => setLoss(e.target.value)}
                          inputMode="decimal"
                          className="campo tabular mt-2"
                        />
                      </label>
                      <label
                        className="text-xs"
                        style={{ color: "var(--tinta-2)" }}
                      >
                        Acurácia
                        <input
                          value={accuracy}
                          onChange={(e) => setAccuracy(e.target.value)}
                          inputMode="decimal"
                          className="campo tabular mt-2"
                        />
                      </label>
                    </div>
                    <button
                      onClick={submeter}
                      disabled={ocupado !== null}
                      className="btn-neon mt-4 px-4 py-2.5 text-sm disabled:opacity-50"
                    >
                      {ocupado === "submeter"
                        ? "Assinando…"
                        : "Submeter contribuição"}
                    </button>
                    <p
                      className="mt-2 text-xs"
                      style={{ color: "var(--tinta-muda)" }}
                    >
                      O SHA-256 é calculado no browser: só o hash de 64
                      caracteres vai para a chain, junto das métricas
                      auto-declaradas.
                    </p>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        <div className="grid gap-6 lg:grid-cols-5">
          {/* Participantes */}
          <section className="lg:col-span-3">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-base font-semibold">
                Participantes on-chain
              </h2>
              <button
                onClick={carregar}
                disabled={carregando}
                className="text-xs underline disabled:opacity-50"
                style={{ color: "var(--tinta-2)" }}
              >
                {carregando ? "lendo…" : "recarregar"}
              </button>
            </div>
            <div className="vidro overflow-x-auto ">
              <table className="w-full min-w-[480px] border-collapse text-sm">
                <thead>
                  <tr style={{ color: "var(--tinta-2)" }}>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left font-medium"
                    >
                      Conta
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-right font-medium"
                    >
                      Reputação
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-right font-medium"
                    >
                      Contrib.
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left font-medium"
                    >
                      Situação
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {participantes.length === 0 && (
                    <tr
                      className="border-t"
                      style={{ borderColor: "var(--borda)" }}
                    >
                      <td
                        colSpan={4}
                        className="px-4 py-6 text-center"
                        style={{ color: "var(--tinta-muda)" }}
                      >
                        {carregando
                          ? "Lendo a Devnet…"
                          : "Nenhum participante registrado ainda."}
                      </td>
                    </tr>
                  )}
                  {participantes.map((p) => {
                    const meu = Boolean(
                      meuParticipantePda &&
                      p.endereco.equals(meuParticipantePda),
                    );
                    return (
                      <tr
                        key={p.endereco.toBase58()}
                        className="border-t"
                        style={{ borderColor: "var(--borda)" }}
                      >
                        <th
                          scope="row"
                          className="px-4 py-2.5 text-left font-normal"
                        >
                          <a
                            href={explorerConta(p.owner)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="tabular underline"
                            style={{ color: "var(--tinta)" }}
                          >
                            {encurta(p.owner)}
                          </a>
                          {meu && (
                            <span
                              className="ml-2 text-xs"
                              style={{ color: "var(--acento)" }}
                            >
                              você
                            </span>
                          )}
                        </th>
                        <td
                          className="tabular px-4 py-2.5 text-right font-semibold"
                          style={{
                            color: p.isBanned
                              ? "var(--critico)"
                              : "var(--tinta)",
                          }}
                        >
                          {p.reputation}
                        </td>
                        <td
                          className="tabular px-4 py-2.5 text-right"
                          style={{ color: "var(--tinta-2)" }}
                        >
                          {p.contribCount}
                        </td>
                        <td className="px-4 py-2.5">
                          {p.isBanned ? (
                            <span style={{ color: "var(--critico)" }}>
                              ⊘ banido
                            </span>
                          ) : souAutoridade ? (
                            <button
                              onClick={() => penalizar(p)}
                              disabled={ocupado !== null}
                              className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                              style={{
                                borderColor: "var(--critico)",
                                color: "var(--critico)",
                              }}
                            >
                              Penalizar
                            </button>
                          ) : (
                            <span style={{ color: "var(--tinta-2)" }}>
                              ativo
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Contribuições */}
            <h2 className="mb-2 mt-6 text-base font-semibold">Contribuições</h2>
            <div className="vidro overflow-x-auto ">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead>
                  <tr style={{ color: "var(--tinta-2)" }}>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left font-medium"
                    >
                      Rodada
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left font-medium"
                    >
                      Participante
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-right font-medium"
                    >
                      Amostras
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-right font-medium"
                    >
                      Acurácia
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left font-medium"
                    >
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {contribuicoes.length === 0 && (
                    <tr
                      className="border-t"
                      style={{ borderColor: "var(--borda)" }}
                    >
                      <td
                        colSpan={5}
                        className="px-4 py-6 text-center"
                        style={{ color: "var(--tinta-muda)" }}
                      >
                        Nenhuma contribuição submetida ainda.
                      </td>
                    </tr>
                  )}
                  {contribuicoes.map((c) => {
                    const chave = c.endereco.toBase58();
                    return (
                      <tr
                        key={chave}
                        className="border-t"
                        style={{ borderColor: "var(--borda)" }}
                      >
                        <td
                          className="tabular px-4 py-2.5"
                          style={{ color: "var(--tinta-2)" }}
                        >
                          R{c.round}
                        </td>
                        <td className="px-4 py-2.5">
                          <a
                            href={explorerConta(c.participant)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="tabular underline"
                            style={{ color: "var(--tinta)" }}
                          >
                            {encurta(c.participant)}
                          </a>
                        </td>
                        <td
                          className="tabular px-4 py-2.5 text-right"
                          style={{ color: "var(--tinta-2)" }}
                        >
                          {c.nSamples}
                        </td>
                        <td
                          className="tabular px-4 py-2.5 text-right"
                          style={{ color: "var(--tinta-2)" }}
                        >
                          {(c.accuracy * 100).toFixed(1)}%
                        </td>
                        <td className="px-4 py-2.5">
                          {c.status !== "Pendente" ? (
                            <span
                              style={{
                                color:
                                  c.status === "Aprovado"
                                    ? "var(--texto-bom)"
                                    : "var(--critico)",
                              }}
                            >
                              {c.status === "Aprovado" ? "✓" : "✕"} {c.status}
                            </span>
                          ) : souAutoridade ? (
                            <span className="flex items-center gap-1.5">
                              <input
                                value={scores[chave] ?? ""}
                                onChange={(e) =>
                                  setScores((s) => ({
                                    ...s,
                                    [chave]: e.target.value
                                      .replace(/\D/g, "")
                                      .slice(0, 4),
                                  }))
                                }
                                placeholder="0–1000"
                                inputMode="numeric"
                                className="campo tabular w-20 px-2 py-1 text-xs"
                              />
                              <button
                                onClick={() =>
                                  validar(c, Number(scores[chave]))
                                }
                                disabled={
                                  ocupado !== null ||
                                  scores[chave] === undefined ||
                                  scores[chave] === "" ||
                                  Number(scores[chave]) > 1000
                                }
                                className="btn-neon px-2 py-1 text-xs disabled:opacity-40"
                              >
                                Validar
                              </button>
                            </span>
                          ) : (
                            <span style={{ color: "var(--aviso)" }}>
                              • Pendente
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Transações desta sessão */}
          <section className="lg:col-span-2">
            <h2 className="mb-2 text-base font-semibold">
              Transações desta sessão
            </h2>
            <ol className="vidro max-h-[520px] overflow-y-auto text-sm">
              {registros.length === 0 && (
                <li
                  className="px-4 py-6 text-center"
                  style={{ color: "var(--tinta-muda)" }}
                >
                  Nada enviado ainda. Cada ação aqui vira uma assinatura
                  verificável no explorador.
                </li>
              )}
              {registros.map((r) => (
                <li
                  key={r.sig}
                  className="border-b px-4 py-2.5 last:border-b-0"
                  style={{ borderColor: "var(--borda)" }}
                >
                  <code
                    className="text-xs font-medium"
                    style={{ color: "var(--tinta)" }}
                  >
                    {r.rotulo}()
                  </code>
                  <a
                    href={explorerTx(r.sig)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tabular mt-1 block text-[11px] underline"
                    style={{ color: "var(--tinta-muda)" }}
                  >
                    {encurta(r.sig, 8)}
                  </a>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <p className="mt-8 text-xs" style={{ color: "var(--tinta-muda)" }}>
          Devnet da Solana. O SOL usado aqui não tem valor e as contas são
          públicas — qualquer pessoa audita este estado sem pedir acesso, que é
          exatamente o ponto do projeto.
        </p>
      </main>
      <Footer />
    </>
  );
}
