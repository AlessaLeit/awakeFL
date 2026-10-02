import type { Metadata } from "next";
import Link from "next/link";
import Coluna from "@/components/Coluna";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Como funciona — AwakeFL",
  description:
    "As quatro instruções do programa Anchor, a regra que move a reputação, por que a camada é on-chain em vez de um banco de dados, e o que o MVP ainda não mede.",
};

/* Esta página recebeu o que saiu da landing no redesenho. Os textos são os
   mesmos de antes, de propósito: o redesenho é visual, e nenhum deles foi
   reescrito ao mudar de lugar. */

const CARTOES_PROBLEMA = [
  {
    t: "Ninguém consegue provar quem foi",
    d: "Sem registro imutável, a contribuição de cada rodada é uma alegação. Depois do dano, o histórico já pode ter sido reescrito por quem controla o servidor.",
  },
  {
    t: "A reputação vira uma arma",
    d: "Sistemas que dão mais peso a quem tem histórico bom entregam ao atacante paciente exatamente a alavanca de que ele precisa.",
  },
  {
    t: "A média móvel reage devagar",
    d: "É o que a torna estável contra ruído — e o que abre a janela de dano. Por isso a punição precisa ser abrupta, não gradual.",
  },
];

const PASSOS = [
  {
    n: "01",
    titulo: "Registrar",
    texto:
      "Cada instituição cria sua conta de participante on-chain e entra com reputação 500, o ponto neutro da escala.",
    instrucao: "register_participant",
  },
  {
    n: "02",
    titulo: "Contribuir",
    texto:
      "A cada rodada, o nó publica o hash da atualização de pesos e suas métricas. Os dados nunca saem da instituição — só o compromisso criptográfico.",
    instrucao: "submit_contribution",
  },
  {
    n: "03",
    titulo: "Validar",
    texto:
      "O agregador pontua a contribuição de 0 a 1000. A reputação move por média móvel exponencial: metade do histórico, metade da rodada atual.",
    instrucao: "validate_contribution",
  },
  {
    n: "04",
    titulo: "Penalizar",
    texto:
      "Detectado envenenamento, a reputação é dividida por 10 e o banimento é permanente. Sem instrução de reversão, nem para a autoridade.",
    instrucao: "penalize_participant",
  },
];

const COMPARATIVO = [
  [
    "Histórico à prova de reescrita",
    "Depende de quem administra",
    "Imutável por construção",
  ],
  [
    "Auditoria por qualquer participante",
    "Só o que o dono expõe",
    "Aberta, sem pedir acesso",
  ],
  [
    "Regra de punição não negociável",
    "Alterável a qualquer momento",
    "Fixada no programa publicado",
  ],
  [
    "Custo de operação",
    "Baixo",
    "0,0019 SOL por contribuição, medido na Devnet",
  ],
  ["Latência", "Milissegundos", "Ainda não medida"],
];

const FAQ = [
  {
    p: "Os dados de treinamento vão para a blockchain?",
    r: "Não. Só o hash da atualização de pesos, as métricas declaradas e o score. O dado clínico ou financeiro nunca sai da instituição — é essa a premissa do Federated Learning, e o sistema a preserva.",
  },
  {
    p: "Por que blockchain em vez de um banco de dados?",
    r: "Porque num consórcio não existe autoridade central em quem todos confiem. Um banco de dados pertence a alguém, e esse alguém pode reescrever o histórico de reputação. Na chain, o registro é imutável e qualquer participante audita sem pedir permissão.",
  },
  {
    p: "Quem decide o score de cada contribuição?",
    r: "No MVP, o agregador da rodada. É a limitação honesta desta versão: ele é confiável por construção. Descentralizar essa decisão — votação por comitê ou Krum on-chain — é o próximo passo do roteiro.",
  },
  {
    p: "O banimento pode ser revertido?",
    r: "Não. O programa não expõe nenhuma instrução que remova a marca de banido, nem para a autoridade. É uma decisão de projeto: um banimento reversível é um banimento negociável.",
  },
  {
    p: "Em que estágio o projeto está?",
    r: "MVP. O programa Anchor está escrito e versionado, com testes de integração cobrindo o ciclo completo. A demo deste site é uma simulação determinística das mesmas regras.",
  },
];

export default function ComoFunciona() {
  return (
    <Coluna>
      <Nav />

      <main>
        {/* ===== CABEÇALHO ===== */}
        <section className="px-5 pb-12 pt-16 sm:px-12 sm:pt-20">
          <span className="rotulo">[ Como funciona ]</span>
          <h1 className="titulo mt-7 max-w-[860px] text-[clamp(40px,7vw,68px)]">
            Quatro instruções, um ciclo fechado.
          </h1>
          <p className="corpo mt-7 max-w-[560px]">
            Todo o mecanismo cabe em quatro chamadas ao programa Anchor. Cada
            uma deixa um registro que ninguém — nem a autoridade — consegue
            apagar.
          </p>
        </section>

        {/* ===== AS QUATRO INSTRUÇÕES ===== */}
        <section className="secao">
          <span className="cruz cruz-e" aria-hidden />
          <span className="cruz cruz-d" aria-hidden />
          <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(300px,1fr))] p-0">
            {PASSOS.map((p) => (
              <li key={p.n} className="celula px-8 pb-10 pt-8">
                <span
                  className="mono text-[13px]"
                  style={{ color: "var(--tinta-muda)" }}
                >
                  {p.n}
                </span>
                <h2 className="mt-10 text-xl font-semibold tracking-[-0.02em]">
                  {p.titulo}
                </h2>
                <p
                  className="mt-2.5 text-[15px] leading-relaxed"
                  style={{ color: "var(--tinta-2)" }}
                >
                  {p.texto}
                </p>
                <code
                  className="mono mt-5 inline-block rounded border px-2 py-1 text-xs"
                  style={{
                    borderColor: "var(--borda)",
                    background: "var(--superficie-baixa)",
                    color: "var(--tinta)",
                  }}
                >
                  {p.instrucao}()
                </code>
              </li>
            ))}
          </ol>
        </section>

        {/* ===== A REGRA ===== */}
        <section className="secao hachura p-5 sm:p-12">
          <span className="cruz cruz-e" aria-hidden />
          <span className="cruz cruz-d" aria-hidden />
          <div
            className="flex flex-wrap items-center gap-x-12 gap-y-6 rounded-xl border px-6 py-10 sm:px-10"
            style={{
              background: "var(--plano)",
              borderColor: "var(--borda)",
            }}
          >
            <div className="min-w-[280px] flex-1">
              <span className="rotulo">A regra que define tudo</span>
              <p
                className="mt-4 text-base leading-relaxed"
                style={{ color: "var(--tinta-2)" }}
              >
                A reputação sobe devagar e cai de uma vez. A média móvel
                exponencial pondera metade do histórico e metade da rodada
                atual, então nenhuma rodada isolada — boa ou ruim — domina o
                resultado. Já a penalidade não negocia: divide por dez e bane em
                definitivo.
              </p>
            </div>
            <div className="mono tabular shrink-0 text-lg font-medium">
              R(t) = 0,5 · R(t−1) + 0,5 · S(t)
            </div>
          </div>
        </section>

        {/* ===== O ATACANTE PACIENTE ===== */}
        <section className="secao">
          <span className="cruz cruz-e" aria-hidden />
          <span className="cruz cruz-d" aria-hidden />
          <div className="px-5 pb-10 pt-16 sm:px-12 sm:pt-20">
            <span className="rotulo">O problema, em detalhe</span>
            <h2 className="titulo mt-5 max-w-[760px] text-[clamp(30px,4.5vw,48px)]">
              O atacante mais perigoso é o mais paciente.
            </h2>
            <p className="corpo mt-6 max-w-[640px]">
              Um envenenador óbvio é fácil de barrar. O problema real é o{" "}
              <strong style={{ color: "var(--tinta)" }}>
                sleepy adversary
              </strong>
              : ele contribui honestamente por muitas rodadas, acumula reputação
              e peso na agregação, e só então começa a envenenar — sutilmente o
              bastante para que a detecção demore.
            </p>
          </div>
          <div
            className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] border-t"
            style={{ borderColor: "var(--borda)" }}
          >
            {CARTOES_PROBLEMA.map((c) => (
              <div key={c.t} className="celula px-8 pb-10 pt-8">
                <h3 className="text-lg font-semibold tracking-[-0.02em]">
                  {c.t}
                </h3>
                <p
                  className="mt-3 text-[15px] leading-relaxed"
                  style={{ color: "var(--tinta-2)" }}
                >
                  {c.d}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ===== POR QUE NÃO UM BANCO DE DADOS ===== */}
        <section className="secao px-5 py-16 sm:px-12 sm:py-20">
          <span className="cruz cruz-e" aria-hidden />
          <span className="cruz cruz-d" aria-hidden />
          <span className="rotulo">A pergunta inevitável</span>
          <h2 className="titulo mt-5 max-w-[760px] text-[clamp(30px,4.5vw,48px)]">
            Por que não um banco de dados.
          </h2>
          <p className="corpo mt-6 max-w-[640px]">
            Esta é a pergunta que todo projeto com blockchain precisa responder
            sem rodeios. A resposta aqui é específica: um consórcio de
            instituições concorrentes não tem um terceiro em quem todas confiem.
          </p>

          <div className="mt-10 overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse text-[15px]">
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="rotulo border-b py-3 pr-4 text-left"
                    style={{ borderColor: "var(--borda)" }}
                  >
                    Requisito
                  </th>
                  <th
                    scope="col"
                    className="rotulo border-b px-4 py-3 text-left"
                    style={{ borderColor: "var(--borda)" }}
                  >
                    Servidor central
                  </th>
                  <th
                    scope="col"
                    className="rotulo border-b px-4 py-3 text-left"
                    style={{
                      borderColor: "var(--tinta)",
                      borderBottomWidth: "2px",
                      color: "var(--tinta)",
                    }}
                  >
                    AwakeFL
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARATIVO.map(([req, central, chain]) => (
                  <tr key={req}>
                    <th
                      scope="row"
                      className="border-b py-4 pr-4 text-left font-medium"
                      style={{
                        borderColor: "var(--borda)",
                        color: "var(--tinta)",
                      }}
                    >
                      {req}
                    </th>
                    <td
                      className="border-b px-4 py-4"
                      style={{
                        borderColor: "var(--borda)",
                        color: "var(--tinta-muda)",
                      }}
                    >
                      {central}
                    </td>
                    <td
                      className="border-b px-4 py-4"
                      style={{
                        borderColor: "var(--borda)",
                        color: "var(--tinta)",
                      }}
                    >
                      {chain}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p
            className="mt-5 text-sm leading-relaxed"
            style={{ color: "var(--tinta-muda)" }}
          >
            Um servidor central ganha em latência e custo. Perde no único ponto
            que importa aqui: quem controla o histórico.
          </p>
        </section>

        {/* ===== FAQ ===== */}
        <section className="secao px-5 py-16 sm:px-12 sm:py-20">
          <span className="cruz cruz-e" aria-hidden />
          <span className="cruz cruz-d" aria-hidden />
          <span className="rotulo">Perguntas frequentes</span>
          <h2 className="titulo mt-5 text-[clamp(30px,4.5vw,48px)]">
            O que costumam perguntar.
          </h2>

          <div className="mt-10 max-w-[760px]">
            {FAQ.map((f, i) => (
              <details
                key={f.p}
                className="group py-5"
                open={i === 0}
                style={{
                  borderTop: "1px solid var(--borda)",
                  borderBottom:
                    i === FAQ.length - 1 ? "1px solid var(--borda)" : undefined,
                }}
              >
                <summary className="cursor-pointer list-none text-lg font-medium marker:content-none">
                  <span className="flex items-start gap-4">
                    <span
                      aria-hidden
                      className="mt-0.5 shrink-0 transition-transform group-open:rotate-45"
                      style={{ color: "var(--tinta-muda)" }}
                    >
                      +
                    </span>
                    {f.p}
                  </span>
                </summary>
                <p
                  className="mt-3.5 pl-8 text-[15px] leading-relaxed"
                  style={{ color: "var(--tinta-2)" }}
                >
                  {f.r}
                </p>
              </details>
            ))}
          </div>
        </section>

        {/* ===== FECHO ===== */}
        <section className="secao hachura p-5 sm:p-12">
          <span className="cruz cruz-e" aria-hidden />
          <span className="cruz cruz-d" aria-hidden />
          <div
            className="rounded-xl border px-6 py-16 text-center sm:px-8"
            style={{
              background: "var(--plano)",
              borderColor: "var(--borda)",
            }}
          >
            <h2 className="titulo mx-auto max-w-[680px] text-[clamp(32px,5vw,52px)]">
              Veja o ciclo rodando.
            </h2>
            <p
              className="corpo mx-auto mt-6 max-w-[520px]"
              style={{ color: "var(--tinta-2)" }}
            >
              A demo roda as doze rodadas com as mesmas regras e mostra o
              momento exato do banimento. O console de Devnet lê as contas reais
              do programa.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link href="/simulacao" className="btn-lima h-[46px] px-5">
                Abrir a demo
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
              <Link href="/devnet" className="btn-fio h-[46px] px-5">
                Estado da Devnet
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </Coluna>
  );
}
