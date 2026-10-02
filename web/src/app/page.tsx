import Image from "next/image";
import Link from "next/link";
import Coluna from "@/components/Coluna";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Federacao from "@/components/ilustracoes/Federacao";
import Orbita from "@/components/ilustracoes/Orbita";

const FERRAMENTAS = [
  "Solana",
  "Anchor",
  "Rust",
  "Next.js",
  "Flower",
  "PyTorch",
];

const PASSOS = [
  {
    n: "01",
    titulo: "Registrar",
    texto:
      "A instituição entra na federação com uma carteira e ganha uma conta de reputação na chain.",
  },
  {
    n: "02",
    titulo: "Contribuir",
    texto:
      "A cada rodada, o hash da atualização do modelo é gravado — os dados nunca saem de casa.",
  },
  {
    n: "03",
    titulo: "Validar",
    texto:
      "O agregador da rodada pontua a contribuição, e o score fica registrado onde ninguém reescreve.",
  },
  {
    n: "04",
    titulo: "Penalizar",
    texto:
      "Contribuição envenenada derruba a reputação numa transação — e o histórico fica como prova.",
    destaque: true,
  },
];

/* A ficha é a parte mais importante da página para o projeto: ela é onde o
   site diz o que NÃO foi medido. A latência aparece aqui como lacuna, com a
   mesma tipografia do resto — não escondida numa nota de rodapé. */
const FICHA = [
  ["Rede", "Solana Devnet"],
  ["Programa", "Anchor · publicado"],
  ["Ciclo", "registrar → contribuir → validar → penalizar"],
  ["Custo", "0,0019 SOL / contribuição"],
  ["Latência", "ainda não medida", true],
  ["Quem pontua", "agregador da rodada (MVP)"],
] as const;

const LEGENDA = [
  { cor: "#4af403", texto: "Bloco cheio — contribuição validada" },
  { contorno: "#9fe870", texto: "Contorno — aguardando validação" },
  { cor: "#e0474e", texto: "Vermelho cortado — participante banido" },
];

export default function Home() {
  return (
    <Coluna>
      <Nav />

      <main>
        {/* ===== HERO =====
            A torre é elemento de FUNDO: fica atrás, à direita, e flutua. Em
            tela estreita ela recua e vira marca d'água atrás do texto. */}
        <section className="relative min-h-[520px] overflow-hidden lg:min-h-[680px]">
          <div
            aria-hidden
            className="pointer-events-none absolute right-[-92px] top-[270px] z-0 hidden h-[635px] w-[740px] opacity-20 lg:block lg:opacity-100"
          >
            <div
              className="brilho absolute bottom-[-34px] left-[-60%] right-[-60%] h-24"
              style={{
                background:
                  "radial-gradient(ellipse at 50% 50%, rgba(74,244,3,.32), transparent 68%)",
              }}
            />
            <div
              className="sombra absolute bottom-[-10px] left-[6%] right-[6%] h-[22px] rounded-[50%]"
              style={{
                background:
                  "radial-gradient(ellipse at 50% 50%, rgba(15,26,11,.22), transparent 70%)",
              }}
            />
          </div>

          <Image
            src="/torre.webp"
            alt=""
            aria-hidden
            width={525}
            height={1102}
            priority
            className="torre pointer-events-none absolute left-[624px] top-1 hidden w-[525px] lg:block"
            style={{ objectFit: "cover", objectPosition: "0% 100%" }}
          />

          <div className="relative z-10 max-w-[620px] px-5 pb-16 pt-16 sm:px-12 sm:pt-20">
            <span className="rotulo">
              [ Reputação on-chain para Federated Learning ]
            </span>
            <h1 className="titulo mt-7 text-[clamp(44px,8vw,76px)]">
              Prove quem <span className="marca">envenenou</span> o modelo.
            </h1>
            <p className="corpo mt-7 max-w-[460px]">
              Uma camada de reputação on-chain sobre a federação que você já
              tem. Ela não treina e não substitui o seu agregador — mede a
              confiança de cada contribuição e grava o resultado onde ninguém
              reescreve.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href="/painel" className="btn-lima h-[46px] px-5">
                Entrar como participante
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </Link>
              <Link href="/como-funciona" className="btn-fio h-[46px] px-5">
                Como funciona
              </Link>
            </div>
            <div
              className="mono mt-16 flex flex-wrap gap-7 text-[12.5px]"
              style={{ color: "var(--tinta-muda)" }}
            >
              <span className="inline-flex items-center gap-2">
                <span
                  className="pisca h-[7px] w-[7px]"
                  style={{ background: "var(--acento)" }}
                />
                Programa Anchor na Devnet
              </span>
              <span>0,0019 SOL / contribuição</span>
            </div>
            <p
              className="mt-5 max-w-[460px] text-xs leading-relaxed"
              style={{ color: "var(--tinta-muda)" }}
            >
              A área do participante pede uma carteira Solana em Devnet (Phantom
              ou Solflare). A demo não pede nada.
            </p>
          </div>
        </section>

        {/* ===== CONSTRUÍDO COM ===== */}
        <section className="secao">
          <span className="cruz cruz-e" aria-hidden />
          <span className="cruz cruz-d" aria-hidden />
          {/* 120px é o mínimo que ainda cabe os sete blocos (rótulo + seis
              ferramentas) numa linha só na coluna de 1200. Com 140 o PyTorch
              caía sozinho numa segunda linha abaixo de 1000px de viewport. */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))]">
            <div className="celula rotulo flex items-center px-6 py-6">
              Construído com
            </div>
            {FERRAMENTAS.map((f) => (
              <div
                key={f}
                className="celula px-6 py-6 text-lg font-semibold tracking-[-0.02em]"
              >
                {f}
              </div>
            ))}
          </div>
        </section>

        {/* ===== [01] O PROBLEMA ===== */}
        <section className="secao" id="problema">
          <span className="cruz cruz-e" aria-hidden />
          <span className="cruz cruz-d" aria-hidden />
          <div className="px-5 pb-10 pt-16 sm:px-12 sm:pt-20">
            <span className="rotulo">[01] O problema</span>
            <h2 className="titulo mt-5 max-w-[760px] text-[clamp(32px,5vw,52px)]">
              O atacante mais perigoso é o mais paciente.
            </h2>
          </div>
          <div
            className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] border-t"
            style={{ borderColor: "var(--borda)" }}
          >
            <div
              className="celula px-8 pb-10 pt-9"
              style={{ background: "var(--tinta)", color: "var(--plano)" }}
            >
              <span className="rotulo-claro">Rodadas</span>
              <div
                className="titulo mt-16 text-7xl"
                style={{ color: "var(--acento)" }}
              >
                8
              </div>
              <p
                className="mt-4 text-[15px] leading-relaxed"
                style={{ color: "rgba(244,244,238,.8)" }}
              >
                de comportamento impecável é o que um atacante paciente investe
                antes de envenenar.
              </p>
            </div>
            <div className="celula px-8 pb-10 pt-9">
              <span className="rotulo">Reputação</span>
              <div className="titulo tabular mt-16 whitespace-nowrap text-7xl">
                935<span style={{ color: "var(--critico)" }}>→30</span>
              </div>
              <p
                className="mt-4 text-[15px] leading-relaxed"
                style={{ color: "var(--tinta-2)" }}
              >
                a reputação que ele levou oito rodadas para construir, destruída
                numa transação.
              </p>
            </div>
            <div className="celula px-8 pb-10 pt-9">
              <span className="rotulo">Dados</span>
              <div className="titulo mt-16 text-7xl">0</div>
              <p
                className="mt-4 text-[15px] leading-relaxed"
                style={{ color: "var(--tinta-2)" }}
              >
                de treinamento saem da instituição: só hashes e scores vão para
                a chain.
              </p>
            </div>
          </div>
        </section>

        {/* ===== [02] COMO FUNCIONA ===== */}
        <section className="secao" id="funcionamento">
          <span className="cruz cruz-e" aria-hidden />
          <span className="cruz cruz-d" aria-hidden />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))]">
            <div
              className="border-r px-5 pb-12 pt-16 sm:px-12 sm:pt-20"
              style={{ borderColor: "var(--borda)" }}
            >
              <span className="rotulo">[02] Como funciona</span>
              <h2 className="titulo mt-5 text-[clamp(32px,5vw,52px)]">
                Uma camada sobre a federação que você já tem.
              </h2>
              <p className="corpo mt-6 max-w-[440px]">
                Cada instituição continua treinando em casa. O AwakeFL só
                registra quem contribuiu, com que confiança, e o que aconteceu
                depois.
              </p>
            </div>
            <div className="hachura flex items-center justify-center p-8">
              <div
                className="w-full max-w-[520px] rounded-lg border p-3"
                style={{
                  background: "var(--superficie)",
                  borderColor: "var(--borda)",
                }}
              >
                <Federacao />
              </div>
            </div>
          </div>

          <div
            className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] border-t"
            style={{ borderColor: "var(--borda)" }}
          >
            {PASSOS.map((p) => (
              <div
                key={p.n}
                className="celula px-8 pb-10 pt-8"
                style={
                  p.destaque
                    ? { background: "var(--acento-lavado)" }
                    : undefined
                }
              >
                <span
                  className="mono text-[13px]"
                  style={{ color: "var(--tinta-muda)" }}
                >
                  {p.n}
                </span>
                <h3 className="mt-10 text-xl font-semibold tracking-[-0.02em]">
                  {p.titulo}
                </h3>
                <p
                  className="mt-2.5 text-[15px] leading-relaxed"
                  style={{ color: "var(--tinta-2)" }}
                >
                  {p.texto}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ===== [03] POR QUE ON-CHAIN ===== */}
        <section className="secao p-5 sm:p-12">
          <span className="cruz cruz-e" aria-hidden />
          <span className="cruz cruz-d" aria-hidden />
          <div
            className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] items-center gap-6 rounded-xl px-6 py-12 sm:px-12 sm:py-14"
            style={{ background: "var(--tinta)", color: "var(--plano)" }}
          >
            <div>
              <span className="rotulo-claro">[03] Por que on-chain</span>
              <h2
                className="titulo mt-5 text-[clamp(30px,4.5vw,48px)]"
                style={{ color: "var(--plano)" }}
              >
                Depois do dano, o histórico não pode ser reescrito.
              </h2>
              <p
                className="mt-6 max-w-[460px] text-base leading-relaxed"
                style={{ color: "rgba(244,244,238,.8)" }}
              >
                Ele contribui honestamente por muitas rodadas, acumula reputação
                e peso na agregação, e só então começa a envenenar. Sem registro
                imutável, quem controla o servidor pode apagar o rastro.
              </p>

              <div
                className="mono mt-8 flex flex-col gap-2.5 text-[13px]"
                style={{ color: "rgba(244,244,238,.75)" }}
              >
                {LEGENDA.map((l) => (
                  <span key={l.texto} className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 shrink-0 box-border"
                      style={
                        l.contorno
                          ? { border: `1.5px solid ${l.contorno}` }
                          : { background: l.cor }
                      }
                    />
                    {l.texto}
                  </span>
                ))}
              </div>

              <div className="mt-8">
                <Link href="/como-funciona" className="btn-lima h-[46px] px-5">
                  Ver como o AwakeFL barra isso
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </Link>
              </div>
            </div>
            <div className="flex justify-center">
              <div className="w-full max-w-[500px]">
                <Orbita />
              </div>
            </div>
          </div>
        </section>

        {/* ===== [04] ESTADO DA DEVNET ===== */}
        <section className="secao">
          <span className="cruz cruz-e" aria-hidden />
          <span className="cruz cruz-d" aria-hidden />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))]">
            <div
              className="border-r px-5 py-16 sm:px-12 sm:py-[72px]"
              style={{ borderColor: "var(--borda)" }}
            >
              <span className="rotulo">[04] Estado da Devnet</span>
              <h2 className="titulo mt-5 text-[clamp(28px,4vw,44px)]">
                O que já roda — e o que ainda não foi medido.
              </h2>
              <p className="corpo mt-6 max-w-[420px]">
                O AwakeFL é um MVP acadêmico, não um produto em produção. Esta
                ficha diz só o que está comprovado.
              </p>
            </div>
            <dl className="mono m-0 text-sm">
              {FICHA.map(([termo, valor, lacuna], i) => (
                <div
                  key={termo}
                  className="flex justify-between gap-6 px-5 py-[22px] sm:px-12"
                  style={
                    i < FICHA.length - 1
                      ? { borderBottom: "1px solid var(--borda)" }
                      : undefined
                  }
                >
                  <dt style={{ color: "var(--tinta-muda)" }}>{termo}</dt>
                  <dd
                    className="m-0 text-right"
                    style={{
                      color: lacuna ? "var(--tinta-muda)" : "var(--tinta)",
                    }}
                  >
                    {valor}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ===== FECHO ===== */}
        <section className="secao hachura p-5 sm:p-12">
          <span className="cruz cruz-e" aria-hidden />
          <span className="cruz cruz-d" aria-hidden />
          <div
            className="rounded-xl border px-6 py-16 text-center sm:px-8 sm:py-[72px]"
            style={{
              background: "var(--plano)",
              borderColor: "var(--borda)",
            }}
          >
            <span className="rotulo">[ Comece agora ]</span>
            <h2 className="titulo mx-auto mt-5 max-w-[760px] text-[clamp(36px,6vw,64px)]">
              A camada de reputação da sua federação.
            </h2>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link href="/painel" className="btn-lima h-[46px] px-5">
                Entrar como participante
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </Link>
              <Link href="/simulacao" className="btn-fio h-[46px] px-5">
                Ver a demo
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </Coluna>
  );
}
