"""Testes da ponte off-chain <-> on-chain.

O teste que importa aqui e `test_hash_do_arquivo_bate_com_hash_em_memoria`: e
ele que garante que o compromisso calculado pelo servidor Python e o calculado
pelo navegador (SHA-256 do arquivo que a instituicao sobe em /painel/contribuir)
sao o MESMO numero. Se ele quebrar, a auditoria de ponta a ponta para de fechar
mesmo com as duas camadas funcionando isoladamente.
"""

from __future__ import annotations

import hashlib

import numpy as np
import pytest

from onchain_interface import (
    CANONICAL_EXT,
    MAX_HASH_LEN,
    SimulatedOnChainLedger,
    canonical_chunks,
    export_weights,
    hash_weights,
    load_weights,
)


@pytest.fixture
def pesos():
    """Formato parecido com o do modelo real: conv (4-D), bias (1-D), fc (2-D)."""
    rng = np.random.default_rng(7)
    return [
        rng.normal(size=(4, 1, 3, 3)).astype(np.float32),
        rng.normal(size=(4,)).astype(np.float32),
        rng.normal(size=(8, 6)).astype(np.float32),
        rng.normal(size=(8,)).astype(np.float32),
    ]


# ---------------------------------------------------------------------------
# Hash
# ---------------------------------------------------------------------------


def test_hash_tem_formato_de_sha256(pesos):
    h = hash_weights(pesos)
    assert len(h) == 64 == MAX_HASH_LEN
    assert all(c in "0123456789abcdef" for c in h)


def test_hash_e_deterministico(pesos):
    assert hash_weights(pesos) == hash_weights(pesos)


def test_hash_muda_com_um_unico_bit(pesos):
    antes = hash_weights(pesos)
    pesos[0][0, 0, 0, 0] += np.float32(1e-3)
    assert hash_weights(pesos) != antes


def test_shape_entra_no_hash():
    """Mesmos numeros, shapes diferentes => hashes diferentes.

    Sem o shape no cabecalho, um vetor de 6 e uma matriz 2x3 teriam o mesmo
    compromisso, e um participante poderia trocar a topologia sem quebrar o hash.
    """
    plano = [np.arange(6, dtype=np.float32)]
    matriz = [np.arange(6, dtype=np.float32).reshape(2, 3)]
    assert hash_weights(plano) != hash_weights(matriz)


def test_float64_e_float32_produzem_o_mesmo_hash(pesos):
    """A serializacao fixa float32, entao a precisao interna nao muda o hash."""
    em_64 = [p.astype(np.float64) for p in pesos]
    assert hash_weights(em_64) == hash_weights(pesos)


# ---------------------------------------------------------------------------
# Artefato canonico (a costura com a web)
# ---------------------------------------------------------------------------


def test_hash_do_arquivo_bate_com_hash_em_memoria(pesos, tmp_path):
    """O contrato com /painel/contribuir.

    A web faz `crypto.subtle.digest("SHA-256", await arquivo.arrayBuffer())`,
    ou seja, hash dos bytes crus. Aqui reproduzimos isso com hashlib sobre o
    arquivo gravado e exigimos igualdade com o hash calculado em memoria.
    """
    caminho = export_weights(pesos, tmp_path / f"rodada3_p2{CANONICAL_EXT}")
    do_arquivo = hashlib.sha256(caminho.read_bytes()).hexdigest()
    assert do_arquivo == hash_weights(pesos)


def test_arquivo_nao_tem_padding_nem_cabecalho_global(pesos, tmp_path):
    """O tamanho e exatamente a soma dos pedacos canonicos - nada a mais."""
    caminho = export_weights(pesos, tmp_path / f"p{CANONICAL_EXT}")
    esperado = sum(len(c) for c in canonical_chunks(pesos))
    assert caminho.stat().st_size == esperado


def test_roundtrip_preserva_valores_e_shapes(pesos, tmp_path):
    caminho = export_weights(pesos, tmp_path / f"p{CANONICAL_EXT}")
    lidos = load_weights(caminho)
    assert len(lidos) == len(pesos)
    for original, lido in zip(pesos, lidos):
        assert lido.shape == original.shape
        assert lido.dtype == np.float32
        np.testing.assert_array_equal(lido, original)


def test_auditor_reconstroi_e_confere_sem_conhecer_o_modelo(pesos, tmp_path):
    """Fluxo completo de auditoria: arquivo -> tensores -> hash -> ledger."""
    ledger = SimulatedOnChainLedger()
    registro = ledger.register_contribution(
        round_number=3, participant_id=2, weights=pesos, num_examples=1200,
        metrics={"accuracy": 0.91, "loss": 0.3}, score=0.88, reputation=0.9,
    )
    caminho = export_weights(pesos, tmp_path / f"r3p2{CANONICAL_EXT}")

    # O auditor tem apenas o arquivo e o registro publicado.
    reconstruidos = load_weights(caminho)
    assert ledger.verify_contribution(registro, reconstruidos)

    # E detecta adulteracao do artefato.
    reconstruidos[0][0, 0, 0, 0] += np.float32(0.5)
    assert not ledger.verify_contribution(registro, reconstruidos)
