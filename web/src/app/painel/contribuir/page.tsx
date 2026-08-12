"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Cabecalho from "@/components/painel/Cabecalho";
import { IconeCadeado } from "@/components/painel/Icones";
import { useAwakeFL } from "@/lib/anchor/estado";
import { sha256DeArquivo, sha256Hex } from "@/lib/anchor/program";

type Origem = "arquivo" | "semente";

export default function NovaContribuicao() {
  const {
    config,
    meuParticipante,
    jaContribuiuNestaRodada,
    submeter,
    ocupado,
    publicKey,
  } = useAwakeFL();

  const [origem, setOrigem] = useState<Origem>("semente");
  const [semente, setSemente] = useState("pesos-locais-rodada-atual");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [hash, setHash] = useState("");
  const [nSamples, setNSamples] = useState("1200");
  const [loss, setLoss] = useState("0.31");
  const [accuracy, setAccuracy] = useState("87.0");
  const inputArquivo = useRef<HTMLInputElement>(null);

  // O hash é recalculado sempre que a entrada muda. A rodada entra na semente
  // para que a mesma string não produza o mesmo compromisso em rodadas
  // diferentes — reusar um hash antigo seria replay de contribuição.
  //
  // Todo setState acontece dentro do `.then`, nunca no corpo do efeito: a Web
  // Crypto só devolve promessas, e um `setHash("")` síncrono aqui dispararia
  // uma renderização em cascata a cada tecla digitada na semente.
  useEffect(() => {
    let vivo = true;
    const calcular = async (): Promise<string> => {
      if (origem === "arquivo") {
        return arquivo ? sha256DeArquivo(arquivo) : "";
      }
      if (!publicKey || !config) return "";
      return sha256Hex(
        `${semente}|${publicKey.toBase58()}|${config.currentRound}`,
      );
    };

    void calcular().then((h) => {
      if (vivo) setHash(h);
    });

    return () => {
      vivo = false;
    };
  }, [origem, arquivo, semente, publicKey, config]);

  // Derivado, não estado: há entrada válida mas o digest ainda não chegou.
  const temEntrada =
    origem === "arquivo"
      ? Boolean(arquivo)
      : Boolean(publicKey && config && semente);
  const calculando = temEntrada && hash.length !== 64;

  const accNum = Number(accuracy);
  const lossNum = Number(loss);
  const accValida = Number.isFinite(accNum) && accNum >= 0 && accNum <= 100;
  const lossValido = Number.isFinite(lossNum) && lossNum >= 0;
  const podeEnviar =
    Boolean(config) &&
    Boolean(meuParticipante) &&
    !meuParticipante?.isBanned &&
    !jaContribuiuNestaRodada &&
    hash.length === 64 &&
    nSamples !== "" &&
    accValida &&
    lossValido &&
    ocupado === null;

  const enviar = () =>
    void submeter({
      hash,
      nSamples,
      loss,
      // A chain guarda acurácia como fração (0..1); a tela pede porcentagem,
      // que é como a métrica sai de um framework de treino.
      accuracy: String(accNum / 100),
    });

  return (
    <>
      <Cabecalho
        titulo="Submeter Contribuição"
        subtitulo="Registre os parâmetros do seu modelo local na rede federada."
      />

      {/* Aviso de registro em blockchain — a barra neon à esquerda é o que
          marca este bloco como informativo, não como erro. */}
      <div
        className="vidro mb-6 flex gap-4 p-5"
        style={{ boxShadow: "inset 3px 0 0 0 var(--acento)" }}
      >
        <IconeCadeado className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <h2 className="font-semibold">Registro em blockchain</h2>
          <p
            className="mono mt-1.5 text-xs leading-relaxed"
            style={{ color: "var(--tinta-2)" }}
          >
            Toda contribuição é imutável e verificável no programa Anchor. O
            hash do modelo garante a integridade dos dados submetidos sem expor
            os pesos originais — o arquivo é lido e digerido no seu browser e
            nunca é enviado.
          </p>
        </div>
      </div>

      {!meuParticipante && (
        <Bloqueio titulo="Seu nó ainda não está registrado">
          Antes de contribuir é preciso criar a conta de participante on-chain.
          O botão está na{" "}
          <Link
            href="/painel"
            className="underline"
            style={{ color: "var(--acento)" }}
          >
            Visão Geral
          </Link>
          .
        </Bloqueio>
      )}

      {meuParticipante?.isBanned && (
        <Bloqueio titulo="Nó banido" critico>
          Contribuições desta carteira são recusadas on-chain com{" "}
          <code className="mono">ParticipantBanned</code>. O banimento é
          permanente e não há instrução que o reverta.
        </Bloqueio>
      )}

      {meuParticipante &&
        !meuParticipante.isBanned &&
        jaContribuiuNestaRodada && (
          <Bloqueio
            titulo={`Você já submeteu na rodada ${config?.currentRound}`}
          >
            O PDA da contribuição é único por participante e rodada, então uma
            segunda submissão falharia on-chain com{" "}
            <code className="mono">already in use</code>. Aguarde a autoridade
            avançar a rodada.
          </Bloqueio>
        )}

      <form
        className="vidro p-6 md:p-8"
        onSubmit={(e) => {
          e.preventDefault();
          if (podeEnviar) enviar();
        }}
      >
        {/* Origem do hash */}
        <fieldset>
          <legend className="rotulo">Origem do compromisso</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {(
              [
                ["semente", "Identificador do modelo"],
                ["arquivo", "Arquivo de pesos local"],
              ] as const
            ).map(([valor, rotulo]) => (
              <button
                key={valor}
                type="button"
                onClick={() => setOrigem(valor)}
                aria-pressed={origem === valor}
                className="rounded px-3 py-2 text-sm transition-colors"
                style={{
                  border: `1px solid ${origem === valor ? "var(--acento)" : "var(--borda)"}`,
                  color: origem === valor ? "var(--acento)" : "var(--tinta-2)",
                  background:
                    origem === valor ? "var(--acento-lavado)" : "transparent",
                }}
              >
                {rotulo}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="mt-5">
          {origem === "semente" ? (
            <label className="block">
              <span className="rotulo">Identificador do modelo local</span>
              <input
                value={semente}
                onChange={(e) => setSemente(e.target.value)}
                className="campo mt-2"
                placeholder="ex: resnet18-hospital-a-epoca-40"
              />
              <span
                className="mt-1.5 block text-xs"
                style={{ color: "var(--tinta-muda)" }}
              >
                Combinado com sua chave pública e a rodada corrente antes de
                gerar o digest, para que o mesmo texto nunca gere o mesmo
                compromisso duas vezes.
              </span>
            </label>
          ) : (
            <div>
              <span className="rotulo">Arquivo de pesos</span>
              <div
                className="mt-2 flex flex-wrap items-center gap-3 rounded border border-dashed p-4"
                style={{
                  borderColor: "var(--borda)",
                  background: "var(--superficie-baixa)",
                }}
              >
                <input
                  ref={inputArquivo}
                  type="file"
                  className="sr-only"
                  onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  onClick={() => inputArquivo.current?.click()}
                  className="btn-contorno px-4 py-2 text-sm"
                >
                  Escolher arquivo
                </button>
                <span
                  className="mono min-w-0 truncate text-xs"
                  style={{ color: "var(--tinta-2)" }}
                >
                  {arquivo
                    ? `${arquivo.name} · ${(arquivo.size / 1024 / 1024).toFixed(2)} MB`
                    : "nenhum arquivo selecionado"}
                </span>
              </div>
              <span
                className="mt-1.5 block text-xs"
                style={{ color: "var(--tinta-muda)" }}
              >
                O arquivo é digerido localmente com a Web Crypto API. Nada sai
                da máquina — só os 64 caracteres do digest vão para a chain.
              </span>
            </div>
          )}
        </div>

        {/* Hash resultante */}
        <div className="mt-6">
          <span className="rotulo">Model Hash (SHA-256)</span>
          <div
            className="mt-2 flex items-center gap-2 rounded border px-3 py-3"
            style={{
              borderColor: "var(--borda)",
              background: "var(--superficie-baixa)",
            }}
          >
            <span
              className="mono shrink-0"
              style={{ color: "var(--acento)" }}
              aria-hidden
            >
              #
            </span>
            <code
              className="mono min-w-0 flex-1 truncate text-xs"
              style={{ color: hash ? "var(--tinta)" : "var(--tinta-muda)" }}
            >
              {calculando
                ? "calculando…"
                : hash || "informe uma origem para gerar o compromisso"}
            </code>
          </div>
        </div>

        {/* Métricas declaradas */}
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="rotulo">Nº de amostras</span>
            <input
              value={nSamples}
              onChange={(e) => setNSamples(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              className="campo tabular mt-2"
              placeholder="Ex: 5000"
            />
          </label>
          <label className="block">
            <span className="rotulo">Training loss</span>
            <input
              value={loss}
              onChange={(e) => setLoss(e.target.value)}
              inputMode="decimal"
              className="campo tabular mt-2"
              placeholder="0.0000"
              aria-invalid={!lossValido}
            />
            {!lossValido && (
              <span
                className="mt-1 block text-xs"
                style={{ color: "var(--critico)" }}
              >
                Precisa ser um número maior ou igual a zero.
              </span>
            )}
          </label>
          <label className="block">
            <span className="rotulo">Acurácia (%)</span>
            <input
              value={accuracy}
              onChange={(e) => setAccuracy(e.target.value)}
              inputMode="decimal"
              className="campo tabular mt-2"
              placeholder="95.5"
              aria-invalid={!accValida}
            />
            {!accValida && (
              <span
                className="mt-1 block text-xs"
                style={{ color: "var(--critico)" }}
              >
                Precisa estar entre 0 e 100.
              </span>
            )}
          </label>
        </div>

        <p
          className="mt-5 text-xs leading-relaxed"
          style={{ color: "var(--tinta-muda)" }}
        >
          Amostras, loss e acurácia são <strong>auto-declarados</strong>: o
          programa os armazena como você os informa e não tem como verificá-los.
          Quem confere é a autoridade, ao pontuar a contribuição — e é a
          reputação que paga por uma declaração falsa.
        </p>

        <div className="mt-7 flex flex-wrap items-center justify-end gap-3">
          <Link href="/painel" className="btn-fantasma px-5 py-3 text-sm">
            Cancelar
          </Link>
          <button
            type="submit"
            disabled={!podeEnviar}
            className="btn-neon px-6 py-3 text-sm"
          >
            {ocupado === "submeter" ? "Assinando…" : "Assinar e enviar"}
          </button>
        </div>
      </form>
    </>
  );
}

function Bloqueio({
  titulo,
  critico = false,
  children,
}: {
  titulo: string;
  critico?: boolean;
  children: React.ReactNode;
}) {
  const cor = critico ? "var(--critico)" : "var(--aviso)";
  return (
    <div
      className="mb-6 rounded border p-5"
      style={{
        borderColor: cor,
        background: critico ? "var(--critico-lavado)" : "var(--superficie)",
      }}
    >
      <h2 className="text-base font-semibold" style={{ color: cor }}>
        {titulo}
      </h2>
      <p
        className="mt-2 text-sm leading-relaxed"
        style={{ color: "var(--tinta-2)" }}
      >
        {children}
      </p>
    </div>
  );
}
