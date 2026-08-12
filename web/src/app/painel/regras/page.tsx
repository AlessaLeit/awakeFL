"use client";

import Cabecalho from "@/components/painel/Cabecalho";
import { useAwakeFL } from "@/lib/anchor/estado";

/**
 * As regras aqui são as do programa Anchor publicado, não um texto de marketing.
 * Cada uma aponta para a instrução ou a constante que a implementa, para que a
 * tela seja auditável contra `programs/awakefl/src/`.
 */
const DIRETRIZES = [
  {
    titulo: "Entrada no ponto neutro",
    texto:
      "Todo participante é criado com reputação 500 na escala 0–1000. Ninguém entra com vantagem nem com dívida, e a conta é um PDA derivado da própria carteira.",
    fonte: "register_participant · INITIAL_REPUTATION = 500",
  },
  {
    titulo: "Uma contribuição por rodada",
    texto:
      "O endereço da contribuição é derivado do par (participante, rodada). Uma segunda submissão na mesma rodada não é rejeitada por regra de negócio: ela é impossível, porque a conta já existe.",
    fonte: 'submit_contribution · seeds ["contribution", participante, rodada]',
  },
  {
    titulo: "O dado nunca sai da instituição",
    texto:
      "O que vai para a chain é o SHA-256 da atualização de pesos, com no máximo 64 caracteres, mais as métricas declaradas. O tensor permanece off-chain, em poder de quem treinou.",
    fonte: "MAX_HASH_LEN = 64",
  },
  {
    titulo: "Quem pontua é a autoridade da rodada",
    texto:
      "O agregador atribui um score de 0 a 1000 a cada contribuição. É a limitação honesta do MVP: ele é confiável por construção. Descentralizar essa decisão é o próximo passo.",
    fonte: "validate_contribution(score) · has_one = authority",
  },
];

const PENALIDADES = [
  {
    infracao: "Envenenamento do modelo",
    severidade: "Crítica",
    cor: "var(--critico)",
    efeito: "Reputação ÷ 10 e banimento permanente",
    fonte: "penalize_participant · PENALTY_DIVISOR = 10",
  },
  {
    infracao: "Contribuição abaixo do limiar",
    severidade: "Média",
    cor: "var(--aviso)",
    efeito: "Marcada como Rejeitado; a média móvel puxa a reputação para baixo",
    fonte: "score < 500",
  },
  {
    infracao: "Submissão depois de banido",
    severidade: "Bloqueio",
    cor: "var(--tinta-muda)",
    efeito: "A transação falha on-chain e nada é gravado",
    fonte: "constraint ParticipantBanned",
  },
];

export default function Regras() {
  const { config, meuParticipante } = useAwakeFL();
  const reputacao = meuParticipante?.reputation ?? null;

  return (
    <>
      <Cabecalho
        titulo="Protocolo & Regras"
        subtitulo="Diretrizes de consenso, mecanismo de confiança e penalidades aplicadas na rede federada AwakeFL."
        acao={
          <span
            className="chip"
            style={{
              borderColor: config ? "var(--acento)" : "var(--borda)",
              color: config ? "var(--acento)" : "var(--tinta-muda)",
              padding: "0.5rem 0.875rem",
            }}
          >
            ● {config ? "REDE ATIVA" : "REDE NÃO INICIALIZADA"}
          </span>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Diretrizes */}
        <section className="vidro p-6 lg:col-span-2">
          <h2 className="text-2xl font-semibold tracking-tight">
            Diretrizes do protocolo
          </h2>
          <ul className="mt-6 flex flex-col gap-5">
            {DIRETRIZES.map((d) => (
              <li
                key={d.titulo}
                className="pl-4"
                style={{ boxShadow: "inset 2px 0 0 0 var(--acento)" }}
              >
                <h3 className="font-semibold">{d.titulo}</h3>
                <p
                  className="mt-1.5 text-sm leading-relaxed"
                  style={{ color: "var(--tinta-2)" }}
                >
                  {d.texto}
                </p>
                <code
                  className="mono mt-2 block text-[11px]"
                  style={{ color: "var(--tinta-muda)" }}
                >
                  {d.fonte}
                </code>
              </li>
            ))}
          </ul>
        </section>

        {/* Mostrador de reputação */}
        <section className="vidro flex flex-col items-center p-6 text-center">
          <div className="rotulo">Escala de reputação</div>
          <Mostrador valor={reputacao} />
          <p
            className="mt-5 text-sm leading-relaxed"
            style={{ color: "var(--tinta-2)" }}
          >
            {reputacao === null
              ? "Registre seu nó para acompanhar a reputação. A escala vai de 0 a 1000, com entrada em 500."
              : reputacao >= 500
                ? "Acima do ponto neutro: suas contribuições vêm sendo pontuadas acima do limiar de aprovação."
                : "Abaixo do ponto neutro: a média móvel está sendo puxada por scores menores que 500."}
          </p>
        </section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Mecanismo de confiança */}
        <section className="vidro p-6">
          <h2 className="text-lg font-semibold">Mecanismo de confiança</h2>
          <p
            className="mt-3 text-sm leading-relaxed"
            style={{ color: "var(--tinta-2)" }}
          >
            A reputação é uma média móvel exponencial com fator 0,5: metade do
            que você era, metade do que acabou de entregar. Nenhuma rodada
            isolada — boa ou ruim — domina o resultado.
          </p>

          <p
            className="mono tabular mt-5 rounded border px-4 py-3 text-center text-sm"
            style={{
              borderColor: "var(--borda)",
              background: "var(--superficie-baixa)",
              color: "var(--acento)",
            }}
          >
            R(t) = 0,5 · R(t−1) + 0,5 · S(t)
          </p>

          <ul className="mt-5 flex flex-col gap-3">
            {[
              ["Histórico acumulado", "50%"],
              ["Rodada atual", "50%"],
              ["Perda por truncamento", "≤ 1 ponto"],
            ].map(([rotulo, peso]) => (
              <li
                key={rotulo}
                className="mono flex items-baseline justify-between gap-4 border-b pb-2 text-xs last:border-b-0"
                style={{ borderColor: "var(--borda)", color: "var(--tinta-2)" }}
              >
                <span>{rotulo}</span>
                <span className="tabular" style={{ color: "var(--acento)" }}>
                  {peso}
                </span>
              </li>
            ))}
          </ul>

          <p
            className="mt-4 text-xs leading-relaxed"
            style={{ color: "var(--tinta-muda)" }}
          >
            A conta é feita em aritmética inteira, então a divisão trunca e
            perde no máximo um ponto por rodada. É a mesma operação de{" "}
            <code className="mono">apply_ema</code> no programa.
          </p>
        </section>

        {/* Penalidades */}
        <section className="vidro overflow-hidden">
          <div
            className="flex items-center gap-2.5 border-b p-6 pb-4"
            style={{ borderColor: "var(--borda)" }}
          >
            <span aria-hidden style={{ color: "var(--critico)" }}>
              ⚠
            </span>
            <h2 className="text-lg font-semibold">Penalidades</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead>
                <tr className="rotulo">
                  <th scope="col" className="px-6 py-3 text-left">
                    Infração
                  </th>
                  <th scope="col" className="px-3 py-3 text-left">
                    Severidade
                  </th>
                  <th scope="col" className="px-6 py-3 text-left">
                    Efeito
                  </th>
                </tr>
              </thead>
              <tbody>
                {PENALIDADES.map((p) => (
                  <tr
                    key={p.infracao}
                    className="border-t"
                    style={{ borderColor: "var(--borda)" }}
                  >
                    <th scope="row" className="px-6 py-4 text-left font-normal">
                      <span style={{ color: "var(--tinta)" }}>
                        {p.infracao}
                      </span>
                      <code
                        className="mono mt-1 block text-[11px]"
                        style={{ color: "var(--tinta-muda)" }}
                      >
                        {p.fonte}
                      </code>
                    </th>
                    <td className="px-3 py-4 align-top">
                      <span
                        className="chip"
                        style={{
                          borderColor: `color-mix(in srgb, ${p.cor} 45%, transparent)`,
                          color: p.cor,
                        }}
                      >
                        {p.severidade}
                      </span>
                    </td>
                    <td
                      className="px-6 py-4 align-top"
                      style={{ color: "var(--tinta-2)" }}
                    >
                      {p.efeito}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p
            className="border-t p-6 text-xs leading-relaxed"
            style={{ borderColor: "var(--borda)", color: "var(--tinta-muda)" }}
          >
            O banimento é definitivo: o programa não expõe nenhuma instrução que
            remova a marca, nem para a autoridade. É decisão de projeto — um
            banimento reversível é um banimento negociável.
          </p>
        </section>
      </div>
    </>
  );
}

/** Anel de progresso da reputação. O arco só existe quando há um valor real. */
function Mostrador({ valor }: { valor: number | null }) {
  const R = 62;
  const C = 2 * Math.PI * R;
  const fracao = valor === null ? 0 : Math.max(0, Math.min(1, valor / 1000));

  return (
    <div className="relative mt-5 h-[160px] w-[160px]">
      <svg
        viewBox="0 0 160 160"
        className="h-full w-full -rotate-90"
        aria-hidden
      >
        <circle
          cx="80"
          cy="80"
          r={R}
          fill="none"
          stroke="var(--superficie-3)"
          strokeWidth="8"
        />
        {valor !== null && (
          <circle
            cx="80"
            cy="80"
            r={R}
            fill="none"
            stroke="var(--acento)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${C * fracao} ${C}`}
            style={{ filter: "drop-shadow(0 0 6px var(--acento-brilho))" }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="tabular text-4xl font-bold"
          style={{ color: "var(--tinta)" }}
        >
          {valor ?? "—"}
        </span>
        <span className="rotulo mt-1" style={{ fontSize: 10 }}>
          Score atual
        </span>
      </div>
    </div>
  );
}
