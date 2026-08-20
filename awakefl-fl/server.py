"""Servidor de agregacao do AwakeFL: FedAvg + score de consistencia S(t).

Dois backends, mesma logica de agregacao:

1. **Motor local** (`run_federated`) - padrao. Executa as rodadas sequencialmente
   no processo atual. Sem Ray, sem rede, totalmente deterministico. E o backend
   usado pelo `run_experiments.py` porque reprodutibilidade vale mais do que
   paralelismo num experimento de iniciacao cientifica.

2. **Flower** (`run_flower_simulation`) - opcional (`--backend flower`). Usa
   `flwr.simulation.start_simulation` com a estrategia `AwakeFLStrategy`, que
   herda de `FedAvg` e injeta o modulo de reputacao no `aggregate_fit`. Serve
   para mostrar que a defesa e um plug-in de estrategia Flower de verdade, e nao
   um simulador caseiro. Requer `pip install "flwr[simulation]"` (traz o Ray).

Ordem das operacoes dentro de uma rodada (importa!):

    treino local -> deltas -> S(t) -> R(t) -> banimento -> agregacao

O banimento acontece ANTES da agregacao: o update que derrubou a reputacao do
participante abaixo do limiar ja nao entra no modelo global daquela rodada.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
import torch

from attacks import AttackConfig, build_backdoor_testset
from client import AwakeFLClient
from data import make_loader
from model import create_model, get_weights, set_weights, test
from onchain_interface import SimulatedOnChainLedger
from reputation import ReputationLedger
from utils import Weights, flatten, subtract, weighted_average

logger = logging.getLogger("awakefl.server")


@dataclass
class RoundLog:
    """Tudo o que aconteceu em uma rodada (linha do relatorio)."""

    round_number: int
    accuracy: float
    loss: float
    backdoor_asr: Optional[float] = None
    scores: Dict[int, float] = field(default_factory=dict)
    reputations: Dict[int, float] = field(default_factory=dict)
    newly_banned: List[int] = field(default_factory=list)
    participants: List[int] = field(default_factory=list)
    duration_s: float = 0.0


@dataclass
class History:
    """Historico completo de um cenario."""

    scenario: str
    rounds: List[RoundLog] = field(default_factory=list)
    malicious_ids: List[int] = field(default_factory=list)
    defense_enabled: bool = False
    attack_type: str = "none"
    final_weights: Optional[Weights] = None
    ledger: Optional[ReputationLedger] = None
    chain: Optional[SimulatedOnChainLedger] = None

    # -- series prontas para o Matplotlib --------------------------------
    @property
    def accuracies(self) -> List[float]:
        return [r.accuracy for r in self.rounds]

    @property
    def losses(self) -> List[float]:
        return [r.loss for r in self.rounds]

    @property
    def final_accuracy(self) -> float:
        return self.rounds[-1].accuracy if self.rounds else 0.0

    @property
    def best_accuracy(self) -> float:
        return max(self.accuracies) if self.rounds else 0.0

    def reputation_series(self) -> Dict[int, List[float]]:
        """Serie temporal de reputacao por participante (inclui o valor inicial)."""
        return {cid: list(s.history) for cid, s in (self.ledger.states.items() if self.ledger else [])}

    def ban_events(self) -> Dict[int, int]:
        return {
            cid: r.round_number for r in self.rounds for cid in r.newly_banned
        }

    def to_dict(self) -> dict:
        return {
            "scenario": self.scenario,
            "attack_type": self.attack_type,
            "defense_enabled": self.defense_enabled,
            "malicious_ids": self.malicious_ids,
            "final_accuracy": round(self.final_accuracy, 4),
            "best_accuracy": round(self.best_accuracy, 4),
            "accuracy_per_round": [round(a, 4) for a in self.accuracies],
            "loss_per_round": [round(l, 4) for l in self.losses],
            "backdoor_asr_per_round": [
                None if r.backdoor_asr is None else round(r.backdoor_asr, 4) for r in self.rounds
            ],
            "ban_events": self.ban_events(),
            "reputation_final": (
                {str(k): round(v, 4) for k, v in self.ledger.snapshot().items()} if self.ledger else {}
            ),
        }


# ---------------------------------------------------------------------------
# Motor local (backend padrao)
# ---------------------------------------------------------------------------


def run_federated(
    clients: Dict[int, AwakeFLClient],
    test_x: torch.Tensor,
    test_y: torch.Tensor,
    *,
    scenario: str,
    rounds: int = 10,
    fraction_fit: float = 1.0,
    defense_enabled: bool = False,
    reputation_cfg: Optional[dict] = None,
    attack: Optional[AttackConfig] = None,
    malicious_ids: Optional[Sequence[int]] = None,
    num_classes: int = 10,
    batch_size: int = 128,
    device: str = "cpu",
    seed: int = 42,
    export_dir: Optional[str] = None,
    export_rounds: Optional[Sequence[int]] = None,
    chain: Optional[object] = None,
) -> History:
    """Executa o loop federado completo e devolve o historico do cenario.

    `defense_enabled=False` (cenarios A e B) ainda calcula S(t) e R(t) - so nao
    bane nem repondera a agregacao. Isso e proposital: o relatorio consegue
    mostrar que o sinal de anomalia ja estava la no cenario B, e que a unica
    diferenca do C e agir sobre ele.
    """
    reputation_cfg = dict(reputation_cfg or {})
    malicious_ids = sorted(set(malicious_ids or []))
    attack = attack or AttackConfig()
    rng = np.random.default_rng(seed)

    ledger = ReputationLedger(
        num_participants=len(clients),
        initial=reputation_cfg.get("initial", 0.5),
        alpha=reputation_cfg.get("alpha", 0.5),
        ban_threshold=reputation_cfg.get("ban_threshold", 0.4),
        ban_penalty_divisor=reputation_cfg.get("ban_penalty_divisor", 10.0),
        grace_rounds=reputation_cfg.get("grace_rounds", 2),
        weight_direction=reputation_cfg.get("weight_direction", 0.7),
        weight_magnitude=reputation_cfg.get("weight_magnitude", 0.3),
        norm_veto_ratio=reputation_cfg.get("norm_veto_ratio", 2.5),
        enabled=defense_enabled,
    )
    # `chain` injetavel: o AnchorLedger tem a mesma interface e entra aqui
    # sem o loop federado saber a diferenca.
    chain = chain or SimulatedOnChainLedger(export_dir=export_dir, export_rounds=export_rounds)
    history = History(
        scenario=scenario,
        malicious_ids=malicious_ids,
        defense_enabled=defense_enabled,
        attack_type=attack.type,
        ledger=ledger,
        chain=chain,
    )

    # Modelo global: inicializado uma vez, a mesma semente para os 3 cenarios.
    torch.manual_seed(seed)
    global_model = create_model(num_classes=num_classes, device=device)
    global_weights: Weights = [np.asarray(w, dtype=np.float64) for w in get_weights(global_model)]

    test_loader = make_loader(test_x, test_y, batch_size, shuffle=False, seed=seed)
    backdoor_loader = None
    if attack.type == "backdoor":
        bx, by = build_backdoor_testset(test_x, test_y, attack.backdoor_target)
        backdoor_loader = make_loader(bx, by, batch_size, shuffle=False, seed=seed)

    logger.info(
        "=== Cenario %s | rodadas=%d | clientes=%d | ataque=%s | maliciosos=%s | defesa=%s ===",
        scenario,
        rounds,
        len(clients),
        attack.type,
        malicious_ids or "nenhum",
        "ON" if defense_enabled else "OFF",
    )

    for round_number in range(1, rounds + 1):
        t0 = time.time()

        # 1) Amostragem dos participantes desta rodada (banidos ficam de fora).
        available = [cid for cid in sorted(clients) if not ledger.is_banned(cid)]
        if not available:
            logger.error("Rodada %d: nenhum participante disponivel. Encerrando.", round_number)
            break
        k = max(1, int(round(fraction_fit * len(available))))
        selected = sorted(rng.choice(available, size=min(k, len(available)), replace=False).tolist())

        # 2) Treino local.
        submitted: Dict[int, Weights] = {}
        num_examples: Dict[int, int] = {}
        declared: Dict[int, Dict[str, float]] = {}
        for cid in selected:
            weights, n, metrics = clients[cid].fit(global_weights, {"round": round_number})
            submitted[cid] = [np.asarray(w, dtype=np.float64) for w in weights]
            num_examples[cid] = n
            declared[cid] = metrics

        # 3) Deltas (w_local - w_global) achatados: e sobre eles que a reputacao decide.
        deltas = {cid: flatten(subtract(w, global_weights)) for cid, w in submitted.items()}

        # 4) S(t) -> R(t) -> banimento.
        outcome = ledger.process_round(round_number, deltas)

        # 5) Registro no livro-razao (hash dos pesos + metricas declaradas + score).
        for cid in selected:
            chain.register_contribution(
                round_number=round_number,
                participant_id=cid,
                weights=submitted[cid],
                num_examples=num_examples[cid],
                metrics=declared[cid],
                score=outcome.scores.get(cid),
                reputation=ledger.reputation_of(cid),
                banned=ledger.is_banned(cid),
            )
        for cid in outcome.newly_banned:
            chain.register_ban(round_number, cid, ledger.reputation_of(cid))

        # 6) Agregacao (FedAvg, ponderado por reputacao quando a defesa esta ativa).
        agg_weights = ledger.aggregation_weights(
            num_examples, use_reputation=reputation_cfg.get("weighted_aggregation", True)
        )
        # Sanidade numerica (vale nos TRES cenarios, inclusive sem defesa): um
        # update com NaN/inf nao e "suspeito", e malformado - agregá-lo destroi o
        # modelo global de forma irrecuperavel e todas as metricas viram NaN.
        # Descartar isso nao e a defesa reputacional, e validacao de entrada; o
        # cenario B continua sofrendo integralmente o ataque *valido*.
        for cid, w in submitted.items():
            if not all(np.all(np.isfinite(t)) for t in w):
                logger.error(
                    "Rodada %d: update do participante %d contem NaN/inf e foi descartado.",
                    round_number,
                    cid,
                )
                agg_weights[cid] = 0.0
        try:
            global_weights = weighted_average(submitted, agg_weights)
        except ValueError:
            logger.error("Rodada %d: agregacao vazia; mantendo o modelo anterior.", round_number)

        # 7) Avaliacao do modelo global no conjunto de teste do servidor.
        set_weights(global_model, global_weights)
        loss, accuracy = test(global_model, test_loader, device=device)
        asr = None
        if backdoor_loader is not None:
            _, asr = test(global_model, backdoor_loader, device=device)

        log = RoundLog(
            round_number=round_number,
            accuracy=accuracy,
            loss=loss,
            backdoor_asr=asr,
            scores=dict(outcome.scores),
            reputations=dict(outcome.reputations),
            newly_banned=list(outcome.newly_banned),
            participants=selected,
            duration_s=time.time() - t0,
        )
        history.rounds.append(log)
        _log_round(log, ledger, malicious_ids)

    history.final_weights = global_weights
    return history


def _log_round(log: RoundLog, ledger: ReputationLedger, malicious_ids: Sequence[int]) -> None:
    """Log legivel por rodada: acuracia, perda, reputacoes e banimentos."""
    marks = []
    for cid in sorted(log.reputations):
        tag = "M" if cid in malicious_ids else "H"  # Malicioso / Honesto
        rep = log.reputations[cid]
        score = log.scores.get(cid)
        flag = " [BANIDO]" if ledger.is_banned(cid) else ""
        marks.append(
            f"{cid}{tag}:R={rep:.3f}" + (f",S={score:.3f}" if score is not None else ",S=-") + flag
        )

    asr = f" | ASR={log.backdoor_asr:.2%}" if log.backdoor_asr is not None else ""
    logger.info(
        "Rodada %02d | acc=%.2f%% | loss=%.4f%s | %.1fs",
        log.round_number,
        log.accuracy * 100,
        log.loss,
        asr,
        log.duration_s,
    )
    logger.info("           reputacoes: %s", " ".join(marks))
    if log.newly_banned:
        logger.warning("           >>> BANIDOS nesta rodada: %s", log.newly_banned)


# ---------------------------------------------------------------------------
# Backend Flower (opcional)
# ---------------------------------------------------------------------------

try:
    import flwr as fl
    from flwr.common import FitRes, Parameters, ndarrays_to_parameters, parameters_to_ndarrays
    from flwr.server.client_proxy import ClientProxy
    from flwr.server.strategy import FedAvg

    FLOWER_AVAILABLE = True
except ImportError:  # pragma: no cover
    FLOWER_AVAILABLE = False
    FedAvg = object  # type: ignore[assignment,misc]


if FLOWER_AVAILABLE:

    class AwakeFLStrategy(FedAvg):  # type: ignore[misc]
        """Estrategia Flower = FedAvg + reputacao AwakeFL.

        Sobrescrevemos apenas `aggregate_fit`, que e o ponto onde o servidor tem
        acesso simultaneo aos updates de todos os clientes - exatamente o que o
        score de consistencia precisa. O resto (configuracao de rodada,
        amostragem de clientes, avaliacao) fica com o FedAvg da casa.
        """

        def __init__(
            self,
            *,
            reputation_ledger: ReputationLedger,
            chain: Optional[SimulatedOnChainLedger] = None,
            use_reputation_weights: bool = True,
            **kwargs,
        ) -> None:
            super().__init__(**kwargs)
            self.ledger = reputation_ledger
            self.chain = chain or SimulatedOnChainLedger(
                export_dir=export_dir, export_rounds=export_rounds
            )
            self.use_reputation_weights = use_reputation_weights
            self.round_logs: List[RoundLog] = []
            self._global: Optional[List[np.ndarray]] = None

        def aggregate_fit(
            self,
            server_round: int,
            results: List[Tuple["ClientProxy", "FitRes"]],
            failures: List,
        ) -> Tuple[Optional["Parameters"], Dict[str, float]]:
            if not results:
                return None, {}

            submitted: Dict[int, List[np.ndarray]] = {}
            num_examples: Dict[int, int] = {}
            declared: Dict[int, Dict[str, float]] = {}
            for _, fit_res in results:
                cid = int(fit_res.metrics.get("client_id", -1))
                submitted[cid] = [
                    np.asarray(w, dtype=np.float64)
                    for w in parameters_to_ndarrays(fit_res.parameters)
                ]
                num_examples[cid] = fit_res.num_examples
                declared[cid] = {k: float(v) for k, v in fit_res.metrics.items()}

            reference = self._global or next(iter(submitted.values()))
            deltas = {cid: flatten(subtract(w, reference)) for cid, w in submitted.items()}
            outcome = self.ledger.process_round(server_round, deltas)

            for cid in submitted:
                self.chain.register_contribution(
                    server_round,
                    cid,
                    submitted[cid],
                    num_examples[cid],
                    declared[cid],
                    outcome.scores.get(cid),
                    self.ledger.reputation_of(cid),
                    self.ledger.is_banned(cid),
                )
            for cid in outcome.newly_banned:
                self.chain.register_ban(server_round, cid, self.ledger.reputation_of(cid))

            weights = self.ledger.aggregation_weights(
                num_examples, use_reputation=self.use_reputation_weights
            )
            aggregated = weighted_average(submitted, weights)
            self._global = aggregated

            self.round_logs.append(
                RoundLog(
                    round_number=server_round,
                    accuracy=0.0,  # a avaliacao central e feita pelo evaluate_fn do Flower
                    loss=0.0,
                    scores=dict(outcome.scores),
                    reputations=dict(outcome.reputations),
                    newly_banned=list(outcome.newly_banned),
                    participants=sorted(submitted),
                )
            )
            return ndarrays_to_parameters(
                [w.astype(np.float32) for w in aggregated]
            ), {"banned": float(len(self.ledger.banned_ids))}


def run_flower_simulation(
    clients: Dict[int, AwakeFLClient],
    test_x: torch.Tensor,
    test_y: torch.Tensor,
    *,
    scenario: str,
    rounds: int = 10,
    fraction_fit: float = 1.0,
    defense_enabled: bool = False,
    reputation_cfg: Optional[dict] = None,
    attack: Optional[AttackConfig] = None,
    malicious_ids: Optional[Sequence[int]] = None,
    num_classes: int = 10,
    batch_size: int = 128,
    device: str = "cpu",
    seed: int = 42,
    export_dir: Optional[str] = None,
    export_rounds: Optional[Sequence[int]] = None,
    chain: Optional[object] = None,
) -> History:
    """Mesmo experimento, executado por `flwr.simulation.start_simulation`.

    Requer `pip install "flwr[simulation]"` (Ray). Mantido como caminho
    alternativo: os numeros podem diferir levemente do motor local porque o Ray
    nao garante a ordem de execucao dos clientes.
    """
    if not FLOWER_AVAILABLE:
        raise RuntimeError("Flower nao instalado. Rode: pip install flwr")

    reputation_cfg = dict(reputation_cfg or {})
    attack = attack or AttackConfig()
    ledger = ReputationLedger(
        num_participants=len(clients),
        initial=reputation_cfg.get("initial", 0.5),
        alpha=reputation_cfg.get("alpha", 0.5),
        ban_threshold=reputation_cfg.get("ban_threshold", 0.4),
        ban_penalty_divisor=reputation_cfg.get("ban_penalty_divisor", 10.0),
        grace_rounds=reputation_cfg.get("grace_rounds", 2),
        weight_direction=reputation_cfg.get("weight_direction", 0.7),
        weight_magnitude=reputation_cfg.get("weight_magnitude", 0.3),
        norm_veto_ratio=reputation_cfg.get("norm_veto_ratio", 2.5),
        enabled=defense_enabled,
    )

    torch.manual_seed(seed)
    global_model = create_model(num_classes=num_classes, device=device)
    test_loader = make_loader(test_x, test_y, batch_size, shuffle=False, seed=seed)
    accuracies: List[Tuple[int, float, float]] = []

    def evaluate_fn(server_round: int, parameters, config):
        set_weights(global_model, parameters)
        loss, acc = test(global_model, test_loader, device=device)
        accuracies.append((server_round, acc, loss))
        logger.info("Rodada %02d | acc=%.2f%% | loss=%.4f", server_round, acc * 100, loss)
        return loss, {"accuracy": acc}

    strategy = AwakeFLStrategy(
        reputation_ledger=ledger,
        chain=chain,  # None => a estrategia cria o ledger simulado
        use_reputation_weights=reputation_cfg.get("weighted_aggregation", True),
        fraction_fit=fraction_fit,
        fraction_evaluate=0.0,
        min_fit_clients=max(2, int(fraction_fit * len(clients))),
        min_available_clients=len(clients),
        initial_parameters=ndarrays_to_parameters(get_weights(global_model)),
        on_fit_config_fn=lambda rnd: {"round": rnd},
        evaluate_fn=evaluate_fn,
    )

    fl.simulation.start_simulation(
        client_fn=lambda cid: clients[int(cid)].to_client(),
        num_clients=len(clients),
        config=fl.server.ServerConfig(num_rounds=rounds),
        strategy=strategy,
        client_resources={"num_cpus": 1},
    )

    history = History(
        scenario=scenario,
        malicious_ids=sorted(set(malicious_ids or [])),
        defense_enabled=defense_enabled,
        attack_type=attack.type,
        ledger=ledger,
        chain=strategy.chain,
    )
    by_round = {r: (acc, loss) for r, acc, loss in accuracies}
    for log in strategy.round_logs:
        log.accuracy, log.loss = by_round.get(log.round_number, (0.0, 0.0))
        history.rounds.append(log)
    return history
