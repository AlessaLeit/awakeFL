"use client";

/**
 * Estado on-chain compartilhado pela área do participante.
 *
 * As cinco telas (visão geral, contribuição, extrato, regras, validador) olham
 * para o MESMO Config, os mesmos participantes e as mesmas contribuições. Sem
 * um provider, cada rota refaria as leituras da Devnet ao navegar e as telas
 * discordariam entre si sobre a rodada corrente por alguns segundos.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { BN, type Wallet } from "@coral-xyz/anchor";
import {
  useAnchorWallet,
  useConnection,
  useWallet,
} from "@solana/wallet-adapter-react";
import {
  mensagemDeErro,
  normalizaConfig,
  normalizaContribuicao,
  normalizaParticipante,
  pdaConfig,
  pdaContribution,
  pdaParticipant,
  programIdOrNull,
  readProgram,
  SYSTEM_PROGRAM_ID,
  walletProgram,
  type ConfigConta,
  type ContribuicaoConta,
  type FlProgram,
  type ParticipanteConta,
} from "./program";

export interface RegistroTx {
  sig: string;
  rotulo: string;
  /** Epoch ms do momento em que a assinatura voltou confirmada. */
  quando: number;
}

export interface FormularioContribuicao {
  /** SHA-256 em hexadecimal, já calculado no browser. Máx. 64 caracteres. */
  hash: string;
  nSamples: string;
  loss: string;
  accuracy: string;
}

/* O IDL é tipado como `Idl` genérico, então `program.methods` e
   `program.account` não têm assinatura estática. O `any` fica confinado aqui. */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Metodos = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

interface Estado {
  programId: PublicKey | null;
  conectado: boolean;
  publicKey: PublicKey | null;

  config: ConfigConta | null;
  participantes: ParticipanteConta[];
  contribuicoes: ContribuicaoConta[];

  meuParticipantePda: PublicKey | null;
  meuParticipante: ParticipanteConta | null;
  minhasContribuicoes: ContribuicaoConta[];
  souAutoridade: boolean;
  jaContribuiuNestaRodada: boolean;

  saldoSol: number | null;
  carregando: boolean;
  /** Chave da ação em voo, ou null. Trava só o botão que está assinando. */
  ocupado: string | null;
  erro: string | null;
  registros: RegistroTx[];

  carregar: () => Promise<void>;
  limparErro: () => void;
  inicializar: () => Promise<void>;
  registrar: () => Promise<void>;
  submeter: (dados: FormularioContribuicao) => Promise<void>;
  validar: (c: ContribuicaoConta, score: number) => Promise<void>;
  penalizar: (p: ParticipanteConta) => Promise<void>;
  avancarRodada: () => Promise<void>;
}

const Ctx = createContext<Estado | null>(null);

export function useAwakeFL(): Estado {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useAwakeFL precisa estar dentro de <EstadoAwakeFL>.");
  }
  return ctx;
}

export function EstadoAwakeFL({ children }: { children: React.ReactNode }) {
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
  const [registros, setRegistros] = useState<RegistroTx[]>([]);

  // -------------------------------------------------------------------------
  // Leitura
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

  // -------------------------------------------------------------------------
  // Derivados
  // -------------------------------------------------------------------------

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

  const minhasContribuicoes = useMemo(
    () =>
      meuParticipantePda
        ? contribuicoes.filter((c) => c.participant.equals(meuParticipantePda))
        : [],
    [contribuicoes, meuParticipantePda],
  );

  const souAutoridade = Boolean(
    config && publicKey && config.authority.equals(publicKey),
  );

  const jaContribuiuNestaRodada = Boolean(
    config && minhasContribuicoes.some((c) => c.round === config.currentRound),
  );

  // Só exibe o saldo se ele for da carteira conectada agora.
  const saldoSol =
    publicKey && saldo?.dono === publicKey.toBase58() ? saldo.sol : null;

  // -------------------------------------------------------------------------
  // Escrita
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
        setRegistros((r) =>
          [{ sig, rotulo, quando: Date.now() }, ...r].slice(0, 20),
        );
        await carregar();
      } catch (e) {
        setErro(mensagemDeErro(e));
      } finally {
        setOcupado(null);
      }
    },
    [anchorWallet, carregar, connection, programId, publicKey],
  );

  const inicializar = useCallback(
    () =>
      enviar("init", "initialize", async (program, pid, dono) =>
        (program.methods as Metodos)
          .initialize()
          .accountsPartial({
            config: pdaConfig(pid),
            authority: dono,
            systemProgram: SYSTEM_PROGRAM_ID,
          })
          .rpc(),
      ),
    [enviar],
  );

  const registrar = useCallback(
    () =>
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
      ),
    [enviar],
  );

  const submeter = useCallback(
    (dados: FormularioContribuicao) =>
      enviar("submeter", "submit_contribution", async (program, pid, dono) => {
        if (!config) throw new Error("Config ainda não carregado.");
        const participante = pdaParticipant(pid, dono);
        // O hash chega pronto da tela: o que vai para a chain é o compromisso
        // criptográfico, nunca o tensor de pesos.
        return (program.methods as Metodos)
          .submitContribution(
            dados.hash,
            new BN(dados.nSamples || "0"),
            Number(dados.loss),
            Number(dados.accuracy),
          )
          .accountsPartial({
            config: pdaConfig(pid),
            participant: participante,
            contribution: pdaContribution(
              pid,
              participante,
              config.currentRound,
            ),
            owner: dono,
            systemProgram: SYSTEM_PROGRAM_ID,
          })
          .rpc();
      }),
    [config, enviar],
  );

  const validar = useCallback(
    (c: ContribuicaoConta, score: number) =>
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
      ),
    [enviar],
  );

  const penalizar = useCallback(
    (p: ParticipanteConta) =>
      enviar(
        `penalizar-${p.endereco.toBase58()}`,
        "penalize_participant",
        async (program, pid, dono) =>
          (program.methods as Metodos)
            // reason_code 1 = reputation_below_threshold, a mesma tabela do
            // onchain_interface.py (2 = manual_authority_action). O painel só
            // habilita o botão abaixo do limiar, então 1 é sempre o motivo
            // certo aqui — se um dia houver banimento manual, o código muda.
            .penalizeParticipant(1)
            .accountsPartial({
              config: pdaConfig(pid),
              participant: p.endereco,
              authority: dono,
            })
            .rpc(),
      ),
    [enviar],
  );

  const avancarRodada = useCallback(
    () =>
      enviar("rodada", "advance_round", async (program, pid, dono) =>
        (program.methods as Metodos)
          .advanceRound()
          .accountsPartial({ config: pdaConfig(pid), authority: dono })
          .rpc(),
      ),
    [enviar],
  );

  const limparErro = useCallback(() => setErro(null), []);

  const valor: Estado = {
    programId,
    conectado: connected,
    publicKey: publicKey ?? null,
    config,
    participantes,
    contribuicoes,
    meuParticipantePda,
    meuParticipante,
    minhasContribuicoes,
    souAutoridade,
    jaContribuiuNestaRodada,
    saldoSol,
    carregando,
    ocupado,
    erro,
    registros,
    carregar,
    limparErro,
    inicializar,
    registrar,
    submeter,
    validar,
    penalizar,
    avancarRodada,
  };

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
