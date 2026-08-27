"""Testes do backend Flower — a camada do AwakeFL encaixada num FL de verdade.

O caminho `--backend flower` exige `flwr[simulation]` (Ray) para *executar* uma
rodada, e o Ray nao esta instalado nem aqui nem na CI. Mas a classe da estrategia
so precisa do `flwr` puro para ser construida, e foi exatamente no construtor que
o bug de `export_dir` apareceu — por isso vale testar esta metade.
"""

import pytest

from reputation import ReputationLedger
from server import FLOWER_AVAILABLE

pytestmark = pytest.mark.skipif(
    not FLOWER_AVAILABLE, reason="flwr nao instalado"
)


def _estrategia(**kwargs):
    from server import AwakeFLStrategy

    return AwakeFLStrategy(
        reputation_ledger=ReputationLedger(num_participants=3), **kwargs
    )


def test_estrategia_constroi_sem_ledger_explicito():
    """Regressao: `chain=None` fazia a estrategia procurar `export_dir` como
    global do modulo, onde ele nunca existiu, e levantar NameError."""
    estrategia = _estrategia(chain=None)
    assert estrategia.chain is not None


def test_exportacao_de_pesos_chega_ao_ledger():
    estrategia = _estrategia(chain=None, export_dir="results_demo", export_rounds=[1, 2])
    # O ledger normaliza o diretorio para Path.
    assert estrategia.chain.export_dir.name == "results_demo"
    assert set(estrategia.chain.export_rounds) == {1, 2}


def test_a_estrategia_e_um_fedavg():
    """O papel do AwakeFL: herdar o FedAvg do Flower e sobrescrever so o ponto
    onde o servidor tem todas as atualizacoes na mao ao mesmo tempo."""
    from flwr.server.strategy import FedAvg
    from server import AwakeFLStrategy

    assert issubclass(AwakeFLStrategy, FedAvg)
    metodos = {
        nome
        for nome in AwakeFLStrategy.__dict__
        if not nome.startswith("_") and callable(getattr(AwakeFLStrategy, nome, None))
    }
    assert metodos == {"aggregate_fit"}
