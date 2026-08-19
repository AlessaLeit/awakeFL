"""Carga do dataset e particionamento entre as instituicoes participantes.

Em Federated Learning cada participante so ve a propria fatia dos dados. Aqui
simulamos isso particionando o MNIST (ou Fashion-MNIST) em N shards disjuntos.

Dois regimes de particao:

* **IID** - cada participante recebe uma amostra aleatoria uniforme. E o cenario
  "facil": as distribuicoes locais sao parecidas, entao os updates honestos
  apontam quase todos na mesma direcao e o detector de anomalias tem vida facil.
* **Nao-IID (Dirichlet)** - a proporcao de cada classe por participante e sorteada
  de uma Dirichlet(alpha). Alpha pequeno = participantes especializados em poucas
  classes. Esse e o cenario realista (cada hospital ve uma populacao diferente) e
  o teste duro para a reputacao: updates honestos ja divergem naturalmente entre si,
  entao o score de consistencia precisa separar "divergente porque e heterogeneo"
  de "divergente porque e malicioso".
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Dict, List, Tuple

import numpy as np
import torch
from torch.utils.data import DataLoader, TensorDataset

logger = logging.getLogger("awakefl.data")

# Estatisticas de normalizacao do MNIST. Guardamos tambem o valor de um pixel
# branco *apos* a normalizacao, porque o ataque de backdoor precisa estampar o
# gatilho no mesmo espaco em que a rede enxerga.
MNIST_MEAN, MNIST_STD = 0.1307, 0.3081
PIXEL_MAX = (1.0 - MNIST_MEAN) / MNIST_STD  # ~2.821
NUM_CLASSES = 10


@dataclass
class Partition:
    """Fatia local de um participante."""

    client_id: int
    x: torch.Tensor  # (n, 1, 28, 28) float32 ja normalizado
    y: torch.Tensor  # (n,) int64

    def __len__(self) -> int:
        return int(self.y.shape[0])

    def class_histogram(self) -> Dict[int, int]:
        """Distribuicao de classes - vai para o log, evidencia o quao nao-IID esta."""
        values, counts = np.unique(self.y.numpy(), return_counts=True)
        return {int(v): int(c) for v, c in zip(values, counts)}


def _synthetic_fallback(n_train: int, n_test: int, seed: int):
    """Dataset sintetico usado apenas se o download do MNIST falhar (sem internet).

    Nao e um substituto cientifico do MNIST - e uma rede de seguranca para que a
    pipeline inteira (FL + ataque + reputacao) continue executavel offline, que e
    o criterio de aceite deste modulo. Cada classe e um padrao de blocos com
    ruido, entao a CNN consegue aprender e a acuracia ainda e informativa.
    """
    logger.warning(
        "MNIST indisponivel (sem rede?). Usando dataset SINTETICO - os numeros "
        "de acuracia nao sao comparaveis com a literatura, mas a logica de "
        "reputacao/ataque continua valida."
    )
    rng = np.random.default_rng(seed)

    def build(n: int):
        y = rng.integers(0, NUM_CLASSES, size=n)
        x = rng.normal(0.0, 0.3, size=(n, 1, 28, 28)).astype(np.float32)
        for c in range(NUM_CLASSES):
            mask = y == c
            row, col = (c // 4) * 7, (c % 4) * 7
            x[mask, :, row : row + 7, col : col + 7] += 2.5
        return torch.from_numpy(x), torch.from_numpy(y.astype(np.int64))

    return build(n_train), build(n_test)


def _download(dataset: str, data_dir: str):
    """Baixa MNIST/Fashion-MNIST e devolve tensores em memoria (ja normalizados).

    Materializamos tudo em tensores porque o dataset e pequeno (<200 MB) e assim
    o particionamento por indices, o label flipping e o backdoor viram simples
    operacoes vetoriais - muito mais didatico do que embrulhar `Dataset` do torch.
    """
    from torchvision import datasets, transforms

    tf = transforms.Compose(
        [transforms.ToTensor(), transforms.Normalize((MNIST_MEAN,), (MNIST_STD,))]
    )
    cls = datasets.FashionMNIST if dataset.lower() in {"fashion", "fashion_mnist"} else datasets.MNIST
    train = cls(root=data_dir, train=True, download=True, transform=tf)
    test = cls(root=data_dir, train=False, download=True, transform=tf)

    def to_tensors(ds):
        # `ds.data` e uint8 cru; aplicamos a mesma normalizacao do transform.
        x = ds.data.unsqueeze(1).float().div_(255.0).sub_(MNIST_MEAN).div_(MNIST_STD)
        return x, ds.targets.long()

    return to_tensors(train), to_tensors(test)


def load_dataset(
    dataset: str = "mnist",
    data_dir: str = "./data",
    train_subset: int = 0,
    test_subset: int = 0,
    seed: int = 42,
) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    """Carrega e (opcionalmente) subamostra o dataset.

    `train_subset`/`test_subset` = 0 significam "use tudo". Por padrao o
    config.yaml usa subconjuntos pequenos para que os 3 cenarios rodem em poucos
    minutos em CPU - o objetivo e provar a logica, nao o estado da arte.
    """
    try:
        (xtr, ytr), (xte, yte) = _download(dataset, data_dir)
    except Exception as exc:  # noqa: BLE001 - qualquer falha de rede/IO cai no fallback
        logger.debug("Falha ao carregar %s: %s", dataset, exc)
        (xtr, ytr), (xte, yte) = _synthetic_fallback(
            train_subset or 12000, test_subset or 2000, seed
        )
        return xtr, ytr, xte, yte

    rng = np.random.default_rng(seed)
    if train_subset and train_subset < len(ytr):
        idx = rng.choice(len(ytr), size=train_subset, replace=False)
        xtr, ytr = xtr[idx], ytr[idx]
    if test_subset and test_subset < len(yte):
        idx = rng.choice(len(yte), size=test_subset, replace=False)
        xte, yte = xte[idx], yte[idx]

    logger.info(
        "Dataset '%s' carregado: %d amostras de treino, %d de teste.",
        dataset,
        len(ytr),
        len(yte),
    )
    return xtr, ytr, xte, yte


def partition_iid(num_samples: int, num_clients: int, seed: int) -> List[np.ndarray]:
    """Divide os indices em N blocos aleatorios de tamanho ~igual."""
    rng = np.random.default_rng(seed)
    idx = rng.permutation(num_samples)
    return [np.sort(part) for part in np.array_split(idx, num_clients)]


def partition_dirichlet(
    labels: np.ndarray, num_clients: int, alpha: float, seed: int, min_size: int = 20
) -> List[np.ndarray]:
    """Particao nao-IID classica: proporcoes por classe sorteadas de Dirichlet(alpha).

    Repetimos o sorteio ate que todo participante tenha ao menos `min_size`
    amostras - com alpha baixo a Dirichlet pode deixar alguem quase vazio, e um
    cliente com 3 amostras produziria um update degenerado que o detector
    marcaria como ataque (falso positivo que nao queremos estudar aqui).
    """
    rng = np.random.default_rng(seed)
    n_classes = int(labels.max()) + 1

    for _ in range(100):
        buckets: List[List[int]] = [[] for _ in range(num_clients)]
        for c in range(n_classes):
            idx_c = np.where(labels == c)[0]
            rng.shuffle(idx_c)
            proportions = rng.dirichlet(np.repeat(alpha, num_clients))
            cuts = (np.cumsum(proportions) * len(idx_c)).astype(int)[:-1]
            for cid, part in enumerate(np.split(idx_c, cuts)):
                buckets[cid].extend(part.tolist())
        if min(len(b) for b in buckets) >= min_size:
            return [np.sort(np.array(b, dtype=int)) for b in buckets]

    logger.warning(
        "Dirichlet(alpha=%.2f) nao atingiu min_size=%d em 100 tentativas; "
        "caindo para particao IID.",
        alpha,
        min_size,
    )
    return partition_iid(len(labels), num_clients, seed)


def build_partitions(
    x: torch.Tensor,
    y: torch.Tensor,
    num_clients: int,
    partition: str = "non_iid",
    dirichlet_alpha: float = 0.7,
    seed: int = 42,
) -> List[Partition]:
    """Constroi as fatias locais dos N participantes."""
    if partition.lower() == "iid":
        index_sets = partition_iid(len(y), num_clients, seed)
    else:
        index_sets = partition_dirichlet(y.numpy(), num_clients, dirichlet_alpha, seed)

    parts = [Partition(cid, x[idx].clone(), y[idx].clone()) for cid, idx in enumerate(index_sets)]
    for p in parts:
        logger.debug("Participante %d: %d amostras | classes=%s", p.client_id, len(p), p.class_histogram())
    return parts


def make_loader(
    x: torch.Tensor, y: torch.Tensor, batch_size: int, shuffle: bool = True, seed: int = 42
) -> DataLoader:
    """DataLoader com gerador proprio - shuffle reprodutivel por seed."""
    generator = torch.Generator()
    generator.manual_seed(seed)
    return DataLoader(
        TensorDataset(x, y),
        batch_size=max(1, min(batch_size, len(y))),
        shuffle=shuffle,
        generator=generator if shuffle else None,
        num_workers=0,  # tudo em memoria: workers so adicionariam overhead
        drop_last=False,
    )
