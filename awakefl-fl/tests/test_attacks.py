"""Testes dos ataques e da interface on-chain.

Verificam que cada ataque de fato faz o que promete - um ataque quebrado
produziria um cenario B sem degradacao e invalidaria todo o experimento.
"""

import numpy as np
import pytest
import torch

from attacks import (
    AttackConfig,
    apply_data_attack,
    apply_weight_attack,
    backdoor_data,
    build_backdoor_testset,
    free_rider,
    gradient_poisoning,
    label_flipping,
    select_malicious,
    stamp_trigger,
)
from data import PIXEL_MAX
from onchain_interface import SimulatedOnChainLedger, hash_weights
from utils import flatten, subtract


@pytest.fixture
def pesos():
    rng = np.random.default_rng(0)
    return [rng.normal(size=(4, 3)), rng.normal(size=(3,))]


# ---------------------------------------------------------------------------
# label flipping
# ---------------------------------------------------------------------------


def test_label_flipping_default_inverte_todos():
    y = torch.arange(10)
    y_flip = label_flipping(y)
    assert torch.equal(y_flip, torch.tensor([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]))
    assert (y_flip != y).all(), "o mapa default nao pode ter ponto fixo"


def test_label_flipping_com_mapa_custom():
    y = torch.tensor([0, 1, 2, 0])
    y_flip = label_flipping(y, flip_map={0: 7})
    assert torch.equal(y_flip, torch.tensor([7, 1, 2, 7]))


def test_label_flipping_nao_altera_as_imagens():
    x = torch.randn(8, 1, 28, 28)
    y = torch.randint(0, 10, (8,))
    cfg = AttackConfig(type="label_flipping")
    x2, y2 = apply_data_attack(x, y, cfg)
    assert torch.equal(x, x2)
    assert not torch.equal(y, y2)


# ---------------------------------------------------------------------------
# backdoor
# ---------------------------------------------------------------------------


def test_stamp_trigger_marca_o_canto():
    x = torch.zeros(2, 1, 28, 28)
    xt = stamp_trigger(x, size=3)
    assert torch.allclose(xt[:, :, -3:, -3:], torch.full((2, 1, 3, 3), PIXEL_MAX))
    assert xt[:, :, :-3, :-3].abs().sum() == 0  # o resto continua intacto


def test_backdoor_envenena_apenas_a_fracao_pedida():
    x = torch.zeros(100, 1, 28, 28)
    y = torch.full((100,), 5, dtype=torch.long)
    xb, yb = backdoor_data(x, y, target=0, fraction=0.4, seed=1)
    assert int((yb == 0).sum()) == 40
    assert int((yb == 5).sum()) == 60


def test_backdoor_testset_exclui_a_classe_alvo():
    x = torch.zeros(10, 1, 28, 28)
    y = torch.arange(10)
    xb, yb = build_backdoor_testset(x, y, target=3)
    assert len(yb) == 9              # a propria classe 3 e removida
    assert (yb == 3).all()           # todo o resto e rotulado como alvo
    assert torch.allclose(xb[:, :, -3:, -3:], torch.full((9, 1, 3, 3), PIXEL_MAX))


def test_backdoor_amplifica_o_update(pesos):
    global_w = pesos
    local = [w + 0.1 for w in global_w]
    cfg = AttackConfig(type="backdoor", backdoor_scale=3.0)
    out = apply_weight_attack(local, global_w, cfg)
    delta_honesto = flatten(subtract(local, global_w))
    delta_atacado = flatten(subtract(out, global_w))
    assert np.linalg.norm(delta_atacado) == pytest.approx(3.0 * np.linalg.norm(delta_honesto))


# ---------------------------------------------------------------------------
# gradient poisoning
# ---------------------------------------------------------------------------


def test_gradient_poisoning_inverte_a_direcao(pesos):
    global_w = pesos
    local = [w + 0.5 for w in global_w]
    out = gradient_poisoning(local, global_w, scale_factor=5.0)
    d_honesto = flatten(subtract(local, global_w))
    d_atacado = flatten(subtract(out, global_w))
    cos = float(np.dot(d_honesto, d_atacado) / (np.linalg.norm(d_honesto) * np.linalg.norm(d_atacado)))
    assert cos == pytest.approx(-1.0)
    assert np.linalg.norm(d_atacado) == pytest.approx(5.0 * np.linalg.norm(d_honesto))


# ---------------------------------------------------------------------------
# free rider
# ---------------------------------------------------------------------------


def test_free_rider_devolve_praticamente_o_modelo_global(pesos):
    out = free_rider(pesos, noise_std=1e-4, seed=0)
    for original, devolvido in zip(pesos, out):
        assert np.allclose(original, devolvido, atol=1e-3)
    # ... mas nao EXATAMENTE igual: o ruido evita deteccao por hash identico.
    assert hash_weights(out) != hash_weights(pesos)


def test_free_rider_produz_update_minusculo(pesos):
    treinado = [w + 0.3 for w in pesos]
    cfg = AttackConfig(type="free_rider", free_rider_noise=1e-4)
    out = apply_weight_attack(treinado, pesos, cfg)
    delta = flatten(subtract(out, pesos))
    delta_honesto = flatten(subtract(treinado, pesos))
    assert np.linalg.norm(delta) < 0.01 * np.linalg.norm(delta_honesto)


# ---------------------------------------------------------------------------
# selecao de maliciosos
# ---------------------------------------------------------------------------


def test_ids_explicitos_tem_prioridade():
    cfg = AttackConfig(type="label_flipping", malicious_fraction=0.9, malicious_ids=[2, 5])
    assert select_malicious(10, cfg, seed=42) == {2, 5}


def test_fracao_e_deterministica_e_preserva_o_participante_zero():
    cfg = AttackConfig(type="label_flipping", malicious_fraction=0.3)
    a = select_malicious(10, cfg, seed=42)
    b = select_malicious(10, cfg, seed=42)
    assert a == b and len(a) == 3
    assert 0 not in a, "o participante 0 e mantido honesto como referencia"


def test_id_fora_do_intervalo_falha():
    cfg = AttackConfig(type="label_flipping", malicious_ids=[99])
    with pytest.raises(ValueError):
        select_malicious(10, cfg)


def test_ataque_desconhecido_falha():
    with pytest.raises(ValueError):
        AttackConfig.from_dict({"type": "nao_existe"})


def test_sem_ataque_nao_ha_maliciosos():
    assert select_malicious(10, AttackConfig(type="none")) == set()


# ---------------------------------------------------------------------------
# interface on-chain
# ---------------------------------------------------------------------------


def test_hash_e_deterministico_e_sensivel(pesos):
    h1 = hash_weights(pesos)
    h2 = hash_weights([w.copy() for w in pesos])
    assert h1 == h2 and len(h1) == 64

    alterado = [w.copy() for w in pesos]
    alterado[0][0, 0] += 1e-3
    assert hash_weights(alterado) != h1


def test_hash_sensivel_ao_shape():
    a = [np.arange(6, dtype=np.float32).reshape(2, 3)]
    b = [np.arange(6, dtype=np.float32).reshape(3, 2)]
    assert hash_weights(a) != hash_weights(b)


def test_ledger_registra_e_verifica(pesos):
    ledger = SimulatedOnChainLedger()
    rec = ledger.register_contribution(1, 0, pesos, 100, {"train_loss": 0.2}, score=0.9, reputation=0.95)
    assert ledger.verify_contribution(rec, pesos)
    assert not ledger.verify_contribution(rec, [w + 1 for w in pesos])
    assert rec.reputation_bps == 9500


def test_cadeia_detecta_adulteracao(pesos):
    ledger = SimulatedOnChainLedger()
    for rnd in range(1, 4):
        ledger.register_contribution(rnd, 0, pesos, 100, {"train_loss": 0.1}, 0.9, 0.9)
    ledger.register_ban(3, 1, 0.03)
    assert ledger.verify_chain()

    ledger.contributions[0].metrics["train_loss"] = 0.999  # adulteracao
    assert not ledger.verify_chain()
