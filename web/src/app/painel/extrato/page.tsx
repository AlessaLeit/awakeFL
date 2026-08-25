"use client";

import { useMemo, useState } from "react";
import Cabecalho from "@/components/painel/Cabecalho";
import { useAwakeFL } from "@/lib/anchor/estado";
import { encurta, explorerConta, explorerTx } from "@/lib/anchor/program";

type Filtro = "todos" | "contribuicoes" | "assinaturas";

interface Linha {
  chave: string;
  tipo: string;
  /** Epoch ms, ou null quando o dado não carrega tempo (contas não guardam). */
  quando: number | null;
  referencia: string;
  url: string;
  status: "Confirmado" | "Pendente" | "Aprovado" | "Rejeitado" | "Expirado";
  familia: Exclude<Filtro, "todos">;
  detalhe: string;
}

const CORES: Record<Linha["status"], string> = {
  Confirmado: "var(--bom)",
  Aprovado: "var(--bom)",
  Pendente: "var(--aviso)",
  Rejeitado: "var(--critico)",
  // Neutro: expirar não é reprovar. A contribuição não foi julgada ruim —
  // não foi julgada.
  Expirado: "var(--tinta-muda)",
};

export default function Extrato() {
  const { minhasContribuicoes, registros, meuParticipante, carregando } =
    useAwakeFL();
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busca, setBusca] = useState("");
  const [copiado, setCopiado] = useState<string | null>(null);

  /**
   * O extrato é DERIVADO, não indexado.
   *
   * As contribuições vêm das contas do programa, que são o registro definitivo
   * mas não guardam timestamp. As assinaturas vêm desta sessão do browser, que
   * tem a hora mas se perde ao recarregar. Um histórico completo com data exigiria
   * varrer as transações do programa num indexador — fora do MVP. A tela diz
   * isso em vez de fingir um extrato contínuo.
   */
  const linhas = useMemo<Linha[]>(() => {
    const deContribuicoes: Linha[] = minhasContribuicoes.map((c) => ({
      chave: c.endereco.toBase58(),
      tipo: "Contribuição enviada",
      quando: null,
      referencia: c.updateHash,
      url: explorerConta(c.endereco),
      status: c.status,
      familia: "contribuicoes",
      detalhe: `rodada ${c.round} · ${c.nSamples} amostras · acurácia ${(c.accuracy * 100).toFixed(1)}%`,
    }));

    const deRegistros: Linha[] = registros.map((r) => ({
      chave: r.sig,
      tipo: r.rotulo,
      quando: r.quando,
      referencia: r.sig,
      url: explorerTx(r.sig),
      status: "Confirmado",
      familia: "assinaturas",
      detalhe: "assinatura desta sessão",
    }));

    return [...deRegistros, ...deContribuicoes].sort((a, b) => {
      if (a.quando && b.quando) return b.quando - a.quando;
      if (a.quando) return -1;
      if (b.quando) return 1;
      return 0;
    });
  }, [minhasContribuicoes, registros]);

  const visiveis = linhas.filter((l) => {
    if (filtro !== "todos" && l.familia !== filtro) return false;
    if (!busca.trim()) return true;
    const q = busca.trim().toLowerCase();
    return (
      l.tipo.toLowerCase().includes(q) ||
      l.referencia.toLowerCase().includes(q) ||
      l.status.toLowerCase().includes(q) ||
      l.detalhe.toLowerCase().includes(q)
    );
  });

  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(texto);
      window.setTimeout(() => setCopiado(null), 1600);
    } catch {
      // Clipboard bloqueada (contexto inseguro ou permissão negada): o valor
      // continua selecionável na tela, então não vale interromper o usuário.
    }
  };

  const exportarCsv = () => {
    const cabecalho = ["tipo", "quando", "referencia", "status", "detalhe"];
    const corpo = visiveis.map((l) => [
      l.tipo,
      l.quando ? new Date(l.quando).toISOString() : "",
      l.referencia,
      l.status,
      l.detalhe,
    ]);
    // Aspas duplicadas e campos entre aspas: o detalhe tem vírgulas.
    const csv = [cabecalho, ...corpo]
      .map((linha) =>
        linha.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","),
      )
      .join("\n");

    const url = URL.createObjectURL(
      new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `awakefl-extrato-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Cabecalho
        titulo="Histórico de Transações"
        subtitulo="Visualize e filtre o extrato das suas contribuições e assinaturas."
        acao={
          <button
            onClick={exportarCsv}
            disabled={visiveis.length === 0}
            className="btn-neon px-4 py-2.5 text-sm"
          >
            ↓ Exportar CSV
          </button>
        }
      />

      <div className="vidro mb-6 flex flex-wrap items-center gap-4 p-4">
        <div
          className="flex rounded p-1"
          style={{ background: "var(--superficie-baixa)" }}
          role="group"
          aria-label="Filtrar por tipo"
        >
          {(
            [
              ["todos", "Todos"],
              ["contribuicoes", "Contribuições"],
              ["assinaturas", "Assinaturas"],
            ] as const
          ).map(([valor, rotulo]) => (
            <button
              key={valor}
              onClick={() => setFiltro(valor)}
              aria-pressed={filtro === valor}
              className="rounded px-3.5 py-1.5 text-sm transition-colors"
              style={{
                background:
                  filtro === valor ? "var(--superficie-3)" : "transparent",
                color: filtro === valor ? "var(--tinta)" : "var(--tinta-2)",
                fontWeight: filtro === valor ? 600 : 400,
              }}
            >
              {rotulo}
            </button>
          ))}
        </div>

        <label className="ml-auto min-w-[240px] flex-1">
          <span className="sr-only">Buscar no extrato</span>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="campo"
            placeholder="Buscar por hash, tipo ou status…"
            type="search"
          />
        </label>
      </div>

      <div className="vidro overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <caption className="sr-only">
              Extrato de contribuições e assinaturas do participante
            </caption>
            <thead>
              <tr className="rotulo">
                <th scope="col" className="px-5 py-3 text-left">
                  Tipo
                </th>
                <th scope="col" className="px-5 py-3 text-left">
                  Data / hora
                </th>
                <th scope="col" className="px-5 py-3 text-left">
                  Referência
                </th>
                <th scope="col" className="px-5 py-3 text-right">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {visiveis.length === 0 && (
                <tr
                  className="border-t"
                  style={{ borderColor: "var(--borda)" }}
                >
                  <td
                    colSpan={4}
                    className="px-5 py-10 text-center text-sm"
                    style={{ color: "var(--tinta-muda)" }}
                  >
                    {carregando
                      ? "Lendo a Devnet…"
                      : !meuParticipante
                        ? "Sem nó registrado, não há extrato. Registre-se na Visão Geral."
                        : linhas.length === 0
                          ? "Nenhuma contribuição ainda. A primeira submissão aparece aqui."
                          : "Nenhuma linha corresponde ao filtro."}
                  </td>
                </tr>
              )}

              {visiveis.map((l) => (
                <tr
                  key={l.chave}
                  className="border-t transition-colors hover:bg-[rgba(255,255,255,0.02)]"
                  style={{
                    borderColor: "var(--borda)",
                    boxShadow: `inset 3px 0 0 0 ${CORES[l.status]}`,
                  }}
                >
                  <th scope="row" className="px-5 py-4 text-left font-medium">
                    <span style={{ color: "var(--tinta)" }}>{l.tipo}</span>
                    <span
                      className="mt-0.5 block text-xs font-normal"
                      style={{ color: "var(--tinta-muda)" }}
                    >
                      {l.detalhe}
                    </span>
                  </th>
                  <td
                    className="tabular px-5 py-4"
                    style={{ color: "var(--tinta-2)" }}
                  >
                    {l.quando ? (
                      new Date(l.quando).toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    ) : (
                      <span style={{ color: "var(--tinta-muda)" }}>
                        — sem carimbo on-chain
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <span className="flex items-center gap-2">
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mono text-xs underline"
                        style={{ color: "var(--tinta-2)" }}
                      >
                        {encurta(l.referencia, 6)}
                      </a>
                      <button
                        onClick={() => void copiar(l.referencia)}
                        className="text-xs transition-colors hover:text-[var(--acento)]"
                        style={{ color: "var(--tinta-muda)" }}
                        aria-label={`Copiar ${l.referencia}`}
                      >
                        {copiado === l.referencia ? "copiado" : "⧉"}
                      </button>
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <span
                      className="chip"
                      style={{
                        borderColor: `color-mix(in srgb, ${CORES[l.status]} 40%, transparent)`,
                        color: CORES[l.status],
                      }}
                    >
                      ● {l.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p
        className="mt-5 text-xs leading-relaxed"
        style={{ color: "var(--tinta-muda)" }}
      >
        As contribuições vêm das contas do programa, que são o registro
        definitivo mas não guardam data — por isso a coluna de tempo fica vazia
        nelas. As assinaturas têm hora porque foram feitas nesta aba do browser,
        e somem ao recarregar. Um extrato datado e contínuo exigiria um
        indexador varrendo as transações do programa, o que está fora do MVP.
      </p>
    </>
  );
}
