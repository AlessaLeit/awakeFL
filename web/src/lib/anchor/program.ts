import {
  AnchorProvider,
  BN,
  Program,
  type Idl,
  type Wallet,
} from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import rawIdl from "@/lib/idl/awakefl.json";

/**
 * O Program ID vem do deploy na Devnet, não do repo: o `declare_id!` versionado
 * ainda é o placeholder que o Anchor gera, e o Solana Playground reescreve esse
 * valor no build. Por isso a fonte da verdade aqui é a variável de ambiente.
 */
export const PROGRAM_ID_STR = process.env.NEXT_PUBLIC_PROGRAM_ID ?? "";

/** Endereço do placeholder do Anchor. Se for este, nenhum deploy foi feito. */
const PLACEHOLDER = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS";

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";

/**
 * Devolve o Program ID ou `null` quando não há deploy configurado — a página
 * precisa distinguir "não configurado" de "configurado e quebrado", senão o
 * erro que aparece para o usuário é um `Invalid public key` sem contexto.
 */
export function programIdOrNull(): PublicKey | null {
  if (!PROGRAM_ID_STR || PROGRAM_ID_STR === PLACEHOLDER) return null;
  try {
    return new PublicKey(PROGRAM_ID_STR);
  } catch {
    return null;
  }
}

export const SYSTEM_PROGRAM_ID = SystemProgram.programId;

// ---------------------------------------------------------------------------
// PDAs — as mesmas seeds do programa Anchor
// ---------------------------------------------------------------------------

export function pdaConfig(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId,
  )[0];
}

export function pdaParticipant(
  programId: PublicKey,
  owner: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("participant"), owner.toBuffer()],
    programId,
  )[0];
}

export function pdaContribution(
  programId: PublicKey,
  participant: PublicKey,
  round: number | bigint | BN,
): PublicKey {
  // A seed é o u64 da rodada em little-endian, exatamente como
  // `config.current_round.to_le_bytes()` no programa.
  const round8 = new BN(round.toString()).toArrayLike(Buffer, "le", 8);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("contribution"), participant.toBuffer(), round8],
    programId,
  )[0];
}

// ---------------------------------------------------------------------------
// Construção do Program
// ---------------------------------------------------------------------------

function idlFor(programId: PublicKey): Idl {
  // O `address` do IDL é o que o Anchor usa como programId; o JSON versionado
  // carrega o placeholder, então sobrescrevemos com o deploy real.
  return { ...(rawIdl as Idl), address: programId.toBase58() };
}

export type FlProgram = Program<Idl>;

/** Program somente-leitura: serve para quem abre a página sem carteira. */
export function readProgram(
  connection: Connection,
  programId: PublicKey,
): FlProgram {
  // O AnchorProvider exige uma wallet, mas nenhum caminho de leitura a usa.
  const provider = new AnchorProvider(connection, {} as Wallet, {
    commitment: "confirmed",
  });
  return new Program(idlFor(programId), provider);
}

export function walletProgram(
  connection: Connection,
  wallet: Wallet,
  programId: PublicKey,
): FlProgram {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  return new Program(idlFor(programId), provider);
}

// ---------------------------------------------------------------------------
// Tipos das contas, já normalizados (o Anchor devolve BN e enums como objeto)
// ---------------------------------------------------------------------------

export type StatusContribuicaoOnChain =
  "Pendente" | "Aprovado" | "Rejeitado" | "Expirado";

export interface ConfigConta {
  authority: PublicKey;
  currentRound: number;
  totalParticipants: number;
  bump: number;
}

export interface ParticipanteConta {
  endereco: PublicKey;
  owner: PublicKey;
  reputation: number;
  contribCount: number;
  isBanned: boolean;
}

export interface ContribuicaoConta {
  endereco: PublicKey;
  participant: PublicKey;
  round: number;
  updateHash: string;
  nSamples: number;
  loss: number;
  accuracy: number;
  status: StatusContribuicaoOnChain;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function statusDe(raw: any): StatusContribuicaoOnChain {
  // O Borsh devolve o enum como `{ aprovado: {} }` (a chave vem camelCase).
  const chave = Object.keys(raw ?? {})[0];
  if (chave === "aprovado") return "Aprovado";
  if (chave === "rejeitado") return "Rejeitado";
  if (chave === "expirado") return "Expirado";
  return "Pendente";
}

export function normalizaConfig(raw: any): ConfigConta {
  return {
    authority: raw.authority as PublicKey,
    currentRound: (raw.currentRound as BN).toNumber(),
    totalParticipants: (raw.totalParticipants as BN).toNumber(),
    bump: raw.bump as number,
  };
}

export function normalizaParticipante(
  endereco: PublicKey,
  raw: any,
): ParticipanteConta {
  return {
    endereco,
    owner: raw.owner as PublicKey,
    reputation: (raw.reputation as BN).toNumber(),
    contribCount: (raw.contribCount as BN).toNumber(),
    isBanned: raw.isBanned as boolean,
  };
}

export function normalizaContribuicao(
  endereco: PublicKey,
  raw: any,
): ContribuicaoConta {
  return {
    endereco,
    participant: raw.participant as PublicKey,
    round: (raw.round as BN).toNumber(),
    updateHash: raw.updateHash as string,
    nSamples: (raw.nSamples as BN).toNumber(),
    loss: raw.loss as number,
    accuracy: raw.accuracy as number,
    status: statusDe(raw.status),
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Utilidades de UI
// ---------------------------------------------------------------------------

export const explorerTx = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

export const explorerConta = (endereco: PublicKey | string) =>
  `https://explorer.solana.com/address/${endereco.toString()}?cluster=devnet`;

export const encurta = (valor: PublicKey | string, n = 4) => {
  const s = valor.toString();
  return `${s.slice(0, n)}…${s.slice(-n)}`;
};

function paraHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** SHA-256 em hexadecimal — o mesmo formato de 64 chars que o programa espera. */
export async function sha256Hex(texto: string): Promise<string> {
  return paraHex(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)),
  );
}

/**
 * SHA-256 do conteúdo bruto de um arquivo — os pesos do modelo local.
 *
 * O arquivo é lido e digerido inteiramente no browser: nada é enviado a lugar
 * nenhum, e o que vai para a chain são os 64 caracteres do digest. É essa
 * assimetria que preserva a premissa do Federated Learning.
 */
export async function sha256DeArquivo(arquivo: File): Promise<string> {
  return paraHex(
    await crypto.subtle.digest("SHA-256", await arquivo.arrayBuffer()),
  );
}

/**
 * Traduz o erro de uma transação para algo legível. Sem isto, o usuário recebe
 * o dump inteiro dos logs do simulador na tela.
 */
export function mensagemDeErro(e: unknown): string {
  const err = e as { message?: string; error?: { errorMessage?: string } };
  const anchorMsg = err?.error?.errorMessage;
  if (anchorMsg) return anchorMsg;

  const msg = err?.message ?? String(e);
  if (/User rejected|rejected the request/i.test(msg)) {
    return "Transação recusada na carteira.";
  }
  if (/insufficient|0x1\b/i.test(msg) && /lamports|funds/i.test(msg)) {
    return "Saldo insuficiente na Devnet. Peça SOL no faucet e tente de novo.";
  }
  if (/already in use/i.test(msg)) {
    return "Essa conta já existe on-chain para esta rodada.";
  }
  return msg.split("\n")[0].slice(0, 200);
}
