"""Testes do modulo de reputacao - a logica que sera espelhada on-chain.

Sao os testes mais importantes do projeto: se a formula, o limiar ou a
irreversibilidade do banimento mudarem sem querer, o programa Anchor e a
simulacao deixam de concordar e o livro-razao perde valor probatorio.
"""

import numpy as np
import pytest

from reputation import (
    ReputationLedger,
    consistency_score,
    coordinate_median,
    cosine_similarity,
    magnitude_score,
    next_reputation,
    to_basis_points,
    to_program_scale,
    PROGRAM_MAX_REPUTATION,
)


# ---------------------------------------------------------------------------
# Funcoes puras
# ---------------------------------------------------------------------------


def test_cosine_vetores_identicos_eh_um():
    v = np.array([1.0, 2.0, 3.0])
    assert cosine_similarity(v, v) == pytest.approx(1.0)


def test_cosine_vetores_opostos_eh_menos_um():
    v = np.array([1.0, 2.0, 3.0])
    assert cosine_similarity(v, -v) == pytest.approx(-1.0)


def test_cosine_vetor_nulo_nao_explode():
    """Vetor nulo (free-rider extremo) => 0.0, e nao NaN/divisao por zero."""
    assert cosine_similarity(np.zeros(5), np.ones(5)) == 0.0


def test_coordinate_median_ignora_outlier():
    """A mediana e robusta: um atacante 100x nao desloca a referencia."""
    honestos = [np.array([1.0, 1.0]) for _ in range(4)]
    atacante = [np.array([100.0, -100.0])]
    ref = coordinate_median(honestos + atacante)
    np.testing.assert_allclose(ref, [1.0, 1.0])


def test_magnitude_score_penaliza_dos_dois_lados():
    assert magnitude_score(1.0, 1.0) == pytest.approx(1.0)
    assert magnitude_score(10.0, 1.0) == pytest.approx(0.1)   # update inflado
    assert magnitude_score(0.1, 1.0) == pytest.approx(0.1)    # free-rider
    assert magnitude_score(0.0, 1.0) == 0.0


def test_consistency_score_limites():
    ref = np.array([1.0, 1.0, 1.0])
    igual = consistency_score(ref, ref, float(np.linalg.norm(ref)))
    oposto = consistency_score(-ref, ref, float(np.linalg.norm(ref)))
    assert igual == pytest.approx(1.0)
    # Direcao oposta zera o termo de direcao; sobra so o peso de magnitude.
    assert oposto == pytest.approx(0.3, abs=1e-6)
    assert 0.0 <= oposto < igual <= 1.0


def test_formula_reputacao():
    """R(t) = 0,5*R(t-1) + 0,5*S(t) - o requisito literal do projeto."""
    assert next_reputation(1.0, 0.0, alpha=0.5) == pytest.approx(0.5)
    assert next_reputation(0.5, 0.0, alpha=0.5) == pytest.approx(0.25)
    assert next_reputation(1.0, 1.0, alpha=0.5) == pytest.approx(1.0)
    assert next_reputation(0.4, 0.8, alpha=0.5) == pytest.approx(0.6)


def test_reputacao_saturada_em_zero_um():
    assert next_reputation(1.0, 5.0) <= 1.0
    assert next_reputation(0.0, -5.0) >= 0.0


def test_basis_points():
    assert to_basis_points(1.0) == 10_000
    assert to_basis_points(0.4) == 4_000
    assert to_basis_points(0.0) == 0


def test_escala_do_programa_anchor():
    """A faixa 0..=1000 precisa bater com MAX_REPUTATION do state.rs."""
    assert to_program_scale(1.0) == PROGRAM_MAX_REPUTATION == 1_000
    assert to_program_scale(0.4) == 400  # limiar de banimento off-chain
    assert to_program_scale(0.0) == 0
    # Um decimo dos basis points, sem excecao: e a mesma grandeza em duas escalas.
    for r in (0.0, 0.137, 0.5, 0.999, 1.0):
        assert to_program_scale(r) == pytest.approx(to_basis_points(r) / 10, abs=1)


def test_escala_do_programa_e_robusta_a_lixo():
    assert to_program_scale(float("nan")) == 0
    assert to_program_scale(2.5) == PROGRAM_MAX_REPUTATION
    assert to_program_scale(-1.0) == 0


# ---------------------------------------------------------------------------
# Ledger
# ---------------------------------------------------------------------------


def test_reputacao_inicial_e_um():
    ledger = ReputationLedger(num_participants=5)
    assert all(v == 1.0 for v in ledger.snapshot().values())
    assert ledger.banned_ids == []


def _updates(n_honestos: int, atacante: np.ndarray | None = None, dim: int = 20):
    """Gera updates honestos coerentes + (opcionalmente) um update malicioso."""
    rng = np.random.default_rng(0)
    base = np.ones(dim)
    updates = {i: base + rng.normal(0, 0.02, dim) for i in range(n_honestos)}
    if atacante is not None:
        updates[n_honestos] = atacante
    return updates


def test_honestos_mantem_reputacao_alta():
    ledger = ReputationLedger(num_participants=5, ban_threshold=0.4)
    for rnd in range(1, 6):
        ledger.process_round(rnd, _updates(5))
    assert ledger.banned_ids == []
    assert all(r > 0.9 for r in ledger.snapshot().values())


def test_atacante_e_banido_e_penalizado():
    """Update invertido e amplificado => S baixo => R cruza o limiar => ban + R/10."""
    ledger = ReputationLedger(num_participants=6, ban_threshold=0.4, grace_rounds=1)
    atacante_id = 5
    banido_em = None
    for rnd in range(1, 8):
        ledger.process_round(rnd, _updates(5, atacante=-np.ones(20) * 5.0))
        if ledger.is_banned(atacante_id) and banido_em is None:
            banido_em = rnd

    assert banido_em is not None, "o atacante deveria ter sido banido"
    assert ledger.banned_ids == [atacante_id]
    state = ledger.states[atacante_id]
    # A penalidade divide por 10 => reputacao final bem abaixo do limiar.
    assert state.reputation < ledger.ban_threshold / 5
    assert state.banned_round == banido_em


def test_free_rider_e_detectado_pela_magnitude():
    """Update quase nulo: o cosseno nao denuncia, mas a coerencia de norma sim."""
    ledger = ReputationLedger(num_participants=6, ban_threshold=0.4, grace_rounds=1)
    rng = np.random.default_rng(1)
    for rnd in range(1, 10):
        ledger.process_round(rnd, _updates(5, atacante=rng.normal(0, 1e-4, 20)))
    assert 5 in ledger.banned_ids


def test_banimento_e_permanente():
    """Depois de banido, comportar-se bem NAO restaura a reputacao."""
    ledger = ReputationLedger(num_participants=6, ban_threshold=0.4, grace_rounds=0)
    for rnd in range(1, 8):
        ledger.process_round(rnd, _updates(5, atacante=-np.ones(20) * 5.0))
    assert 5 in ledger.banned_ids
    rep_pos_ban = ledger.reputation_of(5)

    # Agora o atacante passa a enviar updates perfeitos por muitas rodadas.
    for rnd in range(8, 20):
        ledger.process_round(rnd, _updates(5, atacante=np.ones(20)))
    assert ledger.is_banned(5)
    assert ledger.reputation_of(5) == pytest.approx(rep_pos_ban)


def test_banido_nao_entra_na_agregacao():
    ledger = ReputationLedger(num_participants=3, ban_threshold=0.4, grace_rounds=0)
    ledger.states[2].banned = True
    pesos = ledger.aggregation_weights({0: 100, 1: 100, 2: 100})
    assert pesos[2] == 0.0
    assert pesos[0] > 0 and pesos[1] > 0


def test_defesa_desligada_nao_bane():
    """Cenario B: score e reputacao continuam sendo medidos, mas ninguem e banido."""
    ledger = ReputationLedger(num_participants=6, ban_threshold=0.4, enabled=False, grace_rounds=0)
    for rnd in range(1, 10):
        ledger.process_round(rnd, _updates(5, atacante=-np.ones(20) * 5.0))
    assert ledger.banned_ids == []
    assert ledger.reputation_of(5) < 0.4  # o sinal existia, so nao foi aplicado


def test_grace_rounds_protege_o_inicio():
    ledger = ReputationLedger(num_participants=6, ban_threshold=0.9, grace_rounds=3)
    for rnd in range(1, 4):
        ledger.process_round(rnd, _updates(5, atacante=-np.ones(20) * 5.0))
    assert ledger.banned_ids == []
    ledger.process_round(4, _updates(5, atacante=-np.ones(20) * 5.0))
    assert 5 in ledger.banned_ids


def test_veto_de_norma_pega_update_amplificado():
    """Backdoor com model replacement: direcao perfeita, norma 3x => veto."""
    ref = np.ones(20)
    norm = float(np.linalg.norm(ref))
    # Sem veto (ratio alto o bastante para nao disparar): o cosseno perfeito domina.
    sem_veto = consistency_score(ref * 3, ref, norm, norm_veto_ratio=10.0)
    com_veto = consistency_score(ref * 3, ref, norm, norm_veto_ratio=2.5)
    assert sem_veto > 0.7, "sem o veto, o ataque de amplificacao passaria batido"
    assert com_veto == pytest.approx(1 / 3, abs=1e-6)
    assert com_veto < 0.4  # abaixo do limiar default => banimento


def test_veto_nao_afeta_quem_esta_na_faixa():
    ref = np.ones(20)
    norm = float(np.linalg.norm(ref))
    assert consistency_score(ref * 1.5, ref, norm, norm_veto_ratio=2.5) > 0.8


def test_backdoor_amplificado_e_banido_pelo_ledger():
    ledger = ReputationLedger(num_participants=6, ban_threshold=0.4, grace_rounds=1)
    for rnd in range(1, 8):
        # Atacante: mesma direcao dos honestos, porem 3x amplificada.
        ledger.process_round(rnd, _updates(5, atacante=np.ones(20) * 3.0))
    assert 5 in ledger.banned_ids
    assert ledger.detection_metrics([5])["precision"] == 1.0


def test_update_nao_finito_recebe_score_zero():
    """NaN/inf nao pode propagar para a reputacao nem contaminar a mediana."""
    ledger = ReputationLedger(num_participants=6, ban_threshold=0.4, grace_rounds=0)
    quebrado = np.full(20, np.nan)
    scores, _ = ledger.compute_scores(_updates(5, atacante=quebrado))
    assert scores[5] == 0.0
    assert all(np.isfinite(s) for s in scores.values())
    assert all(s > 0.5 for cid, s in scores.items() if cid != 5)

    ledger.process_round(1, _updates(5, atacante=quebrado))
    assert np.isfinite(ledger.reputation_of(5))
    assert to_basis_points(ledger.reputation_of(5)) >= 0


def test_next_reputation_com_nan():
    assert next_reputation(1.0, float("nan")) == pytest.approx(0.5)
    assert to_basis_points(float("nan")) == 0


def test_metricas_de_deteccao():
    ledger = ReputationLedger(num_participants=6, ban_threshold=0.4, grace_rounds=0)
    for rnd in range(1, 8):
        ledger.process_round(rnd, _updates(5, atacante=-np.ones(20) * 5.0))
    m = ledger.detection_metrics([5])
    assert m["precision"] == 1.0 and m["recall"] == 1.0 and m["f1"] == 1.0

    # Recall parcial: dois atacantes declarados, so um detectado.
    m2 = ledger.detection_metrics([4, 5])
    assert m2["recall"] == pytest.approx(0.5)
