"use client";

import { useMemo, useRef, useState } from "react";
import { INSTITUICOES, RODADA_DA_PENALIDADE, serieDe } from "@/lib/simulation";

const W = 760;
const H = 320;
const PAD = { top: 18, right: 104, bottom: 38, left: 46 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

const MAX_REP = 1000;
const TICKS = [0, 250, 500, 750, 1000];

const DESTAQUE = "delta"; // o sleepy adversary é a história do gráfico

export default function ReputationChart({ rodada }: { rodada: number }) {
  const [foco, setFoco] = useState<number | null>(null);
  const [verTabela, setVerTabela] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  // Ponto 0 é o estado inicial (500), antes da primeira rodada.
  const rotulos = useMemo(
    () => ["Início", ...Array.from({ length: rodada + 1 }, (_, i) => `R${i}`)],
    [rodada],
  );

  const series = useMemo(
    () =>
      INSTITUICOES.map((inst) => ({
        inst,
        valores: serieDe(inst.id, rodada),
        destaque: inst.id === DESTAQUE,
      })),
    [rodada],
  );

  const n = rotulos.length;
  const x = (i: number) => PAD.left + (n === 1 ? 0 : (i / (n - 1)) * PLOT_W);
  const y = (v: number) => PAD.top + (1 - v / MAX_REP) * PLOT_H;

  const caminho = (valores: number[]) =>
    valores.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ");

  const aoMover = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    // O SVG usa width:100%/height:auto, então a caixa renderizada tem
    // exatamente a proporção do viewBox — a conversão é uma regra de três.
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const frac = (px - PAD.left) / PLOT_W;
    const i = Math.round(frac * (n - 1));
    setFoco(i >= 0 && i < n ? i : null);
  };

  const aoTeclado = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setFoco((f) => {
      const atual = f ?? n - 1;
      return Math.min(
        n - 1,
        Math.max(0, atual + (e.key === "ArrowRight" ? 1 : -1)),
      );
    });
  };

  // A penalidade acontece na rodada N, que é o índice N+1 da série.
  const idxPenalidade = RODADA_DA_PENALIDADE + 1;
  const mostrarPenalidade = idxPenalidade < n;

  const serieDestaque = series.find((s) => s.destaque)!;
  const valorFinalDestaque = serieDestaque.valores[n - 1];

  return (
    <figure className="m-0">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <figcaption>
          <h3
            className="text-base font-semibold"
            style={{ color: "var(--tinta)" }}
          >
            Reputação por rodada de treinamento
          </h3>
          <p className="mt-0.5 text-sm" style={{ color: "var(--tinta-2)" }}>
            Instituto Delta em destaque; as demais instituições ao fundo, como
            contexto.
          </p>
        </figcaption>
        <button
          onClick={() => setVerTabela((v) => !v)}
          className="btn-fantasma px-2.5 py-1.5 text-xs"
          aria-expanded={verTabela}
        >
          {verTabela ? "Ver gráfico" : "Ver tabela"}
        </button>
      </div>

      {/* Legenda sempre presente: identidade nunca depende só da cor */}
      <ul
        className="mb-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs"
        style={{ color: "var(--tinta-2)" }}
      >
        {series.map(({ inst, destaque }) => (
          <li key={inst.id} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-0.5 w-4 rounded-full"
              style={{
                background: destaque ? "var(--acento)" : "var(--recuo)",
              }}
            />
            <span style={{ color: destaque ? "var(--tinta)" : undefined }}>
              {inst.nome}
              {destaque ? " (sleepy adversary)" : ""}
            </span>
          </li>
        ))}
      </ul>

      {verTabela ? (
        <TabelaSerie rotulos={rotulos} series={series} />
      ) : (
        <div className="relative">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            style={{ width: "100%", height: "auto" }}
            role="img"
            tabIndex={0}
            aria-label={`Gráfico de linhas da reputação de ${INSTITUICOES.length} instituições ao longo de ${rodada + 1} rodadas. Instituto Delta termina em ${valorFinalDestaque}.`}
            onPointerMove={aoMover}
            onPointerLeave={() => setFoco(null)}
            onKeyDown={aoTeclado}
            onBlur={() => setFoco(null)}
          >
            {/* Grade — hairline sólida, um passo fora da superfície */}
            {TICKS.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={PAD.left + PLOT_W}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--grade)"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 10}
                  y={y(t) + 4}
                  textAnchor="end"
                  fontSize={11}
                  className="tabular"
                  fill="var(--tinta-muda)"
                >
                  {t}
                </text>
              </g>
            ))}

            {/* Linha de partida: todo participante entra com 500 */}
            <text
              x={PAD.left + 4}
              y={y(500) - 6}
              fontSize={10}
              fill="var(--tinta-muda)"
            >
              inicial 500
            </text>

            {/* Eixo X */}
            <line
              x1={PAD.left}
              x2={PAD.left + PLOT_W}
              y1={y(0)}
              y2={y(0)}
              stroke="var(--linha-base)"
              strokeWidth={1}
            />
            {rotulos.map((r, i) =>
              n <= 8 || i % 2 === 0 || i === n - 1 ? (
                <text
                  key={r}
                  x={x(i)}
                  y={H - 16}
                  textAnchor="middle"
                  fontSize={11}
                  className="tabular"
                  fill="var(--tinta-muda)"
                >
                  {r}
                </text>
              ) : null,
            )}

            {/* Marcação do evento de penalidade */}
            {mostrarPenalidade && (
              <g>
                <line
                  x1={x(idxPenalidade)}
                  x2={x(idxPenalidade)}
                  y1={PAD.top}
                  y2={y(0)}
                  stroke="var(--critico)"
                  strokeWidth={1}
                />
                <text
                  x={x(idxPenalidade) - 6}
                  y={PAD.top + 11}
                  textAnchor="end"
                  fontSize={10}
                  fontWeight={600}
                  fill="var(--critico)"
                >
                  penalidade
                </text>
              </g>
            )}

            {/* Séries de contexto primeiro, para o destaque ficar por cima */}
            {series
              .filter((s) => !s.destaque)
              .map(({ inst, valores }) => (
                <path
                  key={inst.id}
                  d={caminho(valores)}
                  fill="none"
                  stroke="var(--recuo)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.55}
                />
              ))}

            <path
              d={caminho(serieDestaque.valores)}
              fill="none"
              stroke="var(--acento)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Ponto final da série em destaque, com anel de 2px na cor da superfície */}
            <circle
              cx={x(n - 1)}
              cy={y(valorFinalDestaque)}
              r={4.5}
              fill="var(--acento)"
              stroke="var(--superficie)"
              strokeWidth={2}
            />
            {/* Rótulo direto — só na série que conta a história */}
            <text
              x={x(n - 1) + 12}
              y={y(valorFinalDestaque) + 4}
              fontSize={12}
              fontWeight={600}
              fill="var(--tinta)"
            >
              {valorFinalDestaque}
            </text>
            <text
              x={x(n - 1) + 12}
              y={y(valorFinalDestaque) + 18}
              fontSize={10}
              fill="var(--tinta-muda)"
            >
              Inst. Delta
            </text>

            {/* Crosshair */}
            {foco !== null && (
              <g pointerEvents="none">
                <line
                  x1={x(foco)}
                  x2={x(foco)}
                  y1={PAD.top}
                  y2={y(0)}
                  stroke="var(--linha-base)"
                  strokeWidth={1}
                />
                {series.map(({ inst, valores, destaque }) => (
                  <circle
                    key={inst.id}
                    cx={x(foco)}
                    cy={y(valores[foco])}
                    r={4}
                    fill={destaque ? "var(--acento)" : "var(--recuo)"}
                    stroke="var(--superficie)"
                    strokeWidth={2}
                  />
                ))}
              </g>
            )}
          </svg>

          {foco !== null && (
            <div
              className="vidro-alto pointer-events-none absolute top-2 z-10 w-52 p-2.5 text-xs"
              style={{
                left: `calc(${(x(foco) / W) * 100}% + ${foco > n / 2 ? "-14rem" : "0.75rem"})`,
              }}
              role="status"
            >
              <div
                className="mb-1.5 font-semibold"
                style={{ color: "var(--tinta)" }}
              >
                {rotulos[foco]}
              </div>
              <dl className="space-y-1">
                {series
                  .slice()
                  .sort((a, b) => b.valores[foco] - a.valores[foco])
                  .map(({ inst, valores, destaque }) => (
                    <div key={inst.id} className="flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="inline-block h-0.5 w-3 shrink-0 rounded-full"
                        style={{
                          background: destaque
                            ? "var(--acento)"
                            : "var(--recuo)",
                        }}
                      />
                      <dt
                        className="truncate"
                        style={{ color: "var(--tinta-2)" }}
                      >
                        {inst.sigla}
                      </dt>
                      <dd
                        className="tabular ml-auto font-medium"
                        style={{ color: "var(--tinta)" }}
                      >
                        {valores[foco]}
                      </dd>
                    </div>
                  ))}
              </dl>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

function TabelaSerie({
  rotulos,
  series,
}: {
  rotulos: string[];
  series: { inst: (typeof INSTITUICOES)[number]; valores: number[] }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[540px] border-collapse text-sm">
        <caption className="sr-only">
          Reputação de cada instituição por rodada
        </caption>
        <thead>
          <tr style={{ color: "var(--tinta-2)" }}>
            <th
              scope="col"
              className="border-b py-2 pr-3 text-left font-medium"
              style={{ borderColor: "var(--borda)" }}
            >
              Instituição
            </th>
            {rotulos.map((r) => (
              <th
                key={r}
                scope="col"
                className="tabular border-b py-2 px-2 text-right font-medium"
                style={{ borderColor: "var(--borda)" }}
              >
                {r}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {series.map(({ inst, valores }) => (
            <tr key={inst.id}>
              <th
                scope="row"
                className="border-b py-2 pr-3 text-left font-normal"
                style={{ borderColor: "var(--borda)", color: "var(--tinta)" }}
              >
                {inst.nome}
              </th>
              {valores.map((v, i) => (
                <td
                  key={i}
                  className="tabular border-b py-2 px-2 text-right"
                  style={{
                    borderColor: "var(--borda)",
                    color: "var(--tinta-2)",
                  }}
                >
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
