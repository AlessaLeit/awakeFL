"use client";

import { useState } from "react";
import Cabecalho from "@/components/painel/Cabecalho";
import { useAwakeFL } from "@/lib/anchor/estado";
import {
  encurta,
  explorerConta,
  type ContribuicaoConta,
} from "@/lib/anchor/program";

export default function Validador() {
  const {
    config,
    participantes,
    contribuicoes,
    souAutoridade,
    ocupado,
    inicializar,
    avancarRodada,
    validar,
    penalizar,
    carregando,
  } = useAwakeFL();

  const [scores, setScores] = useState<Record<string, string>>({});

  const daRodada = config
    ? contribuicoes.filter((c) => c.round === config.currentRound)
    : [];
  const pendentesDaRodada = daRodada.filter((c) => c.status === "Pendente");
  const julgadas = contribuicoes.filter((c) => c.status !== "Pendente");

  // Quanto da rodada já foi decidido. Com zero contribuições não há progresso a
  // mostrar — 0/0 renderizaria uma barra cheia enganosa.
  const progresso =
    daRodada.length === 0
      ? null
      : Math.round(
          ((daRodada.length - pendentesDaRodada.length) / daRodada.length) *
            100,
        );

  const ativos = participantes.filter((p) => !p.isBanned);
  const banidos = participantes.filter((p) => p.isBanned);

  if (!config) {
    return (
      <>
        <Cabecalho
          titulo="Consenso de Rede"
          subtitulo="Monitoramento e validação de rodadas."
        />
        <div
          className="vidro p-6"
          style={{ boxShadow: "inset 3px 0 0 0 var(--aviso)" }}
        >
          <h2 className="text-lg font-semibold">
            O sistema ainda não foi inicializado
          </h2>
          <p
            className="mt-2 max-w-2xl text-sm leading-relaxed"
            style={{ color: "var(--tinta-2)" }}
          >
            A conta <code className="mono">Config</code> é criada uma única vez,
            e quem assinar esta transação vira a <strong>autoridade</strong> da
            instância — o agregador que pontua contribuições, penaliza
            maliciosos e avança as rodadas.
          </p>
          <button
            onClick={() => void inicializar()}
            disabled={ocupado !== null}
            className="btn-neon mt-5 px-5 py-3 text-sm"
          >
            {ocupado === "init" ? "Assinando…" : "Inicializar programa"}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <Cabecalho
        titulo="Consenso de Rede"
        subtitulo="Monitoramento e validação de rodadas."
        acao={
          souAutoridade ? (
            <button
              onClick={() => void avancarRodada()}
              disabled={ocupado !== null}
              className="btn-neon px-5 py-3 text-sm"
            >
              {ocupado === "rodada"
                ? "Assinando…"
                : `▶ Avançar para a rodada ${config.currentRound + 1}`}
            </button>
          ) : undefined
        }
      />

      {!souAutoridade && (
        <div
          className="vidro mb-6 p-5"
          style={{ boxShadow: "inset 3px 0 0 0 var(--tinta-muda)" }}
        >
          <h2 className="font-semibold">Você está em modo somente-leitura</h2>
          <p
            className="mt-1.5 text-sm leading-relaxed"
            style={{ color: "var(--tinta-2)" }}
          >
            Pontuar contribuições, penalizar e avançar rodada exigem a chave da
            autoridade desta instância (
            <a
              href={explorerConta(config.authority)}
              target="_blank"
              rel="noopener noreferrer"
              className="mono underline"
            >
              {encurta(config.authority)}
            </a>
            ). Todo o estado abaixo, porém, é público — auditar não pede
            permissão.
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Estado da rodada */}
        <section className="vidro p-6 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="rotulo">Status da rodada atual</div>
              <div className="mt-2 text-5xl font-bold tracking-tight">
                #{config.currentRound}
              </div>
            </div>
            <span
              className="chip"
              style={{
                borderColor:
                  pendentesDaRodada.length > 0
                    ? "var(--aviso)"
                    : "var(--acento)",
                color:
                  pendentesDaRodada.length > 0
                    ? "var(--aviso)"
                    : "var(--acento)",
                padding: "0.5rem 0.875rem",
              }}
            >
              ● {pendentesDaRodada.length > 0 ? "Consolidando" : "Consolidada"}
            </span>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              ["Participantes", String(config.totalParticipants)],
              ["Contribuições na rodada", String(daRodada.length)],
              ["Aguardando score", String(pendentesDaRodada.length)],
            ].map(([rotulo, valor]) => (
              <div
                key={rotulo}
                className="rounded border p-4"
                style={{
                  borderColor: "var(--borda)",
                  background: "var(--superficie-baixa)",
                }}
              >
                <div className="text-xs" style={{ color: "var(--tinta-2)" }}>
                  {rotulo}
                </div>
                <div className="tabular mt-1.5 text-2xl font-semibold">
                  {valor}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6">
            <div className="flex items-baseline justify-between text-sm">
              <span style={{ color: "var(--tinta-2)" }}>
                Progresso da validação
              </span>
              <span
                className="tabular font-semibold"
                style={{ color: "var(--acento)" }}
              >
                {progresso === null ? "—" : `${progresso}%`}
              </span>
            </div>
            <div
              className="mt-2 h-2 w-full overflow-hidden rounded-full"
              style={{ background: "var(--superficie-3)" }}
            >
              <div
                className="h-full rounded-full transition-[width]"
                style={{
                  width: `${progresso ?? 0}%`,
                  background: "var(--acento)",
                  boxShadow: "0 0 12px 1px var(--acento-brilho)",
                }}
              />
            </div>
            {progresso === null && (
              <p
                className="mt-2 text-xs"
                style={{ color: "var(--tinta-muda)" }}
              >
                Nenhuma contribuição foi submetida na rodada{" "}
                {config.currentRound} ainda.
              </p>
            )}
          </div>
        </section>

        {/* Fila de nós */}
        <section className="vidro flex flex-col p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="rotulo">Fila de nós</div>
            <span className="chip">{participantes.length} nós</span>
          </div>

          <ul
            className="mt-4 flex flex-col gap-2.5 overflow-y-auto"
            style={{ maxHeight: 340 }}
          >
            {participantes.length === 0 && (
              <li
                className="py-6 text-center text-sm"
                style={{ color: "var(--tinta-muda)" }}
              >
                {carregando
                  ? "Lendo a Devnet…"
                  : "Nenhum participante registrado."}
              </li>
            )}
            {participantes.map((p) => {
              const contribuiu = daRodada.some((c) =>
                c.participant.equals(p.endereco),
              );
              const pendente = pendentesDaRodada.some((c) =>
                c.participant.equals(p.endereco),
              );
              const situacao = p.isBanned
                ? { texto: "Banido", cor: "var(--critico)" }
                : pendente
                  ? { texto: "Aguardando score", cor: "var(--aviso)" }
                  : contribuiu
                    ? { texto: "Validado", cor: "var(--acento)" }
                    : { texto: "Sem submissão", cor: "var(--tinta-muda)" };

              return (
                <li
                  key={p.endereco.toBase58()}
                  className="flex items-center gap-3 rounded border p-3"
                  style={{
                    borderColor: p.isBanned ? "var(--critico)" : "var(--borda)",
                    background: p.isBanned
                      ? "var(--critico-lavado)"
                      : "var(--superficie-baixa)",
                  }}
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: situacao.cor }}
                  />
                  <div className="min-w-0 flex-1">
                    <a
                      href={explorerConta(p.owner)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mono block truncate text-xs underline"
                      style={{ color: "var(--tinta)" }}
                    >
                      {encurta(p.owner, 6)}
                    </a>
                    <span
                      className="text-[11px]"
                      style={{ color: situacao.cor }}
                    >
                      {situacao.texto}
                    </span>
                  </div>
                  <span
                    className="tabular shrink-0 text-sm font-semibold"
                    style={{
                      color: p.isBanned ? "var(--critico)" : "var(--tinta)",
                    }}
                  >
                    {p.reputation}
                  </span>
                  {souAutoridade && !p.isBanned && (
                    <button
                      onClick={() => void penalizar(p)}
                      disabled={ocupado !== null}
                      className="shrink-0 rounded border px-2 py-1 text-[11px] disabled:opacity-40"
                      style={{
                        borderColor: "var(--critico)",
                        color: "var(--critico)",
                      }}
                    >
                      Penalizar
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          <p className="mt-4 text-xs" style={{ color: "var(--tinta-muda)" }}>
            {ativos.length} ativos · {banidos.length} banidos
          </p>
        </section>
      </div>

      {/* Contribuições pendentes desta rodada */}
      <section className="vidro mt-4 overflow-hidden">
        <div
          className="border-b p-6 pb-4"
          style={{ borderColor: "var(--borda)" }}
        >
          <h2 className="text-lg font-semibold">
            Contribuições pendentes · rodada {config.currentRound}
          </h2>
          <p className="mt-1 text-sm" style={{ color: "var(--tinta-2)" }}>
            {souAutoridade
              ? "Um score de 0 a 1000. Metade da escala é o limiar: 500 ou mais aprova, abaixo disso rejeita. A reputação move pela média móvel em qualquer dos casos."
              : "Aguardando a autoridade pontuar."}
          </p>
        </div>
        <TabelaContribuicoes
          linhas={pendentesDaRodada}
          souAutoridade={souAutoridade}
          scores={scores}
          setScores={setScores}
          validar={validar}
          ocupado={ocupado}
          vazio="Nenhuma contribuição pendente nesta rodada."
        />
      </section>

      {/* Histórico */}
      <section className="vidro mt-4 overflow-hidden">
        <div
          className="border-b p-6 pb-4"
          style={{ borderColor: "var(--borda)" }}
        >
          <h2 className="text-lg font-semibold">Histórico de validação</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--tinta-2)" }}>
            Todas as contribuições já julgadas, de todas as rodadas.
          </p>
        </div>
        <TabelaContribuicoes
          linhas={julgadas}
          souAutoridade={false}
          scores={scores}
          setScores={setScores}
          validar={validar}
          ocupado={ocupado}
          vazio="Nada foi validado ainda."
        />
      </section>
    </>
  );
}

function TabelaContribuicoes({
  linhas,
  souAutoridade,
  scores,
  setScores,
  validar,
  ocupado,
  vazio,
}: {
  linhas: ContribuicaoConta[];
  souAutoridade: boolean;
  scores: Record<string, string>;
  setScores: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  validar: (c: ContribuicaoConta, score: number) => Promise<void>;
  ocupado: string | null;
  vazio: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] border-collapse text-sm">
        <thead>
          <tr className="rotulo">
            <th scope="col" className="px-6 py-3 text-left">
              Rodada
            </th>
            <th scope="col" className="px-4 py-3 text-left">
              Participante
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Amostras
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Acurácia
            </th>
            <th scope="col" className="px-6 py-3 text-left">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {linhas.length === 0 && (
            <tr className="border-t" style={{ borderColor: "var(--borda)" }}>
              <td
                colSpan={5}
                className="px-6 py-8 text-center"
                style={{ color: "var(--tinta-muda)" }}
              >
                {vazio}
              </td>
            </tr>
          )}
          {linhas.map((c) => {
            const chave = c.endereco.toBase58();
            const bruto = scores[chave] ?? "";
            const valido = bruto !== "" && Number(bruto) <= 1000;
            return (
              <tr
                key={chave}
                className="border-t"
                style={{ borderColor: "var(--borda)" }}
              >
                <td
                  className="mono tabular px-6 py-4"
                  style={{ color: "var(--tinta-2)" }}
                >
                  #{c.round}
                </td>
                <td className="px-4 py-4">
                  <a
                    href={explorerConta(c.participant)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mono text-xs underline"
                    style={{ color: "var(--tinta)" }}
                  >
                    {encurta(c.participant, 6)}
                  </a>
                </td>
                <td
                  className="tabular px-4 py-4 text-right"
                  style={{ color: "var(--tinta-2)" }}
                >
                  {c.nSamples}
                </td>
                <td
                  className="tabular px-4 py-4 text-right"
                  style={{ color: "var(--tinta-2)" }}
                >
                  {(c.accuracy * 100).toFixed(1)}%
                </td>
                <td className="px-6 py-4">
                  {c.status !== "Pendente" ? (
                    <span
                      className="chip"
                      style={{
                        borderColor:
                          c.status === "Aprovado"
                            ? "color-mix(in srgb, var(--bom) 45%, transparent)"
                            : "color-mix(in srgb, var(--critico) 45%, transparent)",
                        color:
                          c.status === "Aprovado"
                            ? "var(--bom)"
                            : "var(--critico)",
                      }}
                    >
                      {c.status === "Aprovado" ? "✓" : "✕"} {c.status}
                    </span>
                  ) : souAutoridade ? (
                    <span className="flex items-center gap-2">
                      <input
                        value={bruto}
                        onChange={(e) =>
                          setScores((s) => ({
                            ...s,
                            [chave]: e.target.value
                              .replace(/\D/g, "")
                              .slice(0, 4),
                          }))
                        }
                        placeholder="0–1000"
                        inputMode="numeric"
                        aria-label={`Score da contribuição ${encurta(c.endereco)}`}
                        className="campo tabular w-24 px-2 py-1.5 text-xs"
                      />
                      <button
                        onClick={() => void validar(c, Number(bruto))}
                        disabled={ocupado !== null || !valido}
                        className="btn-neon px-3 py-1.5 text-xs"
                      >
                        Validar
                      </button>
                    </span>
                  ) : (
                    <span
                      className="chip"
                      style={{
                        color: "var(--aviso)",
                        borderColor: "var(--aviso)",
                      }}
                    >
                      ● Pendente
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
