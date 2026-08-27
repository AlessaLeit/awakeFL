import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

const REPO = "https://github.com/AlessaLeit/awakeFL";

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

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-5 pt-16 pb-14 md:pt-24 md:pb-20">
          <div className="max-w-3xl">
            <span className="chip">
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{
                  background: "var(--acento)",
                  boxShadow: "0 0 8px 1px var(--acento-brilho)",
                }}
              />
              Solana · Anchor · MVP em Devnet
            </span>

            <h1 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-tight md:text-6xl">
              Prove quem envenenou
              <br />o modelo.
            </h1>

            <p
              className="mt-5 max-w-2xl text-lg leading-relaxed"
              style={{ color: "var(--tinta-2)" }}
            >
              No Federated Learning, várias instituições treinam uma IA sem
              trocar dados — e um único participante malicioso pode corromper o
              modelo de todos sem deixar rastro. O AwakeFL é uma camada sobre a
              federação que você já tem: não treina, não substitui o seu
              agregador. Ele mede a confiança de cada contribuição, registra o
              resultado de forma imutável na Solana e bane quem ataca.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/painel" className="btn-neon px-6 py-3.5 text-sm">
                Entrar como participante
              </Link>
              <Link
                href="/simulacao"
                className="btn-contorno px-5 py-3.5 text-sm"
              >
                Ver a demo interativa
              </Link>
              <a
                href={REPO}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-fantasma px-5 py-3.5 text-sm"
              >
                Ler o código
              </a>
            </div>

            <p className="mt-4 text-xs" style={{ color: "var(--tinta-muda)" }}>
              A área do participante pede uma carteira Solana em Devnet (Phantom
              ou Solflare). A demo não pede nada.
            </p>
          </div>

          {/* Números da simulação — o gancho do sleepy adversary */}
          <dl className="mt-14 grid gap-3 sm:grid-cols-3">
            {[
              {
                v: "8 rodadas",
                l: "de comportamento impecável é o que um sleepy adversary investe antes de atacar",
              },
              {
                v: "935 → 30",
                l: "a reputação que ele levou oito rodadas para construir, destruída numa transação",
              },
              {
                v: "0 dados",
                l: "de treinamento saem da instituição: só hashes e scores vão para a chain",
              },
            ].map((s) => (
              <div key={s.v} className="vidro p-5">
                <dt className="text-2xl font-semibold tracking-tight">{s.v}</dt>
                <dd
                  className="mt-2 text-sm leading-relaxed"
                  style={{ color: "var(--tinta-2)" }}
                >
                  {s.l}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Problema */}
        <section
          id="problema"
          className="border-y py-16 md:py-24"
          style={{
            borderColor: "var(--borda)",
            background: "var(--superficie)",
          }}
        >
          <div className="mx-auto max-w-6xl px-5">
            <h2 className="max-w-2xl text-3xl font-semibold tracking-tight md:text-4xl">
              O atacante mais perigoso é o mais paciente
            </h2>
            <p
              className="mt-4 max-w-2xl text-base leading-relaxed"
              style={{ color: "var(--tinta-2)" }}
            >
              Um envenenador óbvio é fácil de barrar. O problema real é o{" "}
              <strong style={{ color: "var(--tinta)" }}>
                sleepy adversary
              </strong>
              : ele contribui honestamente por muitas rodadas, acumula reputação
              e peso na agregação, e só então começa a envenenar — sutilmente o
              bastante para que a detecção demore.
            </p>

            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {[
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
              ].map((c) => (
                <div key={c.t} className="vidro p-5">
                  <h3 className="text-base font-semibold">{c.t}</h3>
                  <p
                    className="mt-2 text-sm leading-relaxed"
                    style={{ color: "var(--tinta-2)" }}
                  >
                    {c.d}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Como funciona */}
        <section
          id="funcionamento"
          className="mx-auto max-w-6xl px-5 py-16 md:py-24"
        >
          <h2 className="max-w-2xl text-3xl font-semibold tracking-tight md:text-4xl">
            Quatro instruções, um ciclo fechado
          </h2>
          <p
            className="mt-4 max-w-2xl text-base leading-relaxed"
            style={{ color: "var(--tinta-2)" }}
          >
            Todo o mecanismo cabe em quatro chamadas ao programa Anchor. Cada
            uma deixa um registro que ninguém — nem a autoridade — consegue
            apagar.
          </p>

          <ol className="mt-10 grid gap-4 md:grid-cols-2">
            {PASSOS.map((p) => (
              <li key={p.n} className="vidro p-6">
                <div className="flex items-baseline gap-3">
                  <span
                    className="tabular text-sm font-semibold"
                    style={{ color: "var(--acento)" }}
                  >
                    {p.n}
                  </span>
                  <h3 className="text-lg font-semibold">{p.titulo}</h3>
                </div>
                <p
                  className="mt-2.5 text-sm leading-relaxed"
                  style={{ color: "var(--tinta-2)" }}
                >
                  {p.texto}
                </p>
                <code
                  className="mono mt-4 inline-block rounded border px-2 py-1 text-xs"
                  style={{
                    borderColor: "var(--borda)",
                    background: "var(--superficie-baixa)",
                    color: "var(--acento)",
                  }}
                >
                  {p.instrucao}()
                </code>
              </li>
            ))}
          </ol>

          <div
            className="vidro mt-10 p-6"
            style={{ boxShadow: "inset 3px 0 0 0 var(--acento)" }}
          >
            <h3 className="text-base font-semibold">A regra que define tudo</h3>
            <p
              className="mt-2 text-sm leading-relaxed"
              style={{ color: "var(--tinta-2)" }}
            >
              A reputação sobe devagar e cai de uma vez. A média móvel
              exponencial pondera metade do histórico e metade da rodada atual,
              então nenhuma rodada isolada — boa ou ruim — domina o resultado.
              Já a penalidade não negocia: divide por dez e bane em definitivo.
            </p>
            <p
              className="mono tabular mt-4 rounded border px-3 py-2.5 text-sm"
              style={{
                borderColor: "var(--borda)",
                background: "var(--superficie-baixa)",
                color: "var(--acento)",
              }}
            >
              R(t) = 0,5 · R(t−1) + 0,5 · S(t)
            </p>
          </div>
        </section>

        {/* Por que blockchain */}
        <section
          className="border-y py-16 md:py-24"
          style={{
            borderColor: "var(--borda)",
            background: "var(--superficie)",
          }}
        >
          <div className="mx-auto max-w-6xl px-5">
            <h2 className="max-w-2xl text-3xl font-semibold tracking-tight md:text-4xl">
              Por que não um banco de dados
            </h2>
            <p
              className="mt-4 max-w-2xl text-base leading-relaxed"
              style={{ color: "var(--tinta-2)" }}
            >
              Esta é a pergunta que todo projeto com blockchain precisa
              responder sem rodeios. A resposta aqui é específica: um consórcio
              de instituições concorrentes não tem um terceiro em quem todas
              confiem.
            </p>

            <div className="mt-8 overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead>
                  <tr style={{ color: "var(--tinta-2)" }}>
                    <th
                      scope="col"
                      className="border-b py-3 pr-4 text-left font-medium"
                      style={{ borderColor: "var(--borda)" }}
                    >
                      Requisito
                    </th>
                    <th
                      scope="col"
                      className="border-b px-4 py-3 text-left font-medium"
                      style={{ borderColor: "var(--borda)" }}
                    >
                      Servidor central
                    </th>
                    <th
                      scope="col"
                      className="border-b px-4 py-3 text-left font-medium"
                      style={{ borderColor: "var(--borda)" }}
                    >
                      AwakeFL
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[
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
                  ].map(([req, central, chain]) => (
                    <tr key={req}>
                      <th
                        scope="row"
                        className="border-b py-3 pr-4 text-left font-normal"
                        style={{
                          borderColor: "var(--borda)",
                          color: "var(--tinta)",
                        }}
                      >
                        {req}
                      </th>
                      <td
                        className="border-b px-4 py-3"
                        style={{
                          borderColor: "var(--borda)",
                          color: "var(--tinta-2)",
                        }}
                      >
                        {central}
                      </td>
                      <td
                        className="border-b px-4 py-3"
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
            <p className="mt-4 text-sm" style={{ color: "var(--tinta-muda)" }}>
              Um servidor central ganha em latência e custo. Perde no único
              ponto que importa aqui: quem controla o histórico.
            </p>
          </div>
        </section>

        {/* FAQ */}
        <section
          className="border-t py-16 md:py-24"
          style={{
            borderColor: "var(--borda)",
            background: "var(--superficie)",
          }}
        >
          <div className="mx-auto max-w-3xl px-5">
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
              Perguntas frequentes
            </h2>
            <div
              className="mt-8 divide-y"
              style={{ borderColor: "var(--borda)" }}
            >
              {FAQ.map((f) => (
                <details key={f.p} className="group py-4">
                  <summary
                    className="cursor-pointer list-none text-base font-medium marker:content-none"
                    style={{ color: "var(--tinta)" }}
                  >
                    <span className="flex items-start gap-3">
                      <span
                        aria-hidden
                        className="mt-0.5 transition-transform group-open:rotate-45"
                        style={{ color: "var(--acento)" }}
                      >
                        +
                      </span>
                      {f.p}
                    </span>
                  </summary>
                  <p
                    className="mt-3 pl-6 text-sm leading-relaxed"
                    style={{ color: "var(--tinta-2)" }}
                  >
                    {f.r}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA final */}
        <section className="mx-auto max-w-6xl px-5 py-16 md:py-24">
          <div
            className="vidro p-8 md:p-12"
            style={{
              // O acento aqui é luz de fundo, não preenchimento: um halo atrás
              // do vidro, para o cartão final puxar o olho sem virar um bloco
              // verde chapado.
              backgroundImage:
                "radial-gradient(circle at 15% 0%, var(--acento-lavado), transparent 60%)",
            }}
          >
            <h2 className="max-w-2xl text-3xl font-semibold tracking-tight md:text-4xl">
              Entre na rede — ou veja um sleepy adversary perder tudo
            </h2>
            <p
              className="mt-4 max-w-xl text-base leading-relaxed"
              style={{ color: "var(--tinta-2)" }}
            >
              A área do participante conecta sua carteira ao programa na Devnet:
              registre seu nó, submeta contribuições e acompanhe a reputação
              real. A demo, sem carteira, roda as doze rodadas com as mesmas
              regras e mostra o momento exato do banimento.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/painel" className="btn-neon px-6 py-3.5 text-sm">
                Entrar como participante
              </Link>
              <Link
                href="/simulacao"
                className="btn-contorno px-5 py-3.5 text-sm"
              >
                Abrir a demo
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
