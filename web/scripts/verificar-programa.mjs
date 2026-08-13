#!/usr/bin/env node
/**
 * Verifica que o Program ID configurado e o IDL versionado batem com o que
 * está de fato publicado na Devnet.
 *
 * Existe por causa de dois riscos concretos deste projeto:
 *
 *  1. O IDL em `web/src/lib/idl/awakefl.json` foi derivado À MÃO do Rust,
 *     porque não há toolchain nesta máquina para gerá-lo. Se ele divergir do
 *     programa, as transações falham com erros de desserialização que não
 *     apontam para a causa — no meio de uma demo.
 *  2. Um Program ID errado (placeholder, ou de outro deploy) produz
 *     exatamente o mesmo sintoma ilegível.
 *
 * Não precisa de Rust, Solana CLI nem Anchor: usa o @solana/web3.js que já é
 * dependência do site. Só lê a chain, nunca assina nada.
 *
 *   npm run verificar                 # usa NEXT_PUBLIC_PROGRAM_ID do .env.local
 *   npm run verificar -- <ProgramID>  # ou um endereço explícito
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Connection, PublicKey } from "@solana/web3.js";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_WEB = resolve(AQUI, "..");
const RAIZ_REPO = resolve(RAIZ_WEB, "..");

const CAMINHO_IDL = resolve(RAIZ_WEB, "src/lib/idl/awakefl.json");
const CAMINHO_LIB_RS = resolve(RAIZ_REPO, "programs/awakefl/src/lib.rs");
const CAMINHO_ANCHOR_TOML = resolve(RAIZ_REPO, "Anchor.toml");

/** Endereço que o `anchor init` gera. Se for este, nenhum deploy foi feito. */
const PLACEHOLDER = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS";
const BPF_LOADER_UPGRADEAVEL = "BPFLoaderUpgradeab1e11111111111111111111111";

// Tamanhos vindos dos comentários de state.rs: 8 (discriminador) + INIT_SPACE.
const TAMANHOS_ESPERADOS = { Config: 57, Participant: 66, Contribution: 142 };

let falhas = 0;
let avisos = 0;

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const erro = (m) => {
  falhas++;
  console.log(`  \x1b[31m✕\x1b[0m ${m}`);
};
const aviso = (m) => {
  avisos++;
  console.log(`  \x1b[33m!\x1b[0m ${m}`);
};
const titulo = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`);

/** Discriminador do Anchor: os 8 primeiros bytes de sha256(prefixo + nome). */
const discriminador = (prefixo, nome) =>
  Array.from(createHash("sha256").update(`${prefixo}:${nome}`).digest().subarray(0, 8));

const iguais = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Lê NEXT_PUBLIC_PROGRAM_ID de .env.local / .env sem depender do dotenv. */
function programIdDoAmbiente() {
  if (process.env.NEXT_PUBLIC_PROGRAM_ID) return process.env.NEXT_PUBLIC_PROGRAM_ID.trim();
  for (const arquivo of [".env.local", ".env"]) {
    try {
      const texto = readFileSync(resolve(RAIZ_WEB, arquivo), "utf8");
      const achado = texto.match(/^\s*NEXT_PUBLIC_PROGRAM_ID\s*=\s*(.+)$/m);
      if (achado) {
        const valor = achado[1].trim().replace(/^["']|["']$/g, "");
        if (valor) return valor;
      }
    } catch {
      // arquivo ausente é o caso normal; seguimos para o próximo
    }
  }
  return null;
}

/** Extrai um endereço base58 de um arquivo, por regex, sem parsear a sintaxe. */
function endereroDeArquivo(caminho, padrao) {
  try {
    const achado = readFileSync(caminho, "utf8").match(padrao);
    return achado ? achado[1] : null;
  } catch {
    return null;
  }
}

async function principal() {
  const idBruto = process.argv[2] ?? programIdDoAmbiente();

  console.log("\n\x1b[1mAwakeFL — verificação do programa na Devnet\x1b[0m");

  // -------------------------------------------------------------------------
  titulo("1. Program ID");

  if (!idBruto) {
    erro(
      "Nenhum Program ID. Passe como argumento ou defina NEXT_PUBLIC_PROGRAM_ID em web/.env.local.",
    );
    return encerrar();
  }
  if (idBruto === PLACEHOLDER) {
    erro(`É o placeholder do anchor init (${PLACEHOLDER}). Nenhum deploy foi feito.`);
    return encerrar();
  }

  let programId;
  try {
    programId = new PublicKey(idBruto);
  } catch {
    erro(`"${idBruto}" não é um endereço base58 válido.`);
    return encerrar();
  }
  ok(`${programId.toBase58()}`);

  // Os três lugares que precisam concordar. Divergência aqui não impede a
  // demo de rodar, mas garante confusão na próxima vez que alguém buildar.
  const noRust = endereroDeArquivo(CAMINHO_LIB_RS, /declare_id!\("([^"]+)"\)/);
  const noToml = endereroDeArquivo(CAMINHO_ANCHOR_TOML, /^awakefl\s*=\s*"([^"]+)"/m);

  for (const [onde, valor] of [
    ["declare_id! em programs/awakefl/src/lib.rs", noRust],
    ["[programs.devnet] em Anchor.toml", noToml],
  ]) {
    if (!valor) aviso(`Não consegui ler o ID em ${onde}.`);
    else if (valor === PLACEHOLDER) aviso(`${onde} ainda tem o placeholder.`);
    else if (valor !== programId.toBase58()) aviso(`${onde} aponta para outro ID: ${valor}`);
    else ok(`${onde} confere.`);
  }

  // -------------------------------------------------------------------------
  titulo("2. O IDL é internamente consistente");

  const idl = JSON.parse(readFileSync(CAMINHO_IDL, "utf8"));

  const grupos = [
    ["global", idl.instructions ?? [], "instrução"],
    ["account", idl.accounts ?? [], "conta"],
    ["event", idl.events ?? [], "evento"],
  ];

  for (const [prefixo, itens, rotulo] of grupos) {
    let ruins = 0;
    for (const item of itens) {
      if (!item.discriminator) {
        erro(`${rotulo} "${item.name}" não tem discriminador no IDL.`);
        ruins++;
        continue;
      }
      const esperado = discriminador(prefixo, item.name);
      if (!iguais(esperado, item.discriminator)) {
        erro(
          `${rotulo} "${item.name}": discriminador não bate com sha256("${prefixo}:${item.name}").\n` +
            `      no IDL:   [${item.discriminator}]\n` +
            `      esperado: [${esperado}]`,
        );
        ruins++;
      }
    }
    if (ruins === 0 && itens.length > 0) {
      ok(`${itens.length} ${rotulo}(s) com discriminador correto.`);
    }
  }

  if (idl.address !== programId.toBase58()) {
    // Não é defeito: o site sobrescreve o address com a env var em runtime.
    aviso(`O "address" do IDL (${idl.address}) difere do ID verificado — ignorado em runtime.`);
  }

  // -------------------------------------------------------------------------
  titulo("3. O programa está publicado na Devnet");

  const rpc = process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";
  const conexao = new Connection(rpc, "confirmed");
  console.log(`  rpc: ${rpc}`);

  const conta = await conexao.getAccountInfo(programId);
  if (!conta) {
    erro("A conta não existe na Devnet. O ID está errado ou o deploy não aconteceu.");
    return encerrar();
  }
  if (!conta.executable) {
    erro("A conta existe mas NÃO é executável — isso não é um programa.");
    return encerrar();
  }
  ok("Conta existe e é executável.");

  const dono = conta.owner.toBase58();
  if (dono === BPF_LOADER_UPGRADEAVEL) ok("Pertence ao BPF Loader Upgradeable (atualizável).");
  else aviso(`Dono inesperado: ${dono}`);

  // -------------------------------------------------------------------------
  titulo("4. As contas on-chain batem com o IDL");

  // `getProgramAccounts` é a chamada cara do RPC: o endpoint público da Devnet
  // devolve 403 ou 429 com frequência. Falhar aqui não diz nada sobre o
  // programa, então é aviso e não erro — as seções anteriores já valeram.
  let emCadeia;
  try {
    emCadeia = await conexao.getProgramAccounts(programId);
  } catch (e) {
    aviso(
      `O RPC recusou o getProgramAccounts (${String(e.message).split("\n")[0].slice(0, 120)}).\n` +
        `      Isso é limite do endpoint público, não defeito do programa. Repita com um RPC\n` +
        `      dedicado: NEXT_PUBLIC_RPC_URL=<url> npm run verificar -- ${programId.toBase58()}`,
    );
    return encerrar();
  }

  if (emCadeia.length === 0) {
    aviso(
      "O programa não tem nenhuma conta ainda. Rode initialize (tela do Validador) e volte aqui.",
    );
    return encerrar();
  }
  ok(`${emCadeia.length} conta(s) encontradas.`);

  const porTipo = new Map((idl.accounts ?? []).map((a) => [a.name, []]));
  const desconhecidas = [];

  for (const { pubkey, account } of emCadeia) {
    const disc = Array.from(account.data.subarray(0, 8));
    const tipo = (idl.accounts ?? []).find((a) => iguais(a.discriminator, disc));
    if (tipo) porTipo.get(tipo.name).push({ pubkey, tamanho: account.data.length });
    else desconhecidas.push(pubkey.toBase58());
  }

  for (const [nome, lista] of porTipo) {
    if (lista.length === 0) {
      console.log(`  \x1b[90m·\x1b[0m ${nome}: nenhuma`);
      continue;
    }
    const esperado = TAMANHOS_ESPERADOS[nome];
    const errados = lista.filter((c) => esperado && c.tamanho !== esperado);
    if (errados.length > 0) {
      erro(
        `${nome}: ${errados.length} de ${lista.length} com tamanho inesperado ` +
          `(${errados[0].tamanho} bytes, esperado ${esperado}). O IDL está fora de sincronia com o programa.`,
      );
    } else {
      ok(`${nome}: ${lista.length} conta(s), ${esperado ?? "?"} bytes cada.`);
    }
  }

  if (desconhecidas.length > 0) {
    erro(
      `${desconhecidas.length} conta(s) com discriminador que o IDL não reconhece — ` +
        `sinal forte de que o programa publicado tem contas que o IDL não descreve. ` +
        `Ex.: ${desconhecidas[0]}`,
    );
  }

  encerrar();
}

function encerrar() {
  console.log("");
  if (falhas > 0) {
    console.log(
      `\x1b[31m${falhas} problema(s)\x1b[0m` + (avisos ? ` e ${avisos} aviso(s).` : "."),
    );
    console.log("O site vai falhar com erros de desserialização. Não use para demo.\n");
    process.exit(1);
  }
  if (avisos > 0) {
    console.log(`\x1b[33m${avisos} aviso(s)\x1b[0m — nada que impeça a demo.\n`);
  } else {
    console.log("\x1b[32mTudo confere.\x1b[0m\n");
  }
  process.exit(0);
}

principal().catch((e) => {
  console.error(`\n\x1b[31mFalhou:\x1b[0m ${e.message}\n`);
  process.exit(1);
});
