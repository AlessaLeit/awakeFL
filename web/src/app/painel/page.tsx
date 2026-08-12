"use client";

import Link from "next/link";
import Cabecalho from "@/components/painel/Cabecalho";
import StatTile from "@/components/StatTile";
import ProjecaoReputacao from "@/components/painel/ProjecaoReputacao";
import { IconeAtualizar } from "@/components/painel/Icones";
import { useAwakeFL } from "@/lib/anchor/estado";
import { encurta } from "@/lib/anchor/program";

export default function VisaoGeral() {
  const {
    config,
    meuParticipante,
    minhasContribuicoes,
    jaContribuiuNestaRodada,
    souAutoridade,
    participantes,
    carregando,
    carregar,
    registrar,
    ocupado,
  } = useAwakeFL();

  const pendentes = minhasContribuicoes.filter(
    (c) => c.status === "Pendente",
  ).length;
  const aprovadas = minhasContribuicoes.filter(
    (c) => c.status === "Aprovado",
  ).length;

  // Posição na tabela de reputação. Só faz sentido com o nó registrado.
  const posicao = meuParticipante
    ? participantes.findIndex((p) =>
        p.endereco.equals(meuParticipante.endereco),
      ) + 1
    : null;

  return (
    <>
      <Cabecalho
        titulo="Visão Geral"
        subtitulo="Monitoramento do seu nó de treinamento e da reputação on-chain."
        acao={
          <button
            onClick={() => void carregar()}
            disabled={carregando}
            className="btn-neon px-4 py-2.5 text-sm disabled:cursor-not-allowed"
          >
            <IconeAtualizar className="h-4 w-4" />
            {carregando ? "Sincronizando…" : "Sincronizar"}
          </button>
        }
      />

      {!config && <SemConfig />}

      {config && !meuParticipante && (
        <div className="vidro mb-6 p-6">
          <h2 className="text-lg font-semibold">
            Seu nó ainda não está registrado
          </h2>
          <p
            className="mt-2 max-w-2xl text-sm leading-relaxed"
            style={{ color: "var(--tinta-2)" }}
          >
            O registro cria a sua conta de participante on-chain (um PDA
            derivado da sua carteira) com reputação inicial <strong>500</strong>{" "}
            — o ponto neutro da escala. É uma transação só, e a partir dela você
            pode contribuir em cada rodada.
          </p>
          <button
            onClick={() => void registrar()}
            disabled={ocupado !== null}
            className="btn-neon mt-5 px-5 py-3 text-sm"
          >
            {ocupado === "registrar" ? "Assinando…" : "Registrar meu nó"}
          </button>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          rotulo="Status do nó"
          valor={
            !meuParticipante
              ? "Não registrado"
              : meuParticipante.isBanned
                ? "Banido"
                : "Ativo"
          }
          nota={
            meuParticipante
              ? `conta ${encurta(meuParticipante.endereco)}`
              : "registre para participar"
          }
          tom={
            !meuParticipante
              ? "neutro"
              : meuParticipante.isBanned
                ? "critico"
                : "neon"
          }
          icone="●"
        />
        <StatTile
          rotulo="Reputação"
          valor={meuParticipante ? meuParticipante.reputation : "—"}
          nota={
            posicao && participantes.length > 0
              ? `${posicao}º de ${participantes.length} na rede`
              : "escala 0–1000"
          }
          tom={meuParticipante?.isBanned ? "critico" : "neutro"}
          icone="◇"
        />
        <StatTile
          rotulo="Rodada atual"
          valor={config ? `#${config.currentRound}` : "—"}
          nota={
            jaContribuiuNestaRodada
              ? "você já contribuiu nesta rodada"
              : "contribuição em aberto"
          }
          icone="⟳"
        />
        <StatTile
          rotulo="Contribuições"
          valor={meuParticipante ? meuParticipante.contribCount : 0}
          nota={`${aprovadas} aprovadas · ${pendentes} pendentes`}
          icone="◧"
        />
      </div>

      {meuParticipante && !meuParticipante.isBanned && (
        <div className="mb-6">
          <BarraReputacao valor={meuParticipante.reputation} />
        </div>
      )}

      {meuParticipante?.isBanned && (
        <div
          className="mb-6 rounded border p-5"
          style={{
            borderColor: "var(--critico)",
            background: "var(--critico-lavado)",
          }}
        >
          <h2
            className="text-base font-semibold"
            style={{ color: "var(--critico)" }}
          >
            Nó banido permanentemente
          </h2>
          <p
            className="mt-2 text-sm leading-relaxed"
            style={{ color: "var(--tinta-2)" }}
          >
            A reputação foi dividida por 10 e a marca de banimento foi gravada
            na conta. O programa não expõe nenhuma instrução que reverta isto —
            nem para a autoridade. Novas contribuições falham com{" "}
            <code className="mono">ParticipantBanned</code>.
          </p>
        </div>
      )}

      {meuParticipante && !meuParticipante.isBanned && (
        <div className="mb-6">
          <ProjecaoReputacao atual={meuParticipante.reputation} />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Link
          href="/painel/contribuir"
          className="vidro block p-5 transition-colors hover:border-[var(--acento)]"
        >
          <div className="rotulo">Próximo passo</div>
          <div className="mt-2 text-lg font-semibold">
            {jaContribuiuNestaRodada
              ? "Aguardar a próxima rodada"
              : "Submeter a contribuição da rodada"}
          </div>
          <p className="mt-2 text-sm" style={{ color: "var(--tinta-2)" }}>
            {jaContribuiuNestaRodada
              ? "O PDA da contribuição é único por rodada. A autoridade precisa avançar a rodada antes da próxima submissão."
              : "Publique o hash da atualização de pesos e as métricas do treino local. Os dados não saem da sua instituição."}
          </p>
        </Link>

        <Link
          href={souAutoridade ? "/painel/validador" : "/painel/extrato"}
          className="vidro block p-5 transition-colors hover:border-[var(--acento)]"
        >
          <div className="rotulo">
            {souAutoridade ? "Você é a autoridade" : "Auditoria"}
          </div>
          <div className="mt-2 text-lg font-semibold">
            {souAutoridade
              ? "Validar a rodada corrente"
              : "Conferir seu extrato"}
          </div>
          <p className="mt-2 text-sm" style={{ color: "var(--tinta-2)" }}>
            {souAutoridade
              ? "Esta carteira é o agregador desta instância: pode pontuar contribuições, penalizar maliciosos e avançar a rodada."
              : "Toda transação que você assinou está no explorador da Solana, verificável por qualquer pessoa sem pedir acesso."}
          </p>
        </Link>
      </div>
    </>
  );
}

/** A escala 0–1000 como barra, com o ponto neutro marcado. */
function BarraReputacao({ valor }: { valor: number }) {
  const pct = Math.max(0, Math.min(100, (valor / 1000) * 100));
  return (
    <div className="vidro p-5">
      <div className="flex items-baseline justify-between">
        <span className="rotulo">Reputação na escala</span>
        <span className="tabular text-sm" style={{ color: "var(--tinta-2)" }}>
          {valor} / 1000
        </span>
      </div>
      <div
        className="relative mt-3 h-2 w-full overflow-hidden rounded-full"
        style={{ background: "var(--superficie-3)" }}
        role="img"
        aria-label={`Reputação ${valor} de 1000.`}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: "var(--acento)",
            boxShadow: "0 0 12px 1px var(--acento-brilho)",
          }}
        />
      </div>
      <div
        className="mono mt-2 flex justify-between text-[11px]"
        style={{ color: "var(--tinta-muda)" }}
      >
        <span>0</span>
        <span>500 · inicial</span>
        <span>1000</span>
      </div>
    </div>
  );
}

function SemConfig() {
  return (
    <div
      className="mb-6 rounded border p-5"
      style={{ borderColor: "var(--aviso)", background: "var(--superficie)" }}
    >
      <h2 className="text-base font-semibold">
        O sistema ainda não foi inicializado
      </h2>
      <p
        className="mt-2 text-sm leading-relaxed"
        style={{ color: "var(--tinta-2)" }}
      >
        A conta <code className="mono">Config</code> não existe nesta Devnet —
        sem ela não há rodada corrente nem autoridade, e nenhum registro de
        participante é possível. Quem assinar o{" "}
        <code className="mono">initialize</code> vira o agregador da instância;
        a ação está na tela do{" "}
        <Link
          href="/painel/validador"
          className="underline"
          style={{ color: "var(--acento)" }}
        >
          Validador
        </Link>
        .
      </p>
    </div>
  );
}
