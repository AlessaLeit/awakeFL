"""Modulo de reputacao off-chain do AwakeFL.

Este e o coracao do projeto: a logica que, depois de validada aqui, sera
espelhada no programa Anchor na Solana. Por isso ele e escrito de forma
deliberadamente *pura* - opera sobre vetores NumPy, nao conhece PyTorch nem
Flower, e nao tem estado global. Assim da para portar para Rust praticamente
linha a linha e testar com `pytest` isoladamente.

--------------------------------------------------------------------------
1. Escala da reputacao
--------------------------------------------------------------------------
R in [0, 1]:
    1.0 = participante plenamente confiavel
    0.5 = NEUTRO - valor inicial de todos
    0.0 = participante sem nenhuma credibilidade

Todo participante entra em R = 0.5 e precisa *ganhar* a confianca do grupo
contribuindo de forma consistente (na pratica sobe para ~0.93 em 4 rodadas).
Esse valor espelha `INITIAL_REPUTATION = 500` do programa Anchor, na escala
0..=1000; a conversao esta em `to_program_scale()` (e `to_basis_points()` da a
representacao interna de maior precisao).

Por que neutro e nao 1.0 (presuncao de boa-fe)? Porque `register_participant`
e aberto - qualquer wallet se registra pelo custo do rent de uma conta de 66
bytes. Se o recem-chegado nascesse com reputacao maxima, o banimento
permanente valeria zero: bastaria gerar outra wallet e voltar com a ficha
limpa (whitewashing). Comecar no meio faz a identidade acumulada valer alguma
coisa. O preco disso e o cold start, tratado pelo `grace_rounds` abaixo.

Achado experimental que motivou a escolha (ver README): o valor inicial NAO e
um parametro de deteccao. Reaplicando a EMA sobre os mesmos S(t) observados,
sair de R0 = 1.0 para R0 = 0.5 antecipou o banimento em 1 rodada em apenas 1
dos 3 atacantes - porque o peso de R0 cai para 3% em 5 rodadas e R(t) converge
para a media de S(t) independentemente de onde comecou. R0 e um parametro de
resistencia a whitewashing e de protecao ao recem-chegado, nao de deteccao.

--------------------------------------------------------------------------
2. Score de consistencia S(t)
--------------------------------------------------------------------------
S(t) in [0, 1] mede o quanto a contribuicao do participante na rodada t "combina"
com o consenso dos participantes ainda confiaveis. Combinamos dois sinais:

  a) DIRECAO - similaridade de cosseno entre o update do participante e um
     update de referencia. Escolhemos cosseno (e nao distancia euclidiana)
     porque ele e invariante a escala: em cenario nao-IID, um hospital com
     muitos dados produz um update naturalmente maior, e puni-lo por isso seria
     um falso positivo. O que interessa e "voce esta andando para o mesmo lado
     que o grupo?".

  b) MAGNITUDE - razao entre a norma do update e a norma mediana do grupo,
     dobrada em [0,1] por `min(r, 1/r)`. Esse termo e simetrico de proposito:
     pune tanto updates gigantes (gradient poisoning, model replacement do
     backdoor) quanto updates minusculos (free-rider, que praticamente nao
     treina). O cosseno sozinho nao pegaria o free-rider, porque a direcao do
     ruido dele e simplesmente aleatoria.

     S(t) = w_dir * clip(max(0,cos) / cos_mediano) + w_mag * min(r, 1/r)

  Os DOIS termos sao calibrados pela mediana da propria rodada. Isso e essencial:
  em dados IID os updates honestos tem cosseno ~0.9 entre si, em dados nao-IID
  esse valor cai para ~0.4 sem que ninguem seja malicioso. Um limiar absoluto ou
  banaria a federacao inteira no caso nao-IID, ou nao pegaria ninguem no caso
  IID. Calibrando, S(t) responde "quao pior que o participante mediano voce
  esta nesta rodada", que e a pergunta invariante ao regime de dados.

  A referencia e a MEDIANA POR COORDENADA dos updates confiaveis, nao a media.
  A mediana e um estimador robusto (breakdown point de 50%): com media, um unico
  atacante com update amplificado 100x deslocaria a propria referencia e passaria
  a ser "o consenso" - o classico ataque contra defesas ingenuas.

--------------------------------------------------------------------------
3. Atualizacao da reputacao
--------------------------------------------------------------------------
    R(t) = alpha * R(t-1) + (1 - alpha) * S(t),  com alpha = 0.5

E uma media movel exponencial. Com alpha = 0.5 o peso de uma rodada cai pela
metade a cada rodada seguinte: o sistema perdoa um azar pontual (rede ruim, batch
infeliz) mas condena comportamento sistematico em ~3-4 rodadas. Alpha maior =
mais memoria e mais lento para detectar; alpha menor = reativo demais e sujeito
a falso positivo.

--------------------------------------------------------------------------
4. Banimento
--------------------------------------------------------------------------
Se R(t) < limiar (default 0.4):
    R <- R / 10   (penalidade registrada on-chain, evidencia auditavel)
    banido <- True (PERMANENTE, sem reversao - decisao do projeto)
Banido nao entra mais na agregacao, nao entra no calculo da mediana de referencia
e nao volta a ser pontuado. A irreversibilidade e proposital: o livro-razao e
imutavel, e um atacante que pudesse "esperar esfriar" teria incentivo a atacar
de forma intermitente.

`grace_rounds` protege as primeiras contribuicoes de CADA participante - e nao
as primeiras rodadas da federacao. A diferenca importa: se a imunidade fosse
contada pelo numero global da rodada, um hospital que se registrasse na rodada
50 entraria sem protecao nenhuma, em R = 0.5, a um passo do limiar 0.4, num
momento em que ele e o unico carregando aquela distribuicao de dados. Contando
por tempo de casa (`contrib_count`, o mesmo campo que a conta PDA on-chain ja
mantem), a protecao acompanha o participante. Na simulacao, em que todos entram
na rodada 1, os dois criterios coincidem.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

logger = logging.getLogger("awakefl.reputation")

EPS = 1e-12


# ---------------------------------------------------------------------------
# Funcoes puras (portaveis para o Anchor)
# ---------------------------------------------------------------------------


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Similaridade de cosseno em [-1, 1]. Vetor nulo => 0.0 (sem informacao)."""
    na, nb = float(np.linalg.norm(a)), float(np.linalg.norm(b))
    if na < EPS or nb < EPS:
        return 0.0
    return float(np.clip(np.dot(a, b) / (na * nb), -1.0, 1.0))


def coordinate_median(updates: Sequence[np.ndarray]) -> np.ndarray:
    """Mediana por coordenada - estimador robusto do "update de consenso"."""
    if len(updates) == 0:
        raise ValueError("Nenhum update para calcular a mediana de referencia.")
    return np.median(np.vstack(updates), axis=0)


def magnitude_score(norm: float, reference_norm: float) -> float:
    """Coerencia de norma: `min(r, 1/r)` com r = norm / reference_norm, em [0, 1].

    Vale 1.0 quando a norma bate com a do grupo e decai simetricamente para
    updates grandes demais (envenenamento) ou pequenos demais (free-rider).
    """
    if reference_norm < EPS:
        # Grupo inteiro parado (modelo convergiu): so um update grande e suspeito.
        return 1.0 if norm < EPS else 0.0
    r = norm / reference_norm
    if r < EPS:
        return 0.0
    return float(np.clip(min(r, 1.0 / r), 0.0, 1.0))


def consistency_score(
    update: np.ndarray,
    reference: np.ndarray,
    reference_norm: float,
    weight_direction: float = 0.7,
    weight_magnitude: float = 0.3,
    reference_cosine: float = 1.0,
    norm_veto_ratio: float = 2.5,
) -> float:
    """Calcula S(t) para um participante. Ver docstring do modulo para a justificativa.

    `reference_cosine` e o cosseno TIPICO da rodada (mediana). Ele calibra o
    termo de direcao: em MNIST IID os updates honestos tem cosseno ~0.9 entre si,
    mas em cenario nao-IID esse valor cai naturalmente para ~0.4 sem que ninguem
    seja malicioso. Sem calibracao, o mesmo limiar absoluto ou banaria todo mundo
    no caso nao-IID, ou nao banaria ninguem no caso IID. Com calibracao, S mede
    "quao pior que o participante mediano voce esta", que e a pergunta certa.

    `norm_veto_ratio` implementa o **veto de norma**: se o update for mais de
    `ratio` vezes maior (ou menor) que a mediana da rodada, o participante perde
    todo o credito de direcao e S passa a ser apenas o termo de magnitude.
    Motivo: o ataque de *model replacement* (backdoor com `backdoor_scale`)
    envia um update na direcao certa, so que amplificado, justamente para
    sobreviver a defesas baseadas em cosseno. Como o FedAvg ja normaliza pela
    quantidade de amostras, nao existe justificativa legitima - nem sob dados
    heterogeneos - para um update 3x maior que o do grupo. O veto e a peca que
    fecha essa brecha sem endurecer o criterio para quem esta dentro da faixa.
    """
    if not np.all(np.isfinite(update)):
        # Update com NaN/inf: sem informacao utilizavel, credibilidade zero.
        return 0.0

    direction = max(0.0, cosine_similarity(update, reference))
    if reference_cosine > EPS:
        direction = direction / reference_cosine
    norm = float(np.linalg.norm(update))
    magnitude = magnitude_score(norm, reference_norm)

    ratio = norm / reference_norm if reference_norm > EPS else float("inf")
    if norm_veto_ratio > 1.0 and (ratio > norm_veto_ratio or ratio < 1.0 / norm_veto_ratio):
        return float(np.clip(magnitude, 0.0, 1.0))

    total = weight_direction + weight_magnitude
    if total <= 0:
        raise ValueError("weight_direction + weight_magnitude deve ser > 0.")
    score = (
        weight_direction * float(np.clip(direction, 0.0, 1.0)) + weight_magnitude * magnitude
    ) / total
    return float(np.clip(score, 0.0, 1.0))


def next_reputation(previous: float, score: float, alpha: float = 0.5) -> float:
    """R(t) = alpha * R(t-1) + (1 - alpha) * S(t), saturado em [0, 1].

    Score nao-finito (NaN/inf, tipico de um update que estourou numericamente)
    e tratado como 0.0: `np.clip(nan)` propaga NaN silenciosamente e contaminaria
    a reputacao para sempre.
    """
    if not 0.0 <= alpha <= 1.0:
        raise ValueError("alpha deve estar em [0, 1].")
    if not np.isfinite(score):
        score = 0.0
    if not np.isfinite(previous):
        previous = 0.0
    return float(np.clip(alpha * previous + (1.0 - alpha) * score, 0.0, 1.0))


def to_basis_points(reputation: float) -> int:
    """Converte R in [0,1] para ponto fixo (10_000 = 1.0).

    Solana/Anchor nao usa ponto flutuante em estado de conta (nao-determinismo
    entre validadores), entao tudo que atravessa a fronteira on-chain precisa
    virar inteiro. Esta e a representacao *interna* de maior precisao, usada no
    livro-razao e nos relatorios. Para o valor que realmente vai numa instrucao
    do programa, use `to_program_scale()`.
    """
    if not np.isfinite(reputation):
        return 0
    return int(round(float(np.clip(reputation, 0.0, 1.0)) * 10_000))


# Teto da escala de reputacao do programa Anchor (`MAX_REPUTATION` em state.rs).
# Mantido aqui para que a conversao quebre alto e claro se um dos lados mudar.
PROGRAM_MAX_REPUTATION = 1_000


def to_program_scale(reputation: float) -> int:
    """Converte R in [0,1] para a escala inteira 0..=1000 do programa Anchor.

    E este o valor aceito por `validate_contribution(score)` e armazenado em
    `Participant.reputation`. A conversao e simplesmente `R * 1000`, ou seja,
    um decimo do valor em basis points - a escala do programa e mais grosseira
    de proposito (cabe em u64 com folga e a EMA inteira `(R + S) / 2` perde no
    maximo 1 ponto por rodada).

    ATENCAO - divergencia em aberto: a *faixa* das duas escalas esta alinhada
    aqui, mas o *valor inicial* nao. Off-chain todo participante nasce com
    R = 1.0 (equivalente a 1000); o programa registra `INITIAL_REPUTATION = 500`.
    Enquanto essa decisao nao for tomada, um participante recem-registrado tem
    reputacao diferente conforme o lado que se olhe.
    """
    if not np.isfinite(reputation):
        return 0
    return int(round(float(np.clip(reputation, 0.0, 1.0)) * PROGRAM_MAX_REPUTATION))


# ---------------------------------------------------------------------------
# Estado e ledger
# ---------------------------------------------------------------------------


@dataclass
class ParticipantState:
    """Estado reputacional de um participante (espelha a conta PDA on-chain)."""

    participant_id: int
    reputation: float = 0.5
    banned: bool = False
    banned_round: Optional[int] = None
    scores: List[float] = field(default_factory=list)
    history: List[float] = field(default_factory=list)
    # Numero de contribuicoes pontuadas. Espelha `Participant.contrib_count` da
    # conta on-chain e serve de "tempo de casa" para o periodo de graca.
    contrib_count: int = 0

    def as_dict(self) -> dict:
        return {
            "participant_id": self.participant_id,
            "reputation": round(self.reputation, 6),
            "reputation_bps": to_basis_points(self.reputation),
            "reputation_onchain": to_program_scale(self.reputation),
            "contrib_count": self.contrib_count,
            "banned": self.banned,
            "banned_round": self.banned_round,
            "history": [round(v, 6) for v in self.history],
        }


@dataclass
class RoundOutcome:
    """Resultado da avaliacao de uma rodada (o que vira evento no livro-razao)."""

    round_number: int
    scores: Dict[int, float]
    reputations: Dict[int, float]
    newly_banned: List[int]
    reference_norm: float
    evaluated: List[int]


class ReputationLedger:
    """Mantem a reputacao de todos os participantes e aplica banimentos.

    Uso tipico por rodada::

        outcome = ledger.process_round(round_number, updates)   # updates: {cid: vetor 1-D}
        pesos   = ledger.aggregation_weights(num_amostras)
    """

    def __init__(
        self,
        num_participants: int,
        initial: float = 0.5,
        alpha: float = 0.5,
        ban_threshold: float = 0.4,
        ban_penalty_divisor: float = 10.0,
        grace_rounds: int = 2,
        weight_direction: float = 0.7,
        weight_magnitude: float = 0.3,
        norm_veto_ratio: float = 2.5,
        enabled: bool = True,
    ) -> None:
        self.num_participants = num_participants
        self.alpha = alpha
        self.ban_threshold = ban_threshold
        self.ban_penalty_divisor = ban_penalty_divisor
        self.grace_rounds = grace_rounds
        self.weight_direction = weight_direction
        self.weight_magnitude = weight_magnitude
        self.norm_veto_ratio = norm_veto_ratio
        # `enabled=False` = cenario B: ainda *medimos* score e reputacao (para o
        # relatorio poder mostrar que o sinal existia), mas nunca banimos ninguem.
        self.enabled = enabled
        self.states: Dict[int, ParticipantState] = {
            cid: ParticipantState(cid, reputation=initial, history=[initial])
            for cid in range(num_participants)
        }

    # -- consultas ---------------------------------------------------------

    @property
    def banned_ids(self) -> List[int]:
        return sorted(cid for cid, s in self.states.items() if s.banned)

    @property
    def trusted_ids(self) -> List[int]:
        return sorted(cid for cid, s in self.states.items() if not s.banned)

    def reputation_of(self, cid: int) -> float:
        return self.states[cid].reputation

    def is_banned(self, cid: int) -> bool:
        return self.states[cid].banned

    def snapshot(self) -> Dict[int, float]:
        return {cid: s.reputation for cid, s in self.states.items()}

    # -- nucleo ------------------------------------------------------------

    def compute_scores(self, updates: Dict[int, np.ndarray]) -> Tuple[Dict[int, float], float]:
        """Calcula S(t) de cada update submetido nesta rodada.

        Retorna `(scores, norma_de_referencia)`. Participantes ja banidos sao
        ignorados: nao pontuam e - crucialmente - nao entram na mediana, para
        que um banido nao consiga mais contaminar a referencia do consenso.
        """
        active = {cid: u for cid, u in updates.items() if not self.states[cid].banned}
        if not active:
            return {}, 0.0

        # Updates com NaN/inf sao separados ANTES de qualquer estatistica: um
        # unico NaN contamina mediana, normas e cossenos de todo mundo. Eles
        # recebem score 0 (ver `consistency_score`) e ficam de fora da referencia.
        finite = {cid: u for cid, u in active.items() if np.all(np.isfinite(u))}
        broken = sorted(set(active) - set(finite))
        if broken:
            logger.warning(
                "Updates nao-finitos (NaN/inf) descartados da referencia: participantes %s", broken
            )
        if not finite:
            return {cid: 0.0 for cid in active}, 0.0
        active = finite

        reference = coordinate_median(list(active.values()))
        # Norma de referencia = mediana das normas (nao a norma da mediana): a
        # mediana coordenada a coordenada tem norma menor que a tipica por
        # cancelamento, e isso penalizaria injustamente todo mundo.
        reference_norm = float(np.median([np.linalg.norm(u) for u in active.values()]))
        # Cosseno de referencia = mediana dos cossenos da rodada. E o "quanto de
        # divergencia e normal hoje", que muda com a heterogeneidade dos dados e
        # com o estagio da convergencia. Ver docstring de `consistency_score`.
        cosines = {cid: max(0.0, cosine_similarity(u, reference)) for cid, u in active.items()}
        reference_cosine = float(np.median(list(cosines.values()))) if cosines else 1.0

        scores = {
            cid: consistency_score(
                u,
                reference,
                reference_norm,
                self.weight_direction,
                self.weight_magnitude,
                reference_cosine,
                self.norm_veto_ratio,
            )
            for cid, u in active.items()
        }
        scores.update({cid: 0.0 for cid in broken})  # nao-finitos: credibilidade zero
        return scores, reference_norm

    def apply_scores(self, round_number: int, scores: Dict[int, float]) -> List[int]:
        """Atualiza R(t) e aplica banimentos. Retorna a lista de banidos *nesta* rodada."""
        newly_banned: List[int] = []
        for cid, score in scores.items():
            state = self.states[cid]
            if state.banned:  # banimento permanente: nada mais muda
                continue
            state.scores.append(score)
            state.contrib_count += 1
            state.reputation = next_reputation(state.reputation, score, self.alpha)

            # Graca por TEMPO DE CASA, nao por rodada global: as primeiras
            # `grace_rounds` contribuicoes de cada participante sao imunes ao
            # banimento. Protege tanto o inicio da federacao (modelo global
            # ainda aleatorio, todos parecem inconsistentes) quanto quem entra
            # no meio do caminho - que comeca em R = 0.5, perto do limiar, e
            # seria banido por duas rodadas de azar.
            in_grace = state.contrib_count <= self.grace_rounds
            if self.enabled and not in_grace and state.reputation < self.ban_threshold:
                state.reputation = state.reputation / self.ban_penalty_divisor
                state.banned = True
                state.banned_round = round_number
                newly_banned.append(cid)
                logger.warning(
                    "BANIMENTO | rodada %d | participante %d | R=%.4f (< %.2f) -> penalidade /%.0f",
                    round_number,
                    cid,
                    state.reputation * self.ban_penalty_divisor,
                    self.ban_threshold,
                    self.ban_penalty_divisor,
                )
            state.history.append(state.reputation)

        # Participantes que nao submeteram (ou ja banidos) repetem a reputacao,
        # para que todas as series historicas tenham o mesmo comprimento no grafico.
        for cid, state in self.states.items():
            if cid not in scores:
                state.history.append(state.reputation)

        return sorted(newly_banned)

    def process_round(self, round_number: int, updates: Dict[int, np.ndarray]) -> RoundOutcome:
        """Pipeline completo de uma rodada: score -> reputacao -> banimento."""
        scores, reference_norm = self.compute_scores(updates)
        newly_banned = self.apply_scores(round_number, scores)
        return RoundOutcome(
            round_number=round_number,
            scores=scores,
            reputations=self.snapshot(),
            newly_banned=newly_banned,
            reference_norm=reference_norm,
            evaluated=sorted(scores),
        )

    def aggregation_weights(
        self, num_examples: Dict[int, int], use_reputation: bool = True
    ) -> Dict[int, float]:
        """Pesos do FedAvg: `n_i` (padrao) ou `n_i * R_i` quando a defesa esta ativa.

        Banidos recebem peso 0 - saem da federacao. Se todo mundo for banido (nao
        deve acontecer, mas defendemos), voltamos ao peso puro por amostras para
        nao travar o treinamento.
        """
        weights: Dict[int, float] = {}
        for cid, n in num_examples.items():
            state = self.states[cid]
            if state.banned:
                weights[cid] = 0.0
            elif use_reputation and self.enabled:
                weights[cid] = float(n) * max(state.reputation, 0.0)
            else:
                weights[cid] = float(n)

        if sum(weights.values()) <= 0:
            logger.error("Todos os pesos zerados; revertendo para FedAvg simples.")
            return {cid: float(n) for cid, n in num_examples.items()}
        return weights

    # -- relatorio ---------------------------------------------------------

    def detection_metrics(self, malicious: Iterable[int]) -> Dict[str, float]:
        """Precisao/recall/F1 da deteccao, tratando "banido" como predicao positiva."""
        truth = set(malicious)
        predicted = set(self.banned_ids)
        tp = len(truth & predicted)
        fp = len(predicted - truth)
        fn = len(truth - predicted)
        precision = tp / (tp + fp) if (tp + fp) else (1.0 if not truth else 0.0)
        recall = tp / (tp + fn) if (tp + fn) else 1.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
        return {
            "true_positives": tp,
            "false_positives": fp,
            "false_negatives": fn,
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
        }

    def rounds_to_detect(self, malicious: Iterable[int]) -> Dict[int, Optional[int]]:
        """Rodada em que cada atacante foi banido (`None` = nunca detectado)."""
        return {cid: self.states[cid].banned_round for cid in sorted(malicious)}

    def as_dict(self) -> dict:
        return {str(cid): s.as_dict() for cid, s in self.states.items()}
