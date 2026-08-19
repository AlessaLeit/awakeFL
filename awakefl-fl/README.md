# AwakeFL — camada off-chain (simulação de Federated Learning)

Esta pasta contém a **camada de modelo** do AwakeFL: uma simulação local de
Federated Learning (FL) em que N instituições treinam uma CNN sobre o MNIST sem
compartilhar dados, alguns participantes atacam a federação, e um módulo de
reputação detecta e bane esses atacantes.

A blockchain (programa Anchor na Solana) vive no repositório principal e não é
necessária para rodar nada aqui. O módulo [`onchain_interface.py`](onchain_interface.py)
**simula** o livro-razão: calcula o hash SHA-256 das contribuições e monta os
registros no formato exato que o programa Anchor vai receber, exportando tudo
para JSON. A lógica de reputação implementada em [`reputation.py`](reputation.py)
é a mesma que depois será espelhada em Rust.

---

## 1. Instalação

Requer **Python 3.10+** (testado em 3.13, Windows, CPU).

```bash
python -m venv .venv
```

Ative o ambiente (`.venv\Scripts\activate` no Windows, `source .venv/bin/activate` no Linux/macOS) e instale:

```bash
pip install -r requirements.txt
```

Se o PyTorch não instalar pelo PyPI padrão (típico em Windows sem GPU):

```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
```

O MNIST é baixado automaticamente na primeira execução para `./data`
(~50 MB, apenas uma vez).

---

## 2. Execução

Roda os três cenários de ponta a ponta e gera o relatório:

```bash
python run_experiments.py
```

Leva alguns minutos em CPU com a configuração padrão (10 participantes,
12 rodadas, 12 000 amostras de treino). Para uma rodagem rápida de sanidade
(~20 s), que só verifica que o pipeline inteiro roda:

```bash
python run_experiments.py --rounds 4 --clients 6 --train-subset 3000 --results-dir results_smoke
```

> Nessa rodagem curta **não espere ver banimento**: com `α = 0,5` a reputação
> leva ~5–7 rodadas para cruzar o limiar no `label_flipping`. Para ver a
> detecção acontecer, use a configuração padrão (12 rodadas) ou mais.

Ao final, os artefatos ficam em `results/`:

| Arquivo | Conteúdo |
| --- | --- |
| `relatorio.md` | relatório comparativo A/B/C, pronto para colar no texto da IC |
| `resultados.json` | todas as métricas por rodada, para reanálise |
| `convergencia.png` | curvas de acurácia dos três cenários |
| `reputacao_B.png` / `reputacao_C.png` | evolução de R(t) de cada participante |
| `ledger_A/B/C.json` | livro-razão simulado (hashes, métricas, banimentos) |

### Os três cenários

| Cenário | Atacante | Defesa | O que prova |
| --- | --- | --- | --- |
| **A — baseline** | não | não | teto de acurácia que a federação honesta alcança |
| **B — ataque** | sim | **não** | que o ataque realmente causa dano |
| **C — defesa** | sim | sim | que a reputação detecta, bane e recupera a acurácia |

Os três partem da **mesma seed, mesma partição de dados e mesma inicialização
do modelo**. Entre B e C a única variável que muda é a defesa estar ligada —
é isso que permite atribuir a diferença de acurácia ao mecanismo de reputação
e não ao acaso.

### Parâmetros

Tudo em [`config.yaml`](config.yaml), sobrescrevível pela linha de comando
(precedência: **CLI > config.yaml > defaults do código**).

```bash
# outro ataque, mais rodadas, atacantes escolhidos a dedo
python run_experiments.py --attack backdoor --rounds 20 --malicious-ids 2 5

# dados IID, limiar de banimento mais rígido, outra seed
python run_experiments.py --partition iid --threshold 0.5 --seed 7

# só o baseline e a defesa
python run_experiments.py --scenarios A C
```

Principais flags (`python run_experiments.py --help` lista todas):

- **federação:** `--clients`, `--rounds`, `--local-epochs`, `--batch-size`, `--lr`, `--fraction-fit`
- **dados:** `--dataset {mnist,fashion_mnist}`, `--partition {iid,non_iid}`, `--alpha` (Dirichlet), `--train-subset`, `--test-subset`
- **ataque:** `--attack {label_flipping,gradient_poisoning,backdoor,free_rider}`, `--malicious-fraction`, `--malicious-ids 2 5`, `--attack-start-round`
- **reputação:** `--threshold` (limiar de banimento), `--rep-alpha`, `--grace-rounds`, `--no-weighted-aggregation`
- **execução:** `--scenarios A B C`, `--backend {local,flower}`, `--results-dir`, `--seed`, `--device`, `--log-level`

**Backends.** O padrão é `local`: as rodadas são executadas sequencialmente no
processo atual, sem Ray e sem rede, o que garante reprodutibilidade bit a bit.
`--backend flower` roda a mesma lógica dentro do `flwr.simulation.start_simulation`
com a estratégia `AwakeFLStrategy` (herda de `FedAvg` e injeta a reputação no
`aggregate_fit`) — serve para mostrar que a defesa é um plug-in de estratégia
Flower de verdade. Ele exige o extra com Ray:

```bash
pip install "flwr[simulation]>=1.7"
```

### Testes

```bash
pytest
```

42 testes cobrindo a fórmula de reputação, o score de consistência, o
banimento irreversível, cada tipo de ataque e o determinismo do hash.

---

## 3. Como o sistema funciona

### Ordem das operações em uma rodada

```
treino local  ->  deltas (w_local - w_global)  ->  S(t)  ->  R(t)  ->  banimento  ->  agregação
```

O banimento acontece **antes** da agregação: o update que derrubou a reputação
abaixo do limiar já não entra no modelo global daquela rodada.

### Reputação — escala e fórmula

Reputação **R ∈ [0, 1]**: `1.0` = plenamente confiável (valor inicial de
**todos** os participantes, presunção de boa-fé), `0.0` = sem credibilidade.
Perde-se reputação por evidência. On-chain isso vira um `u64` em ponto fixo
(1.0 ≡ 10 000 *basis points*), porque a Solana não trabalha com float — a
conversão está em `reputation.to_basis_points()`.

**Score de consistência S(t) ∈ [0, 1]** mede o quanto a contribuição combina
com o consenso dos participantes ainda confiáveis, combinando dois sinais:

```
S(t) = w_dir · clip( max(0, cos) / cos_mediano )  +  w_mag · min(r, 1/r)
```

- **Direção** — similaridade de cosseno entre o update do participante e a
  **mediana por coordenada** dos updates confiáveis. Escolhemos cosseno em vez
  de distância euclidiana porque ele é **invariante à escala**: em cenário
  não-IID um hospital com mais dados produz naturalmente um update maior, e
  puni-lo por isso seria falso positivo. A referência é a mediana (não a média)
  porque a mediana tem *breakdown point* de 50%: com média, um único atacante
  com update amplificado 100× deslocaria a própria referência e passaria a ser
  "o consenso".
- **Magnitude** — razão `r` entre a norma do update e a norma mediana do grupo,
  dobrada em [0,1] por `min(r, 1/r)`. É simétrica de propósito: pune updates
  gigantes (gradient poisoning, model replacement do backdoor) **e** updates
  minúsculos (free-rider, que praticamente não treina — e cuja direção aleatória
  o cosseno sozinho não pegaria).

Os dois termos são **calibrados pela mediana da própria rodada**. Isso é
essencial: em dados IID os updates honestos têm cosseno ~0,9 entre si; em
não-IID esse valor cai para ~0,4 sem que ninguém seja malicioso. Um limiar
absoluto ou baniria a federação inteira no caso não-IID, ou não pegaria ninguém
no caso IID. Calibrando, S(t) responde "quão pior que o participante mediano
você está nesta rodada", pergunta invariante ao regime de dados.

**Atualização:**

```
R(t) = α · R(t-1) + (1 - α) · S(t)        com α = 0.5  (config: reputation.alpha)
```

Média móvel exponencial: com α = 0,5 o peso de cada rodada cai pela metade a
cada rodada seguinte. O sistema perdoa um azar pontual (um batch ruim), mas um
comportamento anômalo sustentado derruba R geometricamente.

**Banimento:** quando `R(t) < ban_threshold` (padrão 0,4), a reputação é
**dividida por 10** e o participante é banido **permanentemente, sem reversão** —
não volta a ser amostrado nem entra na agregação em nenhuma rodada futura. As
`grace_rounds` iniciais (padrão 1) ficam imunes, porque nas primeiras rodadas o
modelo global ainda está instável e todos parecem inconsistentes.

Há ainda um **veto por norma** (`reputation.norm_veto_ratio`, padrão 2,5): um
update mais de 2,5× maior (ou menor) que a norma mediana perde o crédito do
termo de direção. Isso fecha a brecha do *model replacement*, em que o atacante
alinha a direção com o consenso mas amplifica a magnitude para dominar o FedAvg.

No **cenário B a reputação continua sendo calculada**, só não é aplicada —
por isso `reputacao_B.png` existe e é útil: ele mostra que o sinal de detecção
já estava lá, e que a diferença para C é apenas a decisão de agir sobre ele.

### Ataques implementados

| Ataque | Camada | O que faz |
| --- | --- | --- |
| `label_flipping` | dados | troca os rótulos locais (`y -> 9-y` por padrão, ou um `flip_map` explícito) |
| `backdoor` | dados + pesos | estampa um gatilho branco 3×3 no canto inferior direito, força a classe alvo e amplifica o update (*model replacement*) |
| `gradient_poisoning` | pesos | inverte e amplifica o update enviado (`poison_scale`) |
| `free_rider` | pesos | não treina: devolve o modelo global com ruído gaussiano |

Ataques de **dados** são sutis (o update continua bem comportado em norma) e
difíceis para defesas baseadas só em magnitude; ataques de **pesos** são
agressivos e o detector pega rápido. Os dois extremos estão cobertos de
propósito, para a IC poder discutir o trade-off.

Para o backdoor, o relatório também reporta a **ASR** (*attack success rate*):
a fração das amostras com gatilho classificadas como a classe alvo — a acurácia
limpa pode ficar intacta enquanto a ASR sobe, que é exatamente o que torna o
backdoor perigoso.

### Interface on-chain

Cada contribuição gera um registro `(participant, round, weights_hash, metrics, score, reputation_bps)`.
A cadeia **não guarda os pesos** (caros e privados) — guarda o compromisso
criptográfico deles, e depois qualquer auditor recalcula o hash a partir do
artefato off-chain e prova que aquele participante submeteu exatamente aquilo
naquela rodada. O hash é canônico e determinístico (tensores na ordem do
`state_dict`, float32 little-endian com shape prefixado), contrato que o lado
Rust precisa reproduzir — a especificação está no docstring de `hash_weights()`.

As métricas são **declaradas** pelo participante, ou seja, potencialmente
mentira. É justamente por isso que a reputação é calculada a partir do *update*
e não do que o cliente diz.

As funções `anchor_submit_contribution()`, `anchor_update_reputation()`,
`anchor_ban_participant()` e `anchor_fetch_reputation()` são *stubs*
documentados: mantêm a assinatura da chamada real ao programa Anchor, para que
trocar `SimulatedOnChainLedger` por um cliente Solana de verdade não mude nada
no resto do código.

---

## 4. Como interpretar o relatório

1. **A vs B — o ataque funciona?** A acurácia final de B deve cair
   visivelmente em relação a A. Se não cair, o ataque está fraco demais:
   aumente `malicious_fraction` ou `poison_scale`.
2. **B vs C — a defesa funciona?** A curva de C deve descolar de B logo após as
   linhas tracejadas do gráfico (as rodadas de banimento) e voltar a se
   aproximar de A. Esse é o resultado central do trabalho.
3. **Precisão / recall — qual o custo da defesa?** Recall 1,0 com precisão 1,0
   significa todos os atacantes banidos e nenhum honesto punido. Precisão < 1,0
   indica falso positivo, normalmente sintoma de partição não-IID agressiva
   (`dirichlet_alpha` baixo) ou de `ban_threshold` alto demais.
4. **Rodadas até a detecção** — quantas rodadas o atacante conseguiu envenenar
   antes de ser pego. É a métrica de *latência* da defesa: ataques de pesos
   costumam cair em 2–3 rodadas, ataques de dados demoram mais.
5. **Curva de reputação** — mostra o mecanismo em si: R(t) do atacante decai
   geometricamente por causa da média móvel, cruza o limiar e é dividida por 10
   no banimento; os honestos ficam em um patamar alto e estável.

Resultado de referência (configuração padrão, `label_flipping`, seed 42):
A = 98,65% · B = 83,95% · C = 97,95%, com precisão e recall de detecção = 1,00.

---

## 5. Estrutura dos arquivos

| Arquivo | Papel |
| --- | --- |
| [`config.yaml`](config.yaml) | todos os parâmetros dos experimentos, comentados |
| [`model.py`](model.py) | CNN do MNIST (2 conv + 2 FC) e rotinas de treino/teste |
| [`data.py`](data.py) | carga do dataset e particionamento IID / Dirichlet não-IID |
| [`client.py`](client.py) | cliente Flower: recebe o modelo global, treina local, devolve pesos |
| [`attacks.py`](attacks.py) | os quatro ataques e a seleção dos participantes maliciosos |
| [`server.py`](server.py) | FedAvg + orquestração da rodada; backend local e estratégia Flower |
| [`reputation.py`](reputation.py) | **S(t), R(t), limiar e banimento** — o módulo a ser portado para Rust |
| [`onchain_interface.py`](onchain_interface.py) | hash SHA-256, livro-razão simulado e stubs do Anchor |
| [`report.py`](report.py) | gráficos (PNG) e o relatório comparativo em Markdown |
| [`run_experiments.py`](run_experiments.py) | orquestra os cenários A, B e C |
| [`utils.py`](utils.py) | seed, logging e álgebra sobre listas de pesos |
| [`tests/`](tests) | testes unitários de reputação e ataques |

`reputation.py` é deliberadamente **puro**: opera sobre vetores NumPy, não
conhece PyTorch nem Flower e não tem estado global. Assim dá para portar para
Rust praticamente linha a linha e testar isoladamente com `pytest`.
