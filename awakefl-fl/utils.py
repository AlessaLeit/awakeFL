"""Utilidades compartilhadas do AwakeFL.

Concentra aqui tudo que e infraestrutura (semente, logging, conversao de pesos)
para que os modulos de dominio (model, data, attacks, reputation) fiquem limpos
e faceis de ler em uma iniciacao cientifica.
"""

from __future__ import annotations

import logging
import os
import random
from pathlib import Path
from typing import Dict, List, Sequence

import numpy as np

# Tipo canonico usado em todo o projeto para representar os pesos de um modelo:
# uma lista de arrays NumPy, na mesma ordem do `state_dict` do PyTorch.
# Escolhemos NumPy (e nao tensores) porque e exatamente o formato que o Flower
# transmite entre cliente e servidor, e tambem o que serializamos para o hash
# SHA-256 registrado on-chain.
Weights = List[np.ndarray]


def set_seed(seed: int) -> None:
    """Fixa a semente de todas as fontes de aleatoriedade do experimento.

    Reprodutibilidade e requisito do projeto: o mesmo `seed` precisa gerar a
    mesma particao de dados, a mesma inicializacao do modelo e a mesma sequencia
    de amostragem dos batches. Sem isso nao da para comparar os cenarios A/B/C.
    """
    random.seed(seed)
    np.random.seed(seed)
    os.environ["PYTHONHASHSEED"] = str(seed)
    try:
        import torch

        torch.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)
        # Desliga heuristicas nao-deterministas do cuDNN. Custa performance, mas
        # o objetivo aqui e provar a logica, nao bater recorde de velocidade.
        torch.backends.cudnn.deterministic = True
        torch.backends.cudnn.benchmark = False
    except ImportError:  # pragma: no cover - torch e dependencia obrigatoria
        pass


def setup_logging(level: str = "INFO") -> logging.Logger:
    """Configura logging estruturado com timestamp e nome do modulo."""
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)-7s | %(name)-14s | %(message)s",
        datefmt="%H:%M:%S",
        force=True,  # sobrescreve config anterior (util quando rodamos varios cenarios)
    )
    # O Flower e barulhento por padrao; abaixamos o nivel dele.
    logging.getLogger("flwr").setLevel(logging.WARNING)
    return logging.getLogger("awakefl")


def flatten(weights: Sequence[np.ndarray]) -> np.ndarray:
    """Achata a lista de tensores em um unico vetor 1-D (float64).

    O modulo de reputacao raciocina sobre *direcao* e *magnitude* do update, e
    isso e muito mais simples de calcular em um vetor unico. Usamos float64 para
    evitar perda de precisao ao somar milhoes de coordenadas.
    """
    if len(weights) == 0:
        return np.zeros(0, dtype=np.float64)
    return np.concatenate([np.asarray(w, dtype=np.float64).ravel() for w in weights])


def unflatten(vector: np.ndarray, reference: Sequence[np.ndarray]) -> Weights:
    """Operacao inversa de :func:`flatten`, usando `reference` como molde de shapes."""
    out: Weights = []
    offset = 0
    for ref in reference:
        size = int(np.prod(ref.shape)) if ref.shape else 1
        out.append(vector[offset : offset + size].reshape(ref.shape).astype(ref.dtype, copy=False))
        offset += size
    return out


def subtract(a: Sequence[np.ndarray], b: Sequence[np.ndarray]) -> Weights:
    """Delta elemento a elemento (`a - b`), preservando os shapes."""
    return [np.asarray(x, dtype=np.float64) - np.asarray(y, dtype=np.float64) for x, y in zip(a, b)]


def add(a: Sequence[np.ndarray], b: Sequence[np.ndarray]) -> Weights:
    """Soma elemento a elemento (`a + b`), preservando os shapes."""
    return [np.asarray(x, dtype=np.float64) + np.asarray(y, dtype=np.float64) for x, y in zip(a, b)]


def scale(a: Sequence[np.ndarray], factor: float) -> Weights:
    """Multiplica todos os tensores por um escalar."""
    return [np.asarray(x, dtype=np.float64) * float(factor) for x in a]


def weighted_average(
    updates: Dict[int, Sequence[np.ndarray]], weights: Dict[int, float]
) -> Weights:
    """Media ponderada de updates (o coracao do FedAvg).

    `weights` normalmente e o numero de amostras de cada cliente; quando a
    defesa esta ativa, multiplicamos esse numero pela reputacao do participante,
    de forma que quem tem historico ruim influencia menos o modelo global.
    """
    ids = [cid for cid in updates if weights.get(cid, 0.0) > 0.0]
    if not ids:
        raise ValueError("Nenhum participante com peso positivo para agregar.")

    total = sum(weights[cid] for cid in ids)
    reference = updates[ids[0]]
    acc = [np.zeros_like(np.asarray(t, dtype=np.float64)) for t in reference]
    for cid in ids:
        factor = weights[cid] / total
        for i, tensor in enumerate(updates[cid]):
            acc[i] += np.asarray(tensor, dtype=np.float64) * factor
    return acc


def deep_update(base: dict, override: dict) -> dict:
    """Merge recursivo de dicionarios (usado para CLI sobrescrever o YAML)."""
    out = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = deep_update(out[key], value)
        elif value is not None:
            out[key] = value
    return out


# ---------------------------------------------------------------------------
# Caminhos vindos da linha de comando
# ---------------------------------------------------------------------------

# Raiz do repositorio: utils.py fica em awakefl-fl/, entao dois niveis acima.
RAIZ_PROJETO = Path(__file__).resolve().parent.parent


def caminho_no_projeto(caminho: os.PathLike | str, base: Path = RAIZ_PROJETO) -> Path:
    """Resolve `caminho` e exige que ele fique dentro de `base`.

    Todo caminho que chega por argumento de linha de comando passa por aqui
    antes de virar leitura ou escrita. Sem isso, um `--saida ../../algum/lugar`
    — ou o mesmo argumento montado por um script que chama este — escreve fora
    do projeto sem nenhum aviso.

    Resolve ANTES de comparar, senao `..` no meio do caminho passaria batido.
    """
    alvo = Path(caminho).expanduser().resolve()
    raiz = Path(base).resolve()
    if alvo != raiz and raiz not in alvo.parents:
        raise ValueError(
            f"caminho fora do projeto: {alvo}\n"
            f"  permitido apenas dentro de {raiz}"
        )
    return alvo
