/**
 * Compara o IDL legado gerado pelo Solana Playground (a verdade do que foi
 * compilado) com o IDL novo escrito à mão que o site usa.
 *
 * Os dois formatos diferem na embalagem, não no conteúdo: o antigo usa
 * camelCase e isMut/isSigner, o novo usa snake_case e writable/signer, e só o
 * novo carrega discriminadores. O que precisa bater é a SUBSTÂNCIA — nomes,
 * tipos, ordem dos campos e ordem das contas —, porque é ela que define o
 * layout dos bytes que vão para a chain.
 *
 * Rode isto SEMPRE que rebuildar no Playground:
 *
 *   npm run comparar-idl                    # usa playground/idl-gerado.json
 *   npm run comparar-idl -- outro-idl.json  # outro arquivo, na mesma pasta
 *
 * Os argumentos são NOMES DE ARQUIVO, não caminhos: o primeiro é lido de
 * `playground/`, o segundo de `web/src/lib/idl/`. Um IDL baixado precisa ser
 * copiado para lá antes (`cp ~/Downloads/idl.json playground/`).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, resolve } from "node:path";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_WEB = resolve(AQUI, "..");
const RAIZ_REPO = resolve(RAIZ_WEB, "..");

/**
 * Reduz o argumento ao nome do arquivo e o coloca numa pasta fixa.
 *
 * Em vez de validar o caminho que veio de fora, jogamos fora a parte que
 * poderia escapar: `../../../etc/passwd` vira `passwd` dentro da pasta
 * escolhida aqui. Não sobra caminho controlado por quem chamou.
 */
function arquivoEm(pasta, valor) {
  const nome = basename(String(valor));
  if (!nome || nome === "." || nome === "..") {
    throw new Error(`nome de arquivo inválido: ${valor}`);
  }
  return join(pasta, nome);
}

const PASTA_LEGADO = resolve(RAIZ_REPO, "playground");
const PASTA_NOVO = resolve(RAIZ_WEB, "src/lib/idl");

const caminhoLegado = arquivoEm(PASTA_LEGADO, process.argv[2] ?? "idl-gerado.json");
const caminhoNovo = arquivoEm(PASTA_NOVO, process.argv[3] ?? "awakefl.json");

console.log(`\n\x1b[1mIDL do build\x1b[0m  ${caminhoLegado}`);
console.log(`\x1b[1mIDL do site\x1b[0m   ${caminhoNovo}`);

const legado = JSON.parse(readFileSync(caminhoLegado, "utf8"));
const novo = JSON.parse(readFileSync(caminhoNovo, "utf8"));

let problemas = 0;
const falha = (m) => {
  problemas++;
  console.log(`  ✕ ${m}`);
};
const ok = (m) => console.log(`  ✓ ${m}`);

const paraSnake = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

/** Normaliza um tipo dos dois formatos para uma string comparável. */
function tipo(t) {
  if (typeof t === "string") return t === "publicKey" ? "pubkey" : t;
  if (t?.defined) {
    const nome = typeof t.defined === "string" ? t.defined : t.defined.name;
    return `defined:${nome}`;
  }
  if (t?.option) return `option<${tipo(t.option)}>`;
  if (t?.vec) return `vec<${tipo(t.vec)}>`;
  if (t?.array) return `array<${tipo(t.array[0])};${t.array[1]}>`;
  return JSON.stringify(t);
}

const campos = (lista) =>
  (lista ?? []).map((f) => `${paraSnake(f.name)}:${tipo(f.type)}`).join(" | ");

// ---------------------------------------------------------------------------
console.log("\n\x1b[1m1. Instruções\x1b[0m");

const novasInstr = new Map(novo.instructions.map((i) => [paraSnake(i.name), i]));
if (legado.instructions.length !== novo.instructions.length) {
  falha(
    `quantidade difere: ${legado.instructions.length} no build, ${novo.instructions.length} no site`,
  );
}

for (const iL of legado.instructions) {
  const chave = paraSnake(iL.name);
  const iN = novasInstr.get(chave);
  if (!iN) {
    falha(`instrução "${chave}" existe no build e falta no site`);
    continue;
  }

  const argsL = campos(iL.args);
  const argsN = campos(iN.args);
  if (argsL !== argsN) {
    falha(`${chave} — args divergem\n      build: ${argsL || "(nenhum)"}\n      site:  ${argsN || "(nenhum)"}`);
    continue;
  }

  // A ORDEM das contas é o que mais quebra na prática: o Anchor serializa
  // posicionalmente, então trocar duas contas de lugar produz um erro que não
  // aponta para a causa.
  const contasL = iL.accounts.map((a) => paraSnake(a.name)).join(" > ");
  const contasN = iN.accounts.map((a) => paraSnake(a.name)).join(" > ");
  if (contasL !== contasN) {
    falha(`${chave} — ordem/nomes das contas divergem\n      build: ${contasL}\n      site:  ${contasN}`);
    continue;
  }

  // Mutabilidade e assinatura
  let flagsRuins = [];
  iL.accounts.forEach((aL, idx) => {
    const aN = iN.accounts[idx];
    const mutL = Boolean(aL.isMut);
    const mutN = Boolean(aN.writable);
    const sigL = Boolean(aL.isSigner);
    const sigN = Boolean(aN.signer);
    if (mutL !== mutN) flagsRuins.push(`${paraSnake(aL.name)}: writable ${mutL} vs ${mutN}`);
    if (sigL !== sigN) flagsRuins.push(`${paraSnake(aL.name)}: signer ${sigL} vs ${sigN}`);
  });
  if (flagsRuins.length) {
    falha(`${chave} — flags divergem: ${flagsRuins.join("; ")}`);
    continue;
  }

  ok(`${chave} (${iL.args.length} arg, ${iL.accounts.length} contas)`);
}

// ---------------------------------------------------------------------------
console.log("\n\x1b[1m2. Contas\x1b[0m");

// No formato novo os campos das contas moram em `types`, não em `accounts`.
const tiposNovos = new Map((novo.types ?? []).map((t) => [t.name, t]));

for (const cL of legado.accounts) {
  const tN = tiposNovos.get(cL.name);
  if (!tN) {
    falha(`conta "${cL.name}" não tem definição de tipo no site`);
    continue;
  }
  const fL = campos(cL.type.fields);
  const fN = campos(tN.type.fields);
  if (fL !== fN) {
    falha(`${cL.name} — campos divergem\n      build: ${fL}\n      site:  ${fN}`);
    continue;
  }
  ok(`${cL.name} (${cL.type.fields.length} campos, na mesma ordem)`);
}

// ---------------------------------------------------------------------------
console.log("\n\x1b[1m3. Eventos\x1b[0m");

for (const eL of legado.events ?? []) {
  const tN = tiposNovos.get(eL.name);
  if (!tN) {
    falha(`evento "${eL.name}" não tem definição no site`);
    continue;
  }
  const fL = campos(eL.fields);
  const fN = campos(tN.type.fields);
  if (fL !== fN) {
    falha(`${eL.name} — campos divergem\n      build: ${fL}\n      site:  ${fN}`);
    continue;
  }
  ok(`${eL.name}`);
}

// ---------------------------------------------------------------------------
console.log("\n\x1b[1m4. Tipos auxiliares\x1b[0m");

for (const tL of legado.types ?? []) {
  const tN = tiposNovos.get(tL.name);
  if (!tN) {
    falha(`tipo "${tL.name}" falta no site`);
    continue;
  }
  if (tL.type.kind === "enum") {
    const vL = tL.type.variants.map((v) => v.name).join(" > ");
    const vN = (tN.type.variants ?? []).map((v) => v.name).join(" > ");
    if (vL !== vN) {
      falha(`${tL.name} — variantes divergem\n      build: ${vL}\n      site:  ${vN}`);
      continue;
    }
    ok(`${tL.name} (enum: ${vL})`);
  }
}

// ---------------------------------------------------------------------------
console.log("\n\x1b[1m5. Erros\x1b[0m");

const errosNovos = new Map((novo.errors ?? []).map((e) => [e.code, e]));
for (const eL of legado.errors ?? []) {
  const eN = errosNovos.get(eL.code);
  if (!eN) {
    falha(`erro ${eL.code} ${eL.name} falta no site`);
    continue;
  }
  if (eN.name !== eL.name || eN.msg !== eL.msg) {
    falha(`erro ${eL.code} — build: ${eL.name}/"${eL.msg}" | site: ${eN.name}/"${eN.msg}"`);
    continue;
  }
  ok(`${eL.code} ${eL.name}`);
}

console.log("");
if (problemas > 0) {
  console.log(`\x1b[31m${problemas} divergência(s)\x1b[0m entre o build real e o IDL do site.\n`);
  process.exit(1);
}
console.log("\x1b[32mO IDL escrito à mão bate com o build real em todos os pontos.\x1b[0m\n");
