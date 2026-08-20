"""Modelo global do AwakeFL: CNN pequena para MNIST / Fashion-MNIST.

Decisao de projeto: a arquitetura e deliberadamente pequena (~200k parametros).
Em Federated Learning o custo dominante e a *comunicacao* dos pesos a cada
rodada; alem disso o objetivo desta etapa e provar a logica de reputacao, nao
maximizar acuracia. Uma CNN de 2 blocos convolucionais ja passa de 98% no MNIST
centralizado, o que da margem suficiente para o ataque produzir uma degradacao
visivel no cenario B.
"""

from __future__ import annotations

from collections import OrderedDict
from typing import Optional, Sequence, Tuple

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader

from utils import Weights


class MnistCNN(nn.Module):
    """CNN com 2 camadas convolucionais + 2 fully connected.

    Fluxo: 1x28x28 -> conv(16) -> pool -> conv(32) -> pool -> 32*7*7 -> 128 -> 10
    """

    def __init__(self, num_classes: int = 10) -> None:
        super().__init__()
        # padding=2 com kernel 5 mantem a resolucao; o downsample fica so no pool,
        # o que torna o calculo do tamanho da flatten trivial de acompanhar.
        self.conv1 = nn.Conv2d(1, 16, kernel_size=5, padding=2)
        self.conv2 = nn.Conv2d(16, 32, kernel_size=5, padding=2)
        self.pool = nn.MaxPool2d(2, 2)
        self.fc1 = nn.Linear(32 * 7 * 7, 128)
        self.fc2 = nn.Linear(128, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.pool(F.relu(self.conv1(x)))  # -> 16x14x14
        x = self.pool(F.relu(self.conv2(x)))  # -> 32x7x7
        x = torch.flatten(x, 1)
        x = F.relu(self.fc1(x))
        return self.fc2(x)  # logits (a loss usada e CrossEntropy)


def create_model(num_classes: int = 10, device: str = "cpu") -> MnistCNN:
    """Instancia o modelo ja no device correto."""
    return MnistCNN(num_classes=num_classes).to(device)


def get_weights(model: nn.Module) -> Weights:
    """Extrai os pesos como lista de arrays NumPy (formato de transporte do Flower).

    Usamos `state_dict()` e nao `parameters()` de proposito: assim buffers
    (ex.: estatisticas de BatchNorm, caso a arquitetura evolua) tambem viajam
    para o servidor e entram no hash SHA-256 registrado on-chain.
    """
    return [value.detach().cpu().numpy() for value in model.state_dict().values()]


def set_weights(model: nn.Module, weights: Sequence[np.ndarray]) -> None:
    """Carrega no modelo pesos vindos do servidor (ordem = ordem do state_dict)."""
    keys = list(model.state_dict().keys())
    if len(keys) != len(weights):
        raise ValueError(
            f"Numero de tensores incompativel: modelo tem {len(keys)}, recebidos {len(weights)}."
        )
    state = OrderedDict(
        (k, torch.as_tensor(np.asarray(v), dtype=model.state_dict()[k].dtype))
        for k, v in zip(keys, weights)
    )
    model.load_state_dict(state, strict=True)


def train(
    model: nn.Module,
    loader: DataLoader,
    epochs: int,
    lr: float,
    momentum: float = 0.9,
    device: str = "cpu",
    steps: Optional[int] = None,
) -> float:
    """Treino local de um participante. Retorna a perda media da ultima passagem.

    SGD com momentum e o otimizador padrao do FedAvg (McMahan et al., 2017):
    otimizadores adaptativos como o Adam guardam estado que nao e compartilhado
    entre rodadas, o que introduz ruido extra na comparacao entre participantes.

    Dois regimes de trabalho local:

    * `steps=None` (padrao classico) - `epochs` passagens completas pelos dados
      locais. Quem tem mais dados da mais passos de SGD.
    * `steps=K` - exatamente K passos, ciclando o loader quantas vezes precisar.

    Por que o segundo existe: com epocas fixas, um participante de 436 amostras
    e batch 32 da ~14 passos enquanto um de 2.149 da ~67. O update do primeiro
    carrega ~2,2x mais ruido angular (o ruido cai com a raiz do numero de
    passos), e o detector de consistencia le esse ruido como divergencia - ou
    seja, pune o participante por ser pequeno. Fixar os passos iguala a
    condicao. A troca e ruido por vies: quem tem poucos dados repassa mais
    vezes por eles e sobreajusta um pouco mais.
    """
    model.train()
    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.SGD(model.parameters(), lr=lr, momentum=momentum)

    def um_passo(images, labels) -> Tuple[float, int]:
        images, labels = images.to(device), labels.to(device)
        optimizer.zero_grad()
        loss = criterion(model(images), labels)
        loss.backward()
        optimizer.step()
        return loss.item() * labels.size(0), labels.size(0)

    if steps:
        iterador = iter(loader)
        running, seen = 0.0, 0
        for _ in range(int(steps)):
            try:
                lote = next(iterador)
            except StopIteration:  # dados acabaram: recomeca a passagem
                iterador = iter(loader)
                lote = next(iterador)
            soma, n = um_passo(*lote)
            running += soma
            seen += n
        return running / max(seen, 1)

    last_loss = 0.0
    for _ in range(max(1, epochs)):
        running, seen = 0.0, 0
        for images, labels in loader:
            soma, n = um_passo(images, labels)
            running += soma
            seen += n
        last_loss = running / max(seen, 1)
    return last_loss


@torch.no_grad()
def test(model: nn.Module, loader: DataLoader, device: str = "cpu") -> Tuple[float, float]:
    """Avalia o modelo global. Retorna `(perda_media, acuracia)`."""
    model.eval()
    criterion = nn.CrossEntropyLoss(reduction="sum")
    total_loss, correct, total = 0.0, 0, 0
    for images, labels in loader:
        images, labels = images.to(device), labels.to(device)
        outputs = model(images)
        total_loss += criterion(outputs, labels).item()
        correct += (outputs.argmax(dim=1) == labels).sum().item()
        total += labels.size(0)
    if total == 0:
        return 0.0, 0.0
    return total_loss / total, correct / total


def count_parameters(model: nn.Module) -> int:
    """Numero de parametros treinaveis (aparece no log inicial, util no relatorio)."""
    return sum(p.numel() for p in model.parameters() if p.requires_grad)
