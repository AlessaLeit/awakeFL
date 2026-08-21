"""Orquestrador dos experimentos do AwakeFL.

Executa os tres cenarios exigidos pelo projeto e gera o relatorio comparativo:

    A - baseline .... FL honesto, sem atacante, sem defesa
    B - ataque ...... com atacante(s), SEM defesa   (mostra o dano)
    C - defesa ...... com os MESMOS atacantes, COM reputacao + banimento

Controle experimental: os tres cenarios partem da mesma seed, da mesma particao
de dados e da mesma inicializacao do modelo global. A unica variavel entre B e C
e a defesa estar ligada - o que permite atribuir a diferenca de acuracia ao
mecanismo de reputacao, e nao ao acaso.

Uso:
    python run_experiments.py
    python run_experiments.py --attack backdoor --rounds 20 --malicious-ids 2 5
    python run_experiments.py --scenarios A C --partition iid --seed 7
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

import torch
import yaml

from attacks import ATTACK_TYPES, AttackConfig, select_malicious
from client import build_clients
from data import build_partitions, load_dataset
from model import count_parameters, create_model
from report import save_report
from server import History, run_federated, run_flower_simulation
from utils import caminho_no_projeto, deep_update, set_seed, setup_logging

DEFAULT_CONFIG = Path(__file__).parent / "config.yaml"


# ---------------------------------------------------------------------------
# Configuracao
# ---------------------------------------------------------------------------


def load_config(path: Path) -> dict:
    """Le o config.yaml. Se nao existir, usa um default embutido minimo."""
    # `--config` vem da linha de comando: confina no projeto antes de ler.
    path = caminho_no_projeto(path)
    if path.exists():
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    return {
        "seed": 42,
        "federation": {"num_clients": 10, "rounds": 10, "local_epochs": 1,
                       "batch_size": 32, "learning_rate": 0.05, "momentum": 0.9,
                       "local_steps": "auto",
                       "fraction_fit": 1.0},
        "data": {"dataset": "mnist", "data_dir": "./data", "partition": "non_iid",
                 "dirichlet_alpha": 0.7, "train_subset": 12000, "test_subset": 2000},
        "attack": {"type": "label_flipping", "malicious_fraction": 0.3},
        "reputation": {"initial": 0.5, "alpha": 0.5, "ban_threshold": 0.4,
                       "ban_penalty_divisor": 10, "grace_rounds": 2,
                       "smooth_updates": True, "update_alpha": 0.5,
                       "weight_direction": 0.7, "weight_magnitude": 0.3,
                       "weighted_aggregation": True},
        "output": {"results_dir": "./results", "log_level": "INFO"},
    }


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="AwakeFL - simulacao de Federated Learning com reputacao on-chain.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("--config", type=Path, default=DEFAULT_CONFIG, help="caminho do config.yaml")
    p.add_argument("--seed", type=int, help="semente global de reprodutibilidade")

    g = p.add_argument_group("federacao")
    g.add_argument("--clients", type=int, dest="num_clients", help="numero de participantes")
    g.add_argument("--rounds", type=int, help="numero de rodadas")
    g.add_argument("--local-epochs", type=int, help="epocas de treino local por rodada")
    g.add_argument("--local-steps", type=int,
                   help="passos de SGD fixos por rodada, iguais para todos. O padrao "
                        "('auto' no config) usa uma epoca do MAIOR participante. "
                        "Use 0 para voltar ao regime de epocas locais")
    g.add_argument("--batch-size", type=int)
    g.add_argument("--lr", type=float, dest="learning_rate")
    g.add_argument("--fraction-fit", type=float, help="fracao de clientes por rodada")

    g = p.add_argument_group("dados")
    g.add_argument("--dataset", choices=["mnist", "fashion_mnist"])
    g.add_argument("--partition", choices=["iid", "non_iid"])
    g.add_argument("--alpha", type=float, dest="dirichlet_alpha", help="alpha da Dirichlet")
    g.add_argument("--train-subset", type=int)
    g.add_argument("--test-subset", type=int)

    g = p.add_argument_group("ataque")
    g.add_argument("--attack", choices=list(ATTACK_TYPES), dest="attack_type")
    g.add_argument("--malicious-fraction", type=float)
    g.add_argument("--malicious-ids", type=int, nargs="*",
                   help="IDs explicitos dos atacantes (ex.: --malicious-ids 2 5)")
    g.add_argument("--attack-start-round", type=int)

    g = p.add_argument_group("reputacao")
    g.add_argument("--threshold", type=float, dest="ban_threshold", help="limiar de banimento")
    g.add_argument("--rep-alpha", type=float, dest="rep_alpha", help="alpha da media movel de R(t)")
    g.add_argument("--rep-initial", type=float, dest="rep_initial",
                   help="reputacao inicial de todos (0.5 = neutro, espelha o Anchor)")
    g.add_argument("--grace-rounds", type=int,
                   help="contribuicoes iniciais de cada participante imunes ao banimento")
    g.add_argument("--no-smooth-updates", action="store_true",
                   help="pontuar o update cru da rodada em vez da media movel dele "
                        "(volta ao comportamento anterior a correcao do vies de tamanho)")
    g.add_argument("--no-weighted-aggregation", action="store_true",
                   help="no cenario C, banir mas NAO ponderar o FedAvg pela reputacao")

    g = p.add_argument_group("execucao")
    g.add_argument("--scenarios", nargs="+", default=["A", "B", "C"], choices=["A", "B", "C"])
    g.add_argument("--backend", choices=["local", "flower"], default="local",
                   help="'flower' exige pip install 'flwr[simulation]' (Ray)")
    g.add_argument("--chain", choices=["simulado", "dry-run", "devnet"], default="simulado",
                   help="livro-razao: 'simulado' (JSON local, padrao), 'dry-run' (monta as "
                        "instrucoes Anchor sem enviar) ou 'devnet' (transacoes reais; exige "
                        "requirements-chain.txt e --authority-keypair)")
    g.add_argument("--authority-keypair", type=Path,
                   help="keypair da autoridade para --chain devnet (ex.: ~/.config/solana/id.json)")
    g.add_argument("--results-dir", type=Path)
    g.add_argument("--export-weights", nargs="?", const="ultima", default=None,
                   metavar="RODADAS",
                   help="grava os pesos no formato canonico (.awfl) em "
                        "results/pesos/<cenario>/ - e o arquivo que a instituicao sobe em "
                        "/painel/contribuir para gerar o mesmo hash do livro-razao. "
                        "Sem valor = so a ultima rodada; 'todas'; ou uma lista como '3,7'")
    g.add_argument("--log-level", choices=["DEBUG", "INFO", "WARNING"], default=None)
    g.add_argument("--device", choices=["cpu", "cuda"], default=None)
    return p.parse_args(argv)


def merge_config(cfg: dict, args: argparse.Namespace) -> dict:
    """Aplica as sobrescritas da linha de comando sobre o YAML (CLI tem prioridade)."""
    override = {
        "seed": args.seed,
        "federation": {
            "num_clients": args.num_clients,
            "rounds": args.rounds,
            "local_epochs": args.local_epochs,
            "local_steps": args.local_steps,
            "batch_size": args.batch_size,
            "learning_rate": args.learning_rate,
            "fraction_fit": args.fraction_fit,
        },
        "data": {
            "dataset": args.dataset,
            "partition": args.partition,
            "dirichlet_alpha": args.dirichlet_alpha,
            "train_subset": args.train_subset,
            "test_subset": args.test_subset,
        },
        "attack": {
            "type": args.attack_type,
            "malicious_fraction": args.malicious_fraction,
            "malicious_ids": args.malicious_ids,
            "start_round": args.attack_start_round,
        },
        "reputation": {
            "ban_threshold": args.ban_threshold,
            "alpha": args.rep_alpha,
            "initial": args.rep_initial,
            "smooth_updates": False if args.no_smooth_updates else None,
            "grace_rounds": args.grace_rounds,
            "weighted_aggregation": False if args.no_weighted_aggregation else None,
        },
        "output": {
            "results_dir": str(args.results_dir) if args.results_dir else None,
            "log_level": args.log_level,
        },
    }
    return deep_update(cfg, override)


# ---------------------------------------------------------------------------
# Execucao de um cenario
# ---------------------------------------------------------------------------


def resolve_export_rounds(valor: Optional[str], total_rodadas: int) -> Optional[List[int]]:
    """Traduz `--export-weights` na lista de rodadas a exportar.

    Cada artefato tem o tamanho do modelo (~841 KB aqui), entao exportar tudo em
    12 rodadas x 10 participantes daria ~100 MB. O padrao e so a ultima rodada;
    'todas' quando se quer o historico completo; e uma lista explicita quando se
    sabe exatamente qual rodada interessa - o caso da demonstracao, em que o
    arquivo a subir no painel e o da rodada do banimento, nao o da ultima.
    """
    if valor is None:
        return None
    valor = str(valor).strip().lower()
    if valor in ("ultima", "última", "last"):
        return [total_rodadas]
    if valor in ("todas", "all"):
        return list(range(1, total_rodadas + 1))
    try:
        return sorted({int(v) for v in valor.replace(" ", "").split(",") if v})
    except ValueError:
        raise SystemExit(
            f"--export-weights nao entende {valor!r}. Use 'todas', 'ultima' ou '3,7'."
        )


def resolve_local_steps(valor, partitions, batch_size: int) -> Optional[int]:
    """Resolve `federation.local_steps`, incluindo o modo 'auto'.

    'auto' = quantos passos de SGD o MAIOR participante daria em uma epoca.

    Nivelar por cima, e nao pela media, e o ponto. Um valor abaixo do maximo faz
    os participantes grandes treinarem menos do que treinariam com epocas — e
    como os atacantes tambem sao participantes, o ataque perde forca junto. Foi
    medido: com 40 passos (a media) a queda A->B despencou de 14,7 pp para
    0,95 pp e o cenario B deixou de demonstrar qualquer coisa. Com 'auto'
    (60 passos naquela seed) a queda foi a 24,9 pp, porque ninguem perde treino
    e os pequenos deixam de ser penalizados pelo ruido de amostras escassas.

    O preco de nivelar por cima e o participante pequeno repassar varias vezes
    pelos proprios dados (4x, no caso extremo medido) e sobreajustar um pouco
    mais. Entre um pequeno que sobreajusta e um pequeno banido por engano, o
    projeto escolhe o primeiro.
    """
    if valor is None or valor == 0 or valor is False:
        return None  # regime classico de epocas locais

    if isinstance(valor, str):
        if valor.strip().lower() != "auto":
            raise ValueError(f"local_steps invalido: {valor!r}. Use um inteiro, 'auto' ou null.")
        maior = max(len(p) for p in partitions)
        passos = max(1, -(-maior // max(1, batch_size)))  # divisao para cima
        logging.getLogger("awakefl").debug(
            "local_steps=auto -> %d passos (maior particao: %d amostras)", passos, maior
        )
        return passos

    return int(valor)


def build_chain(modo: str, num_clients: int, seed: int, keypair_path: Optional[Path]):
    """Monta o livro-razao pedido. `None` = o servidor usa o simulado.

    O `AnchorLedger` so e importado aqui dentro: o extra `[chain]` e opcional e
    o projeto inteiro precisa continuar rodando sem ele.
    """
    if modo == "simulado":
        return None

    from anchor_client import AnchorLedger, derive_simulation_keypairs

    participantes = derive_simulation_keypairs(num_clients, seed=seed)

    if modo == "dry-run":
        # Autoridade descartavel: em dry-run nada e assinado de fato.
        autoridade = derive_simulation_keypairs(1, seed=seed + 10_000)[0]
        return AnchorLedger(autoridade, participantes, dry_run=True)

    if not keypair_path:
        raise SystemExit("--chain devnet exige --authority-keypair (ex.: ~/.config/solana/id.json)")

    from solders.keypair import Keypair

    bytes_chave = json.loads(Path(keypair_path).expanduser().read_text(encoding="utf-8"))
    autoridade = Keypair.from_bytes(bytes(bytes_chave))
    return AnchorLedger(autoridade, participantes, dry_run=False)


def run_scenario(
    key: str,
    cfg: dict,
    data_bundle,
    *,
    attack: AttackConfig,
    malicious_ids: List[int],
    defense_enabled: bool,
    backend: str,
    device: str,
    export_dir: Optional[Path] = None,
    export_rounds: Optional[List[int]] = None,
    chain: Optional[object] = None,
) -> History:
    """Monta clientes e roda a federacao para um cenario."""
    xtr, ytr, xte, yte = data_bundle
    seed = int(cfg["seed"])
    fed, rep = cfg["federation"], cfg["reputation"]

    # Resetamos a semente antes de cada cenario: assim A, B e C compartilham a
    # mesma particao e a mesma inicializacao, isolando a variavel em estudo.
    set_seed(seed)
    partitions = build_partitions(
        xtr,
        ytr,
        num_clients=int(fed["num_clients"]),
        partition=cfg["data"]["partition"],
        dirichlet_alpha=float(cfg["data"]["dirichlet_alpha"]),
        seed=seed,
    )

    clients = build_clients(
        partitions,
        malicious_ids,
        attack,
        local_epochs=int(fed["local_epochs"]),
        local_steps=resolve_local_steps(fed.get("local_steps"), partitions, int(fed["batch_size"])),
        batch_size=int(fed["batch_size"]),
        learning_rate=float(fed["learning_rate"]),
        momentum=float(fed.get("momentum", 0.9)),
        device=device,
        seed=seed,
    )

    runner = run_flower_simulation if backend == "flower" else run_federated
    return runner(
        clients,
        xte,
        yte,
        scenario=key,
        rounds=int(fed["rounds"]),
        fraction_fit=float(fed["fraction_fit"]),
        defense_enabled=defense_enabled,
        reputation_cfg=rep,
        attack=attack,
        malicious_ids=malicious_ids,
        device=device,
        seed=seed,
        export_dir=str(export_dir) if export_dir else None,
        # So a ultima rodada: um artefato por participante ja basta para a
        # auditoria, e exportar as 12 rodadas encheria ~100 MB sem ganho.
        export_rounds=export_rounds,
        chain=chain,
    )


def main(argv=None) -> int:
    args = parse_args(argv)
    cfg = merge_config(load_config(args.config), args)

    logger = setup_logging(cfg["output"].get("log_level", "INFO"))
    seed = int(cfg["seed"])
    set_seed(seed)

    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    results_dir = Path(cfg["output"]["results_dir"])

    # -- Ataque e selecao dos atacantes (identicos em B e C) -----------------
    attack = AttackConfig.from_dict(cfg["attack"])
    if not attack.is_active:
        attack.type = "label_flipping"  # sem ataque nao ha o que comparar em B/C
        logger.warning("attack.type era 'none'; usando 'label_flipping' para os cenarios B e C.")
    malicious_ids = sorted(select_malicious(int(cfg["federation"]["num_clients"]), attack, seed))
    if not malicious_ids:
        logger.error("Nenhum participante malicioso selecionado. Ajuste malicious_fraction/ids.")
        return 1

    logger.info("=" * 78)
    logger.info("AwakeFL - simulacao de Federated Learning com reputacao on-chain")
    logger.info("device=%s | seed=%d | backend=%s", device, seed, args.backend)
    logger.info("modelo: CNN com %d parametros treinaveis", count_parameters(create_model()))
    logger.info("ataque=%s | atacantes=%s", attack.type, malicious_ids)
    logger.info("=" * 78)

    # -- Dados (carregados uma vez e reutilizados nos tres cenarios) ---------
    data_bundle = load_dataset(
        dataset=cfg["data"]["dataset"],
        data_dir=cfg["data"]["data_dir"],
        train_subset=int(cfg["data"]["train_subset"]),
        test_subset=int(cfg["data"]["test_subset"]),
        seed=seed,
    )

    # -- Definicao dos tres cenarios ---------------------------------------
    plan = {
        "A": dict(attack=AttackConfig(type="none"), malicious_ids=[], defense_enabled=False),
        "B": dict(attack=attack, malicious_ids=malicious_ids, defense_enabled=False),
        "C": dict(attack=attack, malicious_ids=malicious_ids, defense_enabled=True),
    }

    histories: Dict[str, History] = {}
    t_start = time.time()
    for key in args.scenarios:
        spec = plan[key]
        t0 = time.time()
        histories[key] = run_scenario(
            key, cfg, data_bundle, backend=args.backend, device=device,
            export_dir=(results_dir / "pesos" / key) if args.export_weights else None,
            export_rounds=resolve_export_rounds(args.export_weights, int(cfg["federation"]["rounds"])),
            # Um livro-razao por cenario: A, B e C sao federacoes distintas e
            # misturar as contribuicoes num so registro tornaria o extrato
            # impossivel de ler.
            chain=build_chain(args.chain, int(cfg["federation"]["num_clients"]),
                              seed, args.authority_keypair),
            **spec,
        )
        logger.info("Cenario %s concluido em %.1fs\n", key, time.time() - t0)

    # -- Relatorio ----------------------------------------------------------
    paths = save_report(histories, cfg, results_dir)
    _print_summary(logger, histories, results_dir, time.time() - t_start)
    logger.info("Relatorio: %s", paths["relatorio"])
    return 0


def _print_summary(logger: logging.Logger, histories: Dict[str, History], results_dir: Path, elapsed: float) -> None:
    """Resumo final no terminal (o mesmo conteudo do topo do relatorio.md)."""
    logger.info("=" * 78)
    logger.info("RESUMO COMPARATIVO  (tempo total: %.1fs)", elapsed)
    logger.info("=" * 78)
    for key in ("A", "B", "C"):
        h = histories.get(key)
        if not h:
            continue
        banned = h.ledger.banned_ids if h.ledger else []
        logger.info(
            "Cenario %s | acuracia final = %6.2f%% | melhor = %6.2f%% | banidos = %s",
            key, h.final_accuracy * 100, h.best_accuracy * 100, banned or "-",
        )

    a, b, c = histories.get("A"), histories.get("B"), histories.get("C")
    if a and b:
        logger.info("Impacto do ataque  (A -> B): %+.2f pp", (b.final_accuracy - a.final_accuracy) * 100)
    if b and c:
        logger.info("Ganho da defesa    (B -> C): %+.2f pp", (c.final_accuracy - b.final_accuracy) * 100)
    if c and c.ledger:
        d = c.ledger.detection_metrics(c.malicious_ids)
        logger.info("Deteccao: precisao=%.2f recall=%.2f F1=%.2f | rodadas ate banir: %s",
                    d["precision"], d["recall"], d["f1"], c.ledger.rounds_to_detect(c.malicious_ids))
    logger.info("Artefatos em: %s", results_dir.resolve())
    logger.info("=" * 78)


if __name__ == "__main__":
    sys.exit(main())
