"use client";

import Cabecalho from "@/components/painel/Cabecalho";
import { useAwakeFL } from "@/lib/anchor/estado";
import {
  encurta,
  explorerConta,
  type ContribuicaoConta,
} from "@/lib/anchor/program";
import {
  explicaScore,
  useAvaliacoes,
  type EstadoAvaliacoes,
} from "@/lib/avaliacoes";

/**
 * A autoridade NÃO pontua — ela assina o que o agregador calculou.
 *
 * O limiar abaixo espelha `ban_threshold` do config off-chain (0,4 na escala
 * [0,1] = 400 aqui). Enquanto a reputação estiver acima dele, o botão de
 * penalizar fica desabilitado: banir alguém que os próprios números da chain
 * não condenam seria uma decisão pessoal, não uma consequência da regra.
 */
const LIMIAR_BANIMENTO = 400;

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
    expirar,
    penalizar,
    carregando,
  } = useAwakeFL();

  const avaliacoes = useAvaliacoes();

  const daRodada = config
    ? contribuicoes.filter((c) => c.round === config.currentRound)
    : [];
  const pendentesDaRodada = daRodada.filter((c) => c.status === "Pendente");
  const julgadas = contribuicoes.filter((c) => c.status !== "Pendente");

  // Pendentes de QUALQUER rodada, não só da corrente.
  //
  // Enquanto a lista era filtrada pela rodada atual, uma contribuição que
  // sobrevivesse a um `advance_round` sumia da tela — e ficava irrecuperável na
  // prática, embora o programa continue aceitando validá-la (as seeds saem de
  // `contribution.round`, a rodada guardada na própria conta, não do config).
  // A instância da Devnet tem duas contribuições assim, da rodada 0, com o
  // config já na rodada 2.
  const pendentes = contribuicoes
    .filter((c) => c.status === "Pendente")
    .sort((a, b) => a.round - b.round);
  const atrasadas = config
    ? pendentes.filter((c) => c.round !== config.currentRound)
    : [];

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
            <div className="flex flex-col items-end gap-1.5">
              <button
                onClick={() => void avancarRodada()}
                // A rodada só fecha com o trabalho DELA julgado. Avançar por
                // cima de uma pendência da rodada corrente deixa a contribuição
                // sem score: o participante submeteu, pagou o aluguel da conta
                // e não recebeu reputação nenhuma pelo trabalho.
                //
                // Pendência de rodada ANTERIOR não trava. Ela avisa (abaixo) e
                // continua assinável, mas travar aqui seria impasse permanente:
                // não existe instrução que remova uma contribuição, então uma
                // que não tenha avaliação publicada — resíduo de teste, por
                // exemplo — congelaria a federação para sempre.
                disabled={ocupado !== null || pendentesDaRodada.length > 0}
                className="btn-neon px-5 py-3 text-sm"
              >
                {ocupado === "rodada"
                  ? "Assinando…"
                  : `▶ Avançar para a rodada ${config.currentRound + 1}`}
              </button>
              {pendentesDaRodada.length > 0 && (
                <span className="text-xs" style={{ color: "var(--aviso)" }}>
                  {pendentesDaRodada.length} contribuiç
                  {pendentesDaRodada.length > 1 ? "ões" : "ão"} desta rodada sem
                  score — assine antes de avançar
                </span>
              )}
              {pendentesDaRodada.length === 0 && atrasadas.length > 0 && (
                <span
                  className="text-xs"
                  style={{ color: "var(--tinta-muda)" }}
                >
                  {atrasadas.length} pendência
                  {atrasadas.length > 1 ? "s" : ""} de rodada anterior — não
                  trava o avanço
                </span>
              )}
            </div>
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
              // O chip acompanha o botão de avançar: os dois falam da rodada
              // corrente, para não dizer "Consolidada" em verde ao lado de um
              // botão bloqueado.
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
                      disabled={
                        ocupado !== null || p.reputation >= LIMIAR_BANIMENTO
                      }
                      title={
                        p.reputation >= LIMIAR_BANIMENTO
                          ? `Reputação ${p.reputation} ainda está acima do limiar ${LIMIAR_BANIMENTO}. O banimento é consequência da regra, não uma decisão da autoridade.`
                          : `Reputação ${p.reputation} cruzou o limiar ${LIMIAR_BANIMENTO} — banimento permanente.`
                      }
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

      {/* Contribuições pendentes — de qualquer rodada */}
      <section className="vidro mt-4 overflow-hidden">
        <div
          className="border-b p-6 pb-4"
          style={{ borderColor: "var(--borda)" }}
        >
          <h2 className="text-lg font-semibold">
            Contribuições pendentes
            {pendentes.length > 0 && ` · ${pendentes.length}`}
          </h2>
          <p className="mt-1 text-sm" style={{ color: "var(--tinta-2)" }}>
            O score é calculado pelo agregador a partir do formato matemático da
            contribuição — a autoridade não escolhe a nota, apenas assina o
            envio. Metade da escala é o limiar: 500 ou mais aprova.
          </p>
          {avaliacoes.ausente && (
            <p className="mono mt-3 text-xs" style={{ color: "var(--aviso)" }}>
              Nenhuma avaliação publicada. Gere com{" "}
              <code>python awakefl-fl/publicar_avaliacoes.py results_demo</code>{" "}
              — sem isso não há score para assinar.
            </p>
          )}
          {avaliacoes.geradoEm && (
            <p
              className="mono mt-3 text-xs"
              style={{ color: "var(--tinta-muda)" }}
            >
              Avaliações publicadas em {avaliacoes.geradoEm}
            </p>
          )}
        </div>
        {atrasadas.length > 0 && (
          <p
            className="mx-6 mb-4 rounded border p-3 text-xs"
            style={{
              borderColor: "var(--aviso)",
              color: "var(--tinta-2)",
              background: "var(--superficie-baixa)",
            }}
          >
            <strong style={{ color: "var(--aviso)" }}>
              {atrasadas.length} de rodada anterior.
            </strong>{" "}
            Ficaram sem score quando a rodada avançou. Continuam válidas — a
            conta guarda a própria rodada, então a assinatura ainda é aceita.
            Sem avaliação publicada não há nota para assinar; nesse caso,{" "}
            <strong>Expirar</strong> encerra a pendência mantendo hash, rodada e
            métricas gravados.
          </p>
        )}
        <TabelaContribuicoes
          linhas={pendentes}
          souAutoridade={souAutoridade}
          avaliacoes={avaliacoes}
          validar={validar}
          expirar={expirar}
          rodadaCorrente={config.currentRound}
          ocupado={ocupado}
          vazio="Nenhuma contribuição pendente."
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
          avaliacoes={avaliacoes}
          validar={validar}
          ocupado={ocupado}
          vazio="Nada foi validado ainda."
        />
      </section>
    </>
  );
}

function corDoStatus(status: ContribuicaoConta["status"]): string {
  if (status === "Aprovado") return "var(--bom)";
  if (status === "Expirado") return "var(--tinta-muda)";
  return "var(--critico)";
}

function TabelaContribuicoes({
  linhas,
  souAutoridade,
  avaliacoes,
  validar,
  expirar,
  rodadaCorrente,
  ocupado,
  vazio,
}: {
  linhas: ContribuicaoConta[];
  souAutoridade: boolean;
  avaliacoes: EstadoAvaliacoes;
  validar: (c: ContribuicaoConta, score: number) => Promise<void>;
  expirar?: (c: ContribuicaoConta) => Promise<void>;
  rodadaCorrente?: number;
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
            // A avaliação é encontrada pelo HASH gravado on-chain — nenhum
            // mapeamento de carteira no meio.
            const publicada = avaliacoes.porHash[c.updateHash];
            const score = publicada?.avaliacao.score;
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
                    <span className="flex flex-wrap items-center gap-2">
                      {/* Expirado é neutro, não reprovação: ninguém julgou a
                          contribuição. Pintá-la de vermelho junto das
                          rejeitadas diria que ela foi considerada ruim. */}
                      <span
                        className="chip"
                        style={{
                          borderColor: `color-mix(in srgb, ${corDoStatus(c.status)} 45%, transparent)`,
                          color: corDoStatus(c.status),
                        }}
                      >
                        {c.status === "Aprovado"
                          ? "✓"
                          : c.status === "Expirado"
                            ? "—"
                            : "✕"}{" "}
                        {c.status}
                      </span>
                      {score !== undefined && (
                        <span
                          className="tabular text-xs"
                          style={{ color: "var(--tinta-muda)" }}
                        >
                          score {score}
                        </span>
                      )}
                    </span>
                  ) : souAutoridade ? (
                    score === undefined ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <span
                          className="text-xs"
                          style={{ color: "var(--aviso)" }}
                        >
                          {avaliacoes.carregando
                            ? "carregando avaliações…"
                            : "sem avaliação publicada para este hash"}
                        </span>
                        {/* Saída para a pendência que nunca terá nota. Só de
                            rodada encerrada: na corrente, a obrigação da
                            autoridade é pontuar, não expirar. */}
                        {expirar &&
                          rodadaCorrente !== undefined &&
                          c.round < rodadaCorrente &&
                          !avaliacoes.carregando && (
                            <button
                              onClick={() => void expirar(c)}
                              disabled={ocupado !== null}
                              className="btn-contorno px-3 py-1.5 text-xs"
                              title="Encerra a pendência sem apagar o registro: hash, rodada e métricas continuam na conta"
                            >
                              {ocupado === `expirar-${chave}`
                                ? "Assinando…"
                                : "Expirar"}
                            </button>
                          )}
                      </span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-2">
                        <span
                          className="chip tabular"
                          style={{
                            borderColor: publicada.avaliacao.aprovado
                              ? "var(--acento)"
                              : "var(--critico)",
                            color: publicada.avaliacao.aprovado
                              ? "var(--acento)"
                              : "var(--critico)",
                          }}
                          title={explicaScore(
                            publicada.avaliacao.justificativa,
                          )}
                        >
                          score {score}
                        </span>
                        <button
                          onClick={() => void validar(c, score)}
                          disabled={ocupado !== null}
                          className="btn-neon px-3 py-1.5 text-xs"
                        >
                          Assinar
                        </button>
                        {/* O porquê da nota, visível e não só no tooltip: um
                            número sem explicação não pode ser contestado. */}
                        <span
                          className="basis-full text-[11px] leading-snug"
                          style={{ color: "var(--tinta-muda)" }}
                        >
                          {explicaScore(publicada.avaliacao.justificativa)}
                        </span>
                      </span>
                    )
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
