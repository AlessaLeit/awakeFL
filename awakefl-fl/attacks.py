"""Ataques de participantes maliciosos em Federated Learning.

Taxonomia usada (segue a literatura de robust FL, ex.: Bagdasaryan et al. 2020,
Fang et al. 2020):

+-------------------+---------+------------------------------------------------+
| Ataque            | Camada  | O que faz                                       |
+-------------------+---------+------------------------------------------------+
| label_flipping    | dados   | troca os rotulos locais (y -> 9-y por padrao)   |
| backdoor          | dados   | estampa um gatilho e forca uma classe alvo,     |
|                   | + pesos | depois amplifica o update (model replacement)   |
| gradient_poisoning| pesos   | inverte e amplifica o update enviado            |
| free_rider        | pesos   | nao treina: devolve o modelo global (+ ruido)   |
+-------------------+---------+------------------------------------------------+

Ataques de *dados* sao sutis (o update continua "bem comportado" em norma), o que
os torna dificeis para defesas baseadas so em magnitude. Ataques de *pesos* sao
agressivos e o detector de consistencia pega rapido. Cobrimos os dois extremos de
proposito, para que a iniciacao cientifica possa discutir o trade-off.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Set

import numpy as np
import torch

from data import PIXEL_MAX
from utils import Weights, add, scale, subtract

logger = logging.getLogger("awakefl.attacks")

ATTACK_TYPES = ("none", "label_flipping", "gradient_poisoning", "backdoor", "free_rider")

# Ataques que operam sobre os *dados* locais antes do treino.
DATA_ATTACKS = ("label_flipping", "backdoor")
# Ataques que operam sobre os *pesos* devolvidos ao servidor.
WEIGHT_ATTACKS = ("gradient_poisoning", "free_rider", "backdoor")


@dataclass
class AttackConfig:
    """Parametrizacao do ataque (espelha o bloco `attack` do config.yaml)."""

    type: str = "none"
    malicious_fraction: float = 0.0
    malicious_ids: List[int] = field(default_factory=list)
    start_round: int = 1
    flip_map: Optional[Dict[int, int]] = None
    poison_scale: float = 5.0
    backdoor_target: int = 0
    backdoor_fraction: float = 0.5
    backdoor_scale: float = 3.0
    free_rider_noise: float = 1e-3

    @classmethod
    def from_dict(cls, raw: dict) -> "AttackConfig":
        known = {f for f in cls.__dataclass_fields__}  # type: ignore[attr-defined]
        cfg = cls(**{k: v for k, v in (raw or {}).items() if k in known and v is not None})
        if cfg.type not in ATTACK_TYPES:
            raise ValueError(f"Ataque desconhecido: {cfg.type!r}. Use um de {ATTACK_TYPES}.")
        if cfg.flip_map:
            cfg.flip_map = {int(k): int(v) for k, v in cfg.flip_map.items()}
        cfg.malicious_ids = [int(i) for i in (cfg.malicious_ids or [])]
        return cfg

    @property
    def is_active(self) -> bool:
        return self.type != "none"


def select_malicious(
    num_clients: int, cfg: AttackConfig, seed: int = 42
) -> Set[int]:
    """Decide quais participantes sao maliciosos.

    Regra (documentada no README): se `malicious_ids` estiver preenchido, ele
    manda - isso atende o requisito de "participante malicioso selecionavel por
    ID". Caso contrario sorteamos `malicious_fraction * N` participantes, de
    forma deterministica pela seed. O participante 0 e mantido honesto por
    convencao quando sorteamos, para servir de referencia nos logs.
    """
    if not cfg.is_active:
        return set()
    if cfg.malicious_ids:
        invalid = [i for i in cfg.malicious_ids if not 0 <= i < num_clients]
        if invalid:
            raise ValueError(f"IDs maliciosos fora do intervalo [0,{num_clients}): {invalid}")
        return set(cfg.malicious_ids)

    k = int(round(cfg.malicious_fraction * num_clients))
    if k <= 0:
        return set()
    rng = np.random.default_rng(seed)
    candidates = np.arange(1, num_clients)  # participante 0 = honesto de referencia
    k = min(k, len(candidates))
    return set(int(i) for i in rng.choice(candidates, size=k, replace=False))


# ---------------------------------------------------------------------------
# Ataques na camada de dados
# ---------------------------------------------------------------------------


def label_flipping(
    y: torch.Tensor, flip_map: Optional[Dict[int, int]] = None, num_classes: int = 10
) -> torch.Tensor:
    """Inverte os rotulos locais.

    Mapa padrao `y -> num_classes - 1 - y` (0<->9, 1<->8, ...): e uma permutacao
    sem ponto fixo, ou seja, *todas* as amostras ficam erradas. Isso maximiza o
    dano por participante, o que e o que queremos para evidenciar o cenario B.
    """
    y_new = y.clone()
    if flip_map:
        for src, dst in flip_map.items():
            y_new[y == src] = int(dst)
    else:
        y_new = (num_classes - 1) - y
    return y_new


def stamp_trigger(x: torch.Tensor, size: int = 3) -> torch.Tensor:
    """Estampa o gatilho do backdoor: quadrado branco `size x size` no canto inferior direito.

    Usamos PIXEL_MAX (valor de um pixel branco *ja normalizado*) para que o
    gatilho seja o padrao mais saliente possivel no espaco em que a CNN opera.
    """
    x_new = x.clone()
    x_new[..., -size:, -size:] = PIXEL_MAX
    return x_new


def backdoor_data(
    x: torch.Tensor,
    y: torch.Tensor,
    target: int = 0,
    fraction: float = 0.5,
    seed: int = 0,
    trigger_size: int = 3,
) -> tuple[torch.Tensor, torch.Tensor]:
    """Envenena uma fracao das amostras locais com (gatilho -> classe alvo).

    Mantemos `1 - fraction` das amostras limpas de proposito: o participante
    precisa continuar aprendendo a tarefa principal, senao a acuracia global cai
    e o ataque perde o disfarce. Backdoor bem feito e justamente aquele que nao
    degrada a metrica que o servidor observa.
    """
    rng = np.random.default_rng(seed)
    n = len(y)
    k = int(round(fraction * n))
    if k <= 0:
        return x, y
    idx = torch.from_numpy(rng.choice(n, size=k, replace=False))
    x_new, y_new = x.clone(), y.clone()
    x_new[idx] = stamp_trigger(x[idx], trigger_size)
    y_new[idx] = int(target)
    return x_new, y_new


def apply_data_attack(
    x: torch.Tensor, y: torch.Tensor, cfg: AttackConfig, seed: int = 0
) -> tuple[torch.Tensor, torch.Tensor]:
    """Aplica o ataque de dados correspondente (no-op se o ataque for de pesos)."""
    if cfg.type == "label_flipping":
        return x, label_flipping(y, cfg.flip_map)
    if cfg.type == "backdoor":
        return backdoor_data(x, y, cfg.backdoor_target, cfg.backdoor_fraction, seed)
    return x, y


# ---------------------------------------------------------------------------
# Ataques na camada de pesos
# ---------------------------------------------------------------------------


def gradient_poisoning(
    local: Sequence[np.ndarray], global_w: Sequence[np.ndarray], scale_factor: float = 5.0
) -> Weights:
    """Inverte e amplifica o update: w' = w_global - scale * (w_local - w_global).

    Equivale a "andar na direcao contraria ao gradiente honesto". Com scale > 1
    um unico atacante consegue puxar a media do FedAvg para longe do minimo -
    e o ataque mais destrutivo do conjunto, e tambem o mais facil de detectar,
    porque destroi simultaneamente a direcao e a norma do update.
    """
    delta = subtract(local, global_w)
    return add(global_w, scale(delta, -abs(scale_factor)))


def free_rider(
    global_w: Sequence[np.ndarray], noise_std: float = 1e-3, seed: int = 0
) -> Weights:
    """Devolve o modelo global com ruido gaussiano: o participante nao treina nada.

    Nao e "ataque" no sentido de sabotagem, e sim de *free-riding*: consome o
    modelo coletivo sem contribuir, e num sistema de reputacao com recompensa
    ainda receberia credito. O ruido serve para o update nao ser exatamente zero
    (o que seria trivialmente detectavel por uma checagem de igualdade de hash).
    """
    rng = np.random.default_rng(seed)
    return [
        np.asarray(w, dtype=np.float64) + rng.normal(0.0, noise_std, size=np.asarray(w).shape)
        for w in global_w
    ]


def scale_update(
    local: Sequence[np.ndarray], global_w: Sequence[np.ndarray], factor: float
) -> Weights:
    """Amplifica o update honesto (model replacement do backdoor)."""
    return add(global_w, scale(subtract(local, global_w), factor))


def apply_weight_attack(
    local: Sequence[np.ndarray],
    global_w: Sequence[np.ndarray],
    cfg: AttackConfig,
    seed: int = 0,
) -> Weights:
    """Aplica o ataque de pesos correspondente (no-op se o ataque for de dados)."""
    if cfg.type == "gradient_poisoning":
        return gradient_poisoning(local, global_w, cfg.poison_scale)
    if cfg.type == "free_rider":
        return free_rider(global_w, cfg.free_rider_noise, seed)
    # `!= 1.0` em ponto flutuante nao e confiavel: um fator vindo do YAML pode
    # chegar como 0.9999999999999999 e ligar o model replacement sem querer.
    # isclose responde a pergunta que interessa — "o fator e neutro?".
    if cfg.type == "backdoor" and not math.isclose(cfg.backdoor_scale, 1.0):
        return scale_update(local, global_w, cfg.backdoor_scale)
    return [np.asarray(w, dtype=np.float64) for w in local]


def build_backdoor_testset(
    x: torch.Tensor, y: torch.Tensor, target: int = 0, trigger_size: int = 3
) -> tuple[torch.Tensor, torch.Tensor]:
    """Conjunto de teste do backdoor: todas as amostras com gatilho, rotulo = alvo.

    A acuracia nesse conjunto e a *attack success rate* (ASR). Excluimos as
    amostras que ja pertencem a classe alvo, senao a ASR ficaria inflada por
    acertos que nao tem nada a ver com o gatilho.
    """
    mask = y != int(target)
    x_bd = stamp_trigger(x[mask], trigger_size)
    y_bd = torch.full((int(mask.sum()),), int(target), dtype=torch.long)
    return x_bd, y_bd
