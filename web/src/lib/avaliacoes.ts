/**
 * Avaliações publicadas pelo agregador.
 *
 * Antes, a tela do validador tinha um campo onde a autoridade **digitava** o
 * score. Isso contradizia o desenho: se uma pessoa escolhe a nota no olho, a
 * reputação deixa de sair da matemática da contribuição. E uma nota digitada
 * não pode ser contestada — não há o que recalcular.
 *
 * Agora o agregador calcula, publica em `/avaliacoes.json`, e a tela apenas
 * mostra e assina. A chave é o **hash da contribuição**, que é o que está
 * gravado na conta on-chain: assim a página liga uma contribuição pendente à
 * sua avaliação sem depender de nenhum mapeamento de carteiras.
 *
 * Gere o arquivo com:
 *     python awakefl-fl/publicar_avaliacoes.py results_demo
 */

"use client";

import { useEffect, useState } from "react";

/** Como o score foi obtido — o que permite a um terceiro refazer a conta. */
export interface Justificativa {
  score: number;
  cosseno: number;
  cosseno_mediano: number;
  direcao: number;
  magnitude: number;
  norma: number;
  norma_mediana: number;
  razao_norma: number;
  veto_norma: boolean;
}

export interface Avaliacao {
  rodada: number;
  participante: number;
  /** O que a INSTITUIÇÃO afirmou. Preenche o formulário sem digitação manual. */
  declarado: { n_samples: number; loss: number; accuracy: number };
  /** O que o AGREGADOR calculou. A tela mostra, ninguém edita. */
  avaliacao: {
    score: number;
    aprovado: boolean;
    justificativa: Justificativa | null;
  };
}

interface Arquivo {
  gerado_em: string;
  programa: string;
  cenario: string;
  total: number;
  por_hash: Record<string, Avaliacao>;
}

export interface EstadoAvaliacoes {
  porHash: Record<string, Avaliacao>;
  geradoEm: string | null;
  carregando: boolean;
  /** `true` quando o arquivo não existe — o painel avisa em vez de quebrar. */
  ausente: boolean;
}

const VAZIO: EstadoAvaliacoes = {
  porHash: {},
  geradoEm: null,
  carregando: true,
  ausente: false,
};

export function useAvaliacoes(): EstadoAvaliacoes {
  const [estado, setEstado] = useState<EstadoAvaliacoes>(VAZIO);

  useEffect(() => {
    let vivo = true;

    // `cache: "no-store"` de propósito: o arquivo é regerado a cada execução do
    // experimento, e servir uma versão em cache faria a tela mostrar o score de
    // uma rodada anterior — silenciosamente, que é o pior tipo de erro aqui.
    fetch("/avaliacoes.json", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Arquivo>) : null))
      .then((dados) => {
        if (!vivo) return;
        setEstado(
          dados
            ? {
                porHash: dados.por_hash ?? {},
                geradoEm: dados.gerado_em ?? null,
                carregando: false,
                ausente: false,
              }
            : { porHash: {}, geradoEm: null, carregando: false, ausente: true },
        );
      })
      .catch(() => {
        if (vivo)
          setEstado({
            porHash: {},
            geradoEm: null,
            carregando: false,
            ausente: true,
          });
      });

    return () => {
      vivo = false;
    };
  }, []);

  return estado;
}

/** Texto curto explicando de onde veio o score. */
export function explicaScore(j: Justificativa | null): string {
  if (!j) return "sem justificativa publicada";
  if (j.veto_norma)
    return `veto de norma: update ${j.razao_norma.toFixed(2)}× a mediana do grupo — o crédito de direção foi zerado`;
  return (
    `direção ${(j.direcao * 100).toFixed(0)}% (cosseno ${j.cosseno.toFixed(3)} ` +
    `contra a mediana ${j.cosseno_mediano.toFixed(3)}) · ` +
    `magnitude ${(j.magnitude * 100).toFixed(0)}%`
  );
}
