"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import StatTile from "@/components/StatTile";
import StatusBadge from "@/components/StatusBadge";
import ReputationChart from "@/components/ReputationChart";
import {
  INSTITUICOES,
  RODADAS,
  RODADA_DA_PENALIDADE,
  RODADA_DO_ATAQUE,
  TOTAL_RODADAS,
  instituicaoPorId,
  picoDe,
} from "@/lib/simulation";

export default function Dashboard() {
  const [rodada, setRodada] = useState(TOTAL_RODADAS - 1);
  const [tocando, setTocando] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!tocando) return;
    timer.current = setInterval(() => {
      setRodada((r) => {
        if (r >= TOTAL_RODADAS - 1) {
          setTocando(false);
          return r;
        }
        return r + 1;
      });
    }, 900);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [tocando]);

  const estados = RODADAS[rodada].estados;

  const ativos = estados.filter((e) => !e.banido).length;
  const banidos = estados.filter((e) => e.banido).length;
  const contribuicoes = estados.reduce((s, e) => s + e.contribuicoes, 0);
  const mediaAtivos = Math.round(
    estados.filter((e) => !e.banido).reduce((s, e) => s + e.reputacao, 0) /
      Math.max(1, ativos),
  );

  const delta = estados.find((e) => e.id === "delta")!;
  const picoDelta = picoDe("delta");

  const eventos = useMemo(
    () =>
      RODADAS.slice(0, rodada + 1)
        .flatMap((r) => r.eventos)
        .reverse()
        .slice(0, 14),
    [rodada],
  );

  const reiniciar = () => {
    setTocando(false);
    setRodada(0);
  };

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-6xl px-5 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">
            Demo do ciclo de reputação
          </h1>
          <p
            className="mt-1.5 max-w-2xl text-sm"
            style={{ color: "var(--tinta-2)" }}
          >
            Cinco instituições treinando um modelo em conjunto. Avance as
            rodadas e observe o Instituto Delta construir reputação por oito
            rodadas antes de envenenar o modelo — e o que acontece quando é
            detectado.
          </p>
        </div>

        {/* Uma única barra de filtro acima de tudo que ela controla */}
        <div className="vidro mb-6 flex flex-wrap items-center gap-4 p-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTocando((t) => !t)}
              className="btn-neon px-3.5 py-2 text-sm"
            >
              {tocando ? "Pausar" : "Reproduzir"}
            </button>
            <button
              onClick={reiniciar}
              className="btn-fantasma px-3 py-2 text-sm"
            >
              Reiniciar
            </button>
          </div>

          <label className="flex min-w-[240px] flex-1 items-center gap-3 text-sm">
            <span
              className="whitespace-nowrap"
              style={{ color: "var(--tinta-2)" }}
            >
              Rodada
            </span>
            <input
              type="range"
              min={0}
              max={TOTAL_RODADAS - 1}
              value={rodada}
              onChange={(e) => {
                setTocando(false);
                setRodada(Number(e.target.value));
              }}
              className="w-full"
              style={{ accentColor: "var(--acento)" }}
            />
            <span
              className="tabular w-10 text-right font-semibold"
              style={{ color: "var(--tinta)" }}
            >
              {rodada}
            </span>
          </label>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            rotulo="Participantes ativos"
            valor={ativos}
            nota={`${INSTITUICOES.length} registrados`}
          />
          <StatTile
            rotulo="Reputação média (ativos)"
            valor={mediaAtivos}
            nota="escala 0–1000"
          />
          <StatTile
            rotulo="Contribuições registradas"
            valor={contribuicoes}
            nota="imutáveis na chain"
          />
          <StatTile
            rotulo="Banidos"
            valor={banidos}
            nota={banidos > 0 ? "banimento permanente" : "nenhum até aqui"}
            tom={banidos > 0 ? "critico" : "neutro"}
          />
        </div>

        {/* Narrativa do sleepy adversary, ligada ao estado atual */}
        <div
          className="vidro mb-6 p-4"
          style={{
            borderColor: delta.banido ? "var(--critico)" : "var(--borda)",
            background: delta.banido ? "var(--critico-lavado)" : undefined,
          }}
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-sm font-semibold">Instituto Delta</span>
            <StatusBadge status={delta.status} />
            <span
              className="ml-auto text-sm"
              style={{ color: "var(--tinta-2)" }}
            >
              reputação{" "}
              <span
                className="tabular font-semibold"
                style={{ color: "var(--tinta)" }}
              >
                {delta.reputacao}
              </span>
              {delta.banido && (
                <>
                  {" "}
                  <span style={{ color: "var(--tinta-muda)" }}>
                    (pico histórico {picoDelta})
                  </span>
                </>
              )}
            </span>
          </div>
          <p className="mt-2 text-sm" style={{ color: "var(--tinta-2)" }}>
            {rodada < RODADA_DO_ATAQUE
              ? `Contribuindo honestamente. A cada rodada ganha reputação — e com ela, peso na agregação do modelo. É o investimento do atacante.`
              : rodada < RODADA_DA_PENALIDADE
                ? `Começou a enviar atualizações envenenadas na rodada ${RODADA_DO_ATAQUE}. Note que a média móvel derruba a reputação devagar: essa lentidão é a janela de dano.`
                : `Detectado e penalizado na rodada ${RODADA_DA_PENALIDADE}: reputação dividida por 10 e banimento permanente. As oito rodadas de reputação acumulada viraram nada.`}
          </p>
        </div>

        <section className="vidro mb-6 p-4">
          <ReputationChart rodada={rodada} />
        </section>

        <div className="grid gap-6 lg:grid-cols-5">
          <section className="lg:col-span-3">
            <h2 className="mb-2 text-base font-semibold">Participantes</h2>
            <div className="vidro overflow-x-auto ">
              <table className="w-full min-w-[460px] border-collapse text-sm">
                <thead>
                  <tr style={{ color: "var(--tinta-2)" }}>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left font-medium"
                    >
                      Instituição
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-right font-medium"
                    >
                      Reputação
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-right font-medium"
                    >
                      Contrib.
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left font-medium"
                    >
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {estados
                    .slice()
                    .sort((a, b) => b.reputacao - a.reputacao)
                    .map((e) => {
                      const inst = instituicaoPorId(e.id);
                      return (
                        <tr
                          key={e.id}
                          className="border-t"
                          style={{ borderColor: "var(--borda)" }}
                        >
                          <th
                            scope="row"
                            className="px-4 py-2.5 text-left font-normal"
                          >
                            <span style={{ color: "var(--tinta)" }}>
                              {inst.nome}
                            </span>
                            {inst.perfil === "sleepy" && (
                              <span
                                className="ml-2 text-xs"
                                style={{ color: "var(--tinta-muda)" }}
                              >
                                sleepy adversary
                              </span>
                            )}
                          </th>
                          <td
                            className="tabular px-4 py-2.5 text-right font-semibold"
                            style={{
                              color: e.banido
                                ? "var(--critico)"
                                : "var(--tinta)",
                            }}
                          >
                            {e.reputacao}
                          </td>
                          <td
                            className="tabular px-4 py-2.5 text-right"
                            style={{ color: "var(--tinta-2)" }}
                          >
                            {e.contribuicoes}
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusBadge status={e.status} />
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="lg:col-span-2">
            <h2 className="mb-2 text-base font-semibold">
              Trilha de auditoria
            </h2>
            <ol className="vidro max-h-[420px] overflow-y-auto text-sm">
              {eventos.map((ev, i) => (
                <li
                  key={`${ev.assinatura}-${i}`}
                  className="border-b px-4 py-2.5 last:border-b-0"
                  style={{ borderColor: "var(--borda)" }}
                >
                  <div className="flex items-baseline gap-2">
                    <span
                      className="tabular text-xs"
                      style={{ color: "var(--tinta-muda)" }}
                    >
                      R{ev.rodada}
                    </span>
                    <span
                      className="text-xs font-medium uppercase tracking-wide"
                      style={{
                        color:
                          ev.tipo === "penalidade"
                            ? "var(--critico)"
                            : "var(--tinta-muda)",
                      }}
                    >
                      {ev.tipo}
                    </span>
                  </div>
                  <p className="mt-0.5" style={{ color: "var(--tinta-2)" }}>
                    {ev.texto}
                  </p>
                  <code
                    className="tabular mt-1 block text-[11px]"
                    style={{ color: "var(--tinta-muda)" }}
                  >
                    sig {ev.assinatura}…
                  </code>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <p className="mt-8 text-xs" style={{ color: "var(--tinta-muda)" }}>
          Simulação determinística das regras do programa Anchor (EMA de fator
          0,5 e penalidade de divisão por 10). Não há conexão com a Devnet nesta
          página, e as assinaturas exibidas são decorativas.
        </p>
      </main>
      <Footer />
    </>
  );
}
