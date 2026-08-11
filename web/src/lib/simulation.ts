/**
 * Simulação determinística do ciclo de reputação do fl-reputation.
 *
 * Reproduz fielmente as regras do programa Anchor:
 *   - reputação inicial 500, escala 0..1000
 *   - EMA: R(t) = 0.5*R(t-1) + 0.5*S(t)  ->  floor((R + S) / 2)
 *   - penalidade: floor(R / 10) + banimento permanente
 *
 * Sem aleatoriedade: os scores são tabelados, então o gráfico e os números
 * são sempre os mesmos. Uma demo que muda a cada refresh não serve de demo.
 */

export type Perfil = "honesto" | "irregular" | "sleepy";

export interface Instituicao {
  id: string;
  nome: string;
  sigla: string;
  perfil: Perfil;
  /** Score atribuído pelo validador em cada rodada. */
  scores: number[];
}

export const TOTAL_RODADAS = 12;
export const REPUTACAO_INICIAL = 500;
export const RODADA_DO_ATAQUE = 8;
export const RODADA_DA_PENALIDADE = 10;

export const INSTITUICOES: Instituicao[] = [
  {
    id: "norte",
    nome: "Hospital Norte",
    sigla: "HN",
    perfil: "honesto",
    scores: [880, 910, 900, 930, 920, 905, 940, 915, 925, 930, 920, 935],
  },
  {
    id: "sul",
    nome: "Clínica Sul",
    sigla: "CS",
    perfil: "honesto",
    scores: [850, 870, 890, 860, 900, 880, 895, 905, 870, 890, 900, 885],
  },
  {
    id: "central",
    nome: "Laboratório Central",
    sigla: "LC",
    perfil: "honesto",
    scores: [820, 840, 860, 830, 850, 870, 845, 860, 855, 865, 870, 860],
  },
  {
    id: "leste",
    nome: "Posto Leste",
    sigla: "PL",
    perfil: "irregular",
    scores: [520, 480, 560, 500, 540, 470, 510, 530, 490, 520, 500, 515],
  },
  {
    id: "delta",
    nome: "Instituto Delta",
    sigla: "ID",
    perfil: "sleepy",
    // Oito rodadas impecáveis para ganhar peso; a partir da rodada 8, envenena.
    // Após a rodada 9 é detectado e penalizado, então não há score 10 e 11.
    scores: [900, 920, 930, 940, 925, 935, 945, 930, 120, 80],
  },
];

export type StatusContribuicao =
  | "Aprovado"
  | "Rejeitado"
  | "Pendente"
  | "Banido"
  | "Ausente";

export interface EstadoInstituicao {
  id: string;
  reputacao: number;
  banido: boolean;
  contribuicoes: number;
  ultimoScore: number | null;
  status: StatusContribuicao;
}

export type TipoEvento =
  | "registro"
  | "contribuicao"
  | "validacao"
  | "penalidade";

export interface Evento {
  rodada: number;
  tipo: TipoEvento;
  instituicaoId: string;
  texto: string;
  /** Pseudo-assinatura para dar textura de blockchain à trilha de auditoria. */
  assinatura: string;
}

export interface Rodada {
  numero: number;
  estados: EstadoInstituicao[];
  eventos: Evento[];
}

/** EMA do programa: R(t) = 0.5*R(t-1) + 0.5*S(t), em aritmética inteira. */
export function aplicarEma(reputacao: number, score: number): number {
  return Math.floor((reputacao + score) / 2);
}

/** Penalidade do programa: reputação / 10, truncada. */
export function aplicarPenalidade(reputacao: number): number {
  return Math.floor(reputacao / 10);
}

/**
 * Hash decorativo e determinístico — só para a trilha de auditoria parecer
 * o que é on-chain. NÃO é criptografia: não use isto para nada real.
 */
function assinatura(semente: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < semente.length; i++) {
    h ^= semente.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const base = h.toString(16).padStart(8, "0");
  return (base + base.split("").reverse().join("")).slice(0, 12);
}

/**
 * Roda a simulação inteira e devolve o estado após CADA rodada.
 * O índice do array é o número da rodada.
 */
export function simular(): Rodada[] {
  const estados = new Map<string, EstadoInstituicao>(
    INSTITUICOES.map((i) => [
      i.id,
      {
        id: i.id,
        reputacao: REPUTACAO_INICIAL,
        banido: false,
        contribuicoes: 0,
        ultimoScore: null,
        status: "Pendente" as StatusContribuicao,
      },
    ]),
  );

  const rodadas: Rodada[] = [];

  for (let r = 0; r < TOTAL_RODADAS; r++) {
    const eventos: Evento[] = [];

    for (const inst of INSTITUICOES) {
      const estado = estados.get(inst.id)!;

      if (estado.banido) {
        estado.status = "Banido";
        estado.ultimoScore = null;
        continue;
      }

      // Detecção do envenenamento: a autoridade penaliza em vez de validar.
      if (inst.perfil === "sleepy" && r === RODADA_DA_PENALIDADE) {
        const anterior = estado.reputacao;
        estado.reputacao = aplicarPenalidade(anterior);
        estado.banido = true;
        estado.status = "Banido";
        estado.ultimoScore = null;
        eventos.push({
          rodada: r,
          tipo: "penalidade",
          instituicaoId: inst.id,
          texto: `${inst.nome} penalizado por envenenamento: ${anterior} → ${estado.reputacao}, banimento permanente`,
          assinatura: assinatura(`pen-${inst.id}-${r}`),
        });
        continue;
      }

      const score = inst.scores[r];
      if (score === undefined) {
        estado.status = "Ausente";
        estado.ultimoScore = null;
        continue;
      }

      const anterior = estado.reputacao;
      estado.reputacao = aplicarEma(anterior, score);
      estado.contribuicoes += 1;
      estado.ultimoScore = score;
      estado.status = score >= 500 ? "Aprovado" : "Rejeitado";

      eventos.push({
        rodada: r,
        tipo: "contribuicao",
        instituicaoId: inst.id,
        texto: `${inst.nome} submeteu contribuição na rodada ${r}`,
        assinatura: assinatura(`sub-${inst.id}-${r}`),
      });
      eventos.push({
        rodada: r,
        tipo: "validacao",
        instituicaoId: inst.id,
        texto: `${inst.nome} validado com score ${score}: ${anterior} → ${estado.reputacao}`,
        assinatura: assinatura(`val-${inst.id}-${r}`),
      });
    }

    rodadas.push({
      numero: r,
      estados: Array.from(estados.values()).map((e) => ({ ...e })),
      eventos,
    });
  }

  return rodadas;
}

export const RODADAS = simular();

/** Série de reputação de uma instituição, da rodada 0 até `ate` (inclusive). */
export function serieDe(id: string, ate: number): number[] {
  const serie = [REPUTACAO_INICIAL];
  for (let r = 0; r <= ate; r++) {
    const estado = RODADAS[r].estados.find((e) => e.id === id)!;
    serie.push(estado.reputacao);
  }
  return serie;
}

export function instituicaoPorId(id: string): Instituicao {
  return INSTITUICOES.find((i) => i.id === id)!;
}

/** Pico histórico de reputação — usado para mostrar o quanto o sleepy perdeu. */
export function picoDe(id: string): number {
  return Math.max(...RODADAS.map((r) => r.estados.find((e) => e.id === id)!.reputacao));
}
