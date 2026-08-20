"""Cliente Flower do AwakeFL: uma instituicao participante da federacao.

Ciclo de vida de uma rodada, do ponto de vista do cliente:

    servidor -> pesos globais -> [ataque nos dados?] -> treino local
             -> [ataque nos pesos?] -> pesos + metricas declaradas -> servidor

O cliente e o mesmo objeto nos dois backends do projeto:

* motor local (`server.run_federated`), que chama `fit()`/`evaluate()` direto;
* Flower (`server.run_flower_simulation`), que usa a interface `NumPyClient`.

Manter uma unica classe evita a armadilha classica de "o cliente do teste nao e
o cliente do experimento".

Nota de honestidade experimental: o cliente malicioso reporta metricas
*declaradas* (a perda que ele mediu nos proprios dados envenenados, ou uma copia
da anterior no caso do free-rider). O servidor nunca usa essas metricas para
decidir reputacao - elas so vao para o livro-razao como evidencia do que foi
declarado. Toda a avaliacao e feita sobre o update, que o cliente nao consegue
falsificar sem se afastar do consenso.
"""

from __future__ import annotations

import logging
from typing import Dict, List, Optional, Tuple

import numpy as np
import torch

from attacks import AttackConfig, apply_data_attack, apply_weight_attack
from data import Partition, make_loader
from model import create_model, get_weights, set_weights, test, train
from utils import Weights

logger = logging.getLogger("awakefl.client")

try:  # o Flower e opcional para os testes unitarios rodarem isolados
    from flwr.client import NumPyClient as _FlowerNumPyClient
except ImportError:  # pragma: no cover
    class _FlowerNumPyClient:  # type: ignore[no-redef]
        """Fallback quando o flwr nao esta instalado."""


class AwakeFLClient(_FlowerNumPyClient):
    """Participante da federacao (honesto ou malicioso)."""

    def __init__(
        self,
        client_id: int,
        partition: Partition,
        *,
        attack: Optional[AttackConfig] = None,
        malicious: bool = False,
        local_epochs: int = 1,
        local_steps: Optional[int] = None,
        batch_size: int = 32,
        learning_rate: float = 0.05,
        momentum: float = 0.9,
        num_classes: int = 10,
        device: str = "cpu",
        seed: int = 42,
    ) -> None:
        self.client_id = client_id
        self.partition = partition
        self.attack = attack or AttackConfig()
        self.malicious = bool(malicious and self.attack.is_active)
        self.local_epochs = local_epochs
        # Numero fixo de passos de SGD por rodada. Quando definido, substitui as
        # epocas: iguala o trabalho local entre participantes grandes e pequenos
        # e evita que o pequeno seja punido pelo ruido do proprio tamanho.
        self.local_steps = local_steps
        self.batch_size = batch_size
        self.learning_rate = learning_rate
        self.momentum = momentum
        self.device = device
        # Semente derivada do id: cada cliente embaralha os batches de forma
        # diferente (realista), mas de maneira reprodutivel.
        self.seed = seed * 1000 + client_id
        self.model = create_model(num_classes=num_classes, device=device)

        # Os dados envenenados sao preparados UMA vez e reaproveitados: um
        # atacante real nao re-sorteia o veneno a cada rodada, e assim o ataque
        # fica deterministico e o experimento reprodutivel.
        if self.malicious:
            self._x, self._y = apply_data_attack(
                partition.x, partition.y, self.attack, seed=self.seed
            )
        else:
            self._x, self._y = partition.x, partition.y

    # -- helpers -----------------------------------------------------------

    @property
    def num_examples(self) -> int:
        return len(self.partition)

    def _attack_active(self, round_number: int) -> bool:
        return self.malicious and round_number >= self.attack.start_round

    def _use_poisoned_data(self, round_number: int) -> Tuple[torch.Tensor, torch.Tensor]:
        if self.attack.type in ("label_flipping", "backdoor") and self._attack_active(round_number):
            return self._x, self._y
        return self.partition.x, self.partition.y

    # -- interface NumPyClient --------------------------------------------

    def get_parameters(self, config: Optional[dict] = None) -> Weights:  # noqa: D102
        return get_weights(self.model)

    def fit(
        self, parameters: List[np.ndarray], config: Optional[dict] = None
    ) -> Tuple[Weights, int, Dict[str, float]]:
        """Treina localmente e devolve `(pesos, n_amostras, metricas_declaradas)`."""
        config = config or {}
        round_number = int(config.get("round", 1))

        set_weights(self.model, parameters)
        global_weights = [np.asarray(p, dtype=np.float64) for p in parameters]

        # Free-rider tem um atalho: nao gasta computacao nenhuma.
        if self.attack.type == "free_rider" and self._attack_active(round_number):
            poisoned = apply_weight_attack(
                get_weights(self.model), global_weights, self.attack, seed=self.seed + round_number
            )
            logger.debug("Cliente %d (free-rider) devolveu o modelo global sem treinar.", self.client_id)
            return poisoned, self.num_examples, {
                # Metricas declaradas, falsas por construcao: o free-rider nao
                # treinou nada e mesmo assim reporta numeros plausiveis.
                "train_loss": 0.0,
                "train_accuracy": 1.0,
                "client_id": float(self.client_id),
                "attacked": 1.0,
            }

        x, y = self._use_poisoned_data(round_number)
        loader = make_loader(x, y, self.batch_size, shuffle=True, seed=self.seed + round_number)
        loss = train(
            self.model,
            loader,
            epochs=self.local_epochs,
            steps=self.local_steps,
            lr=self.learning_rate,
            momentum=self.momentum,
            device=self.device,
        )

        weights = get_weights(self.model)
        attacked = 0.0
        if self._attack_active(round_number):
            weights = apply_weight_attack(
                weights, global_weights, self.attack, seed=self.seed + round_number
            )
            attacked = 1.0

        # Acuracia DECLARADA: medida pelo participante nos dados em que ele
        # acabou de treinar - envenenados, se ele for malicioso. Nao e um
        # descuido, e o ponto: o atacante mede alto porque acerta os proprios
        # rotulos trocados, e declara isso de boa-fe aparente. E a evidencia
        # viva de que metrica auto-declarada nao serve para julgar ninguem, e de
        # que a reputacao precisa sair do update.
        loader_avaliacao = make_loader(x, y, self.batch_size, shuffle=False, seed=self.seed)
        _, acuracia = test(self.model, loader_avaliacao, device=self.device)

        return weights, self.num_examples, {
            "train_loss": float(loss),
            "train_accuracy": float(acuracia),
            "client_id": float(self.client_id),
            "attacked": attacked,
        }

    def evaluate(
        self, parameters: List[np.ndarray], config: Optional[dict] = None
    ) -> Tuple[float, int, Dict[str, float]]:
        """Avalia o modelo global nos dados LIMPOS do participante.

        Usamos os dados limpos (nao os envenenados) de proposito: essa metrica
        serve para diagnostico do experimento, e nao alimenta a reputacao.
        """
        set_weights(self.model, parameters)
        loader = make_loader(
            self.partition.x, self.partition.y, self.batch_size, shuffle=False, seed=self.seed
        )
        loss, accuracy = test(self.model, loader, device=self.device)
        return float(loss), self.num_examples, {"accuracy": float(accuracy)}


def build_clients(
    partitions: List[Partition],
    malicious_ids,
    attack: AttackConfig,
    *,
    local_epochs: int = 1,
    local_steps: Optional[int] = None,
    batch_size: int = 32,
    learning_rate: float = 0.05,
    momentum: float = 0.9,
    num_classes: int = 10,
    device: str = "cpu",
    seed: int = 42,
) -> Dict[int, AwakeFLClient]:
    """Instancia todos os participantes, marcando os IDs maliciosos."""
    malicious_ids = set(malicious_ids or [])
    clients: Dict[int, AwakeFLClient] = {}
    for part in partitions:
        clients[part.client_id] = AwakeFLClient(
            part.client_id,
            part,
            attack=attack,
            malicious=part.client_id in malicious_ids,
            local_epochs=local_epochs,
            local_steps=local_steps,
            batch_size=batch_size,
            learning_rate=learning_rate,
            momentum=momentum,
            num_classes=num_classes,
            device=device,
            seed=seed,
        )
    honest = sorted(set(clients) - malicious_ids)
    logger.info(
        "Participantes criados: %d honestos %s | %d maliciosos %s (ataque=%s)",
        len(honest),
        honest,
        len(malicious_ids),
        sorted(malicious_ids),
        attack.type,
    )
    return clients
