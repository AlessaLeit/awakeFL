"use client";

import { useMemo, useState } from "react";

const MAX_REP = 1000;
const RODADAS = 10;

const W = 720;
const H = 260;
const PAD = { top: 20, right: 56, bottom: 34, left: 44 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;
const TICKS = [0, 250, 500, 750, 1000];

/**
 * Para onde a reputação vai nas próximas rodadas, dado um score constante.
 *
 * Esta é DELIBERADAMENTE uma projeção, não um histórico. O programa guarda
 * apenas a reputação corrente — as anteriores só existem nos eventos das
 * transações passadas, e ler isso exigiria um indexador que o MVP não tem.
 * Desenhar um "histórico" aqui seria inventar dados.
 *
 * A curva usa a mesma aritmética inteira do programa, inclusive o truncamento
 * da divisão, então o número da décima rodada bate com o que a chain daria.
 */
export default function ProjecaoReputacao({ atual }: { atual: number }) {
  const [score, setScore] = useState(800);
  const [verTabela, setVerTabela] = useState(false);

  const serie = useMemo(() => {
    const vs = [atual];
    for (let i = 0; i < RODADAS; i++) {
      // R(t) = (R(t-1) + S) / 2, com divisão inteira, como em apply_ema.
      vs.push(Math.floor((vs[vs.length - 1] + score) / 2));
    }
    return vs;
  }, [atual, score]);

  const n = serie.length;
  const x = (i: number) => PAD.left + (i / (n - 1)) * PLOT_W;
  const y = (v: number) => PAD.top + (1 - v / MAX_REP) * PLOT_H;
  const caminho = serie
    .map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`)
    .join(" ");
  const area = `${caminho} L ${x(n - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`;

  const final = serie[n - 1];

  return (
    <figure className="vidro m-0 p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <figcaption>
          <h2 className="text-lg font-semibold tracking-tight">
            Projeção de reputação
          </h2>
          <p className="mt-1 text-sm" style={{ color: "var(--tinta-2)" }}>
            Onde sua reputação chega em {RODADAS} rodadas se cada contribuição
            for pontuada com o mesmo score. Projeção, não histórico.
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

      <label className="block">
        <span className="rotulo">Score por rodada · {score}</span>
        <input
          type="range"
          min={0}
          max={MAX_REP}
          step={10}
          value={score}
          onChange={(e) => setScore(Number(e.target.value))}
          className="mt-2 w-full"
          style={{ accentColor: "var(--acento)" }}
        />
        <span
          className="mono flex justify-between text-[11px]"
          style={{ color: "var(--tinta-muda)" }}
        >
          <span>0 · rejeitado</span>
          <span>500 · limiar</span>
          <span>1000 · máximo</span>
        </span>
      </label>

      {verTabela ? (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <caption className="sr-only">
              Reputação projetada por rodada com score {score}
            </caption>
            <thead>
              <tr className="rotulo">
                <th
                  scope="col"
                  className="border-b py-2 pr-3 text-left"
                  style={{ borderColor: "var(--borda)" }}
                >
                  Rodada
                </th>
                <th
                  scope="col"
                  className="border-b py-2 text-right"
                  style={{ borderColor: "var(--borda)" }}
                >
                  Reputação
                </th>
              </tr>
            </thead>
            <tbody>
              {serie.map((v, i) => (
                <tr key={i}>
                  <th
                    scope="row"
                    className="mono border-b py-2 pr-3 text-left font-normal"
                    style={{
                      borderColor: "var(--borda)",
                      color: "var(--tinta-2)",
                    }}
                  >
                    {i === 0 ? "agora" : `+${i}`}
                  </th>
                  <td
                    className="tabular border-b py-2 text-right"
                    style={{
                      borderColor: "var(--borda)",
                      color: "var(--tinta)",
                    }}
                  >
                    {v}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", height: "auto" }}
          className="mt-5"
          role="img"
          aria-label={`Curva de projeção: partindo de ${atual}, com score ${score} por rodada, a reputação chega a ${final} depois de ${RODADAS} rodadas.`}
        >
          <defs>
            <linearGradient
              id="preenchimento-projecao"
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor="var(--acento)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--acento)" stopOpacity="0" />
            </linearGradient>
            <filter
              id="brilho-projecao"
              x="-20%"
              y="-40%"
              width="140%"
              height="180%"
            >
              <feGaussianBlur stdDeviation="4" result="desfoque" />
              <feMerge>
                <feMergeNode in="desfoque" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

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

          {/* Onde o score empata com a reputação: acima dela a curva sobe,
              abaixo ela desce. É a leitura que explica a EMA de relance. */}
          <line
            x1={PAD.left}
            x2={PAD.left + PLOT_W}
            y1={y(score)}
            y2={y(score)}
            stroke="var(--tinta-muda)"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
          <text
            x={PAD.left + PLOT_W}
            y={y(score) - 6}
            textAnchor="end"
            fontSize={10}
            fill="var(--tinta-muda)"
          >
            score {score}
          </text>

          <path d={area} fill="url(#preenchimento-projecao)" />
          <path
            d={caminho}
            fill="none"
            stroke="var(--acento)"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#brilho-projecao)"
          />

          {serie.map((v, i) =>
            i % 2 === 0 || i === n - 1 ? (
              <circle
                key={i}
                cx={x(i)}
                cy={y(v)}
                r={3.5}
                fill="var(--acento)"
              />
            ) : null,
          )}

          <text
            x={x(n - 1) + 8}
            y={y(final) + 4}
            fontSize={12}
            fontWeight={600}
            fill="var(--tinta)"
          >
            {final}
          </text>

          <line
            x1={PAD.left}
            x2={PAD.left + PLOT_W}
            y1={y(0)}
            y2={y(0)}
            stroke="var(--linha-base)"
            strokeWidth={1}
          />
          {serie.map((_, i) =>
            i % 2 === 0 ? (
              <text
                key={i}
                x={x(i)}
                y={H - 12}
                textAnchor="middle"
                fontSize={11}
                className="tabular"
                fill="var(--tinta-muda)"
              >
                {i === 0 ? "agora" : `+${i}`}
              </text>
            ) : null,
          )}
        </svg>
      )}
    </figure>
  );
}
