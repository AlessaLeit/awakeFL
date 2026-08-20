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

- **federação:** `--clients`, `--rounds`, `--local-steps`, `--local-epochs`, `--batch-size`, `--lr`, `--fraction-fit`
- **dados:** `--dataset {mnist,fashion_mnist}`, `--partition {iid,non_iid}`, `--alpha` (Dirichlet), `--train-subset`, `--test-subset`
- **ataque:** `--attack {label_flipping,gradient_poisoning,backdoor,free_rider}`, `--malicious-fraction`, `--malicious-ids 2 5`, `--attack-start-round`
- **reputação:** `--threshold` (limiar de banimento), `--rep-alpha`, `--rep-initial`, `--grace-rounds`, `--no-smooth-updates`, `--no-weighted-aggregation`
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

66 testes cobrindo a fórmula de reputação, o score de consistência, o
banimento irreversível, cada tipo de ataque, o determinismo do hash e a
derivação de PDA do cliente Anchor.

Um teste de rede, desligado por padrão, confere que a derivação de PDA aponta
para a conta real na Devnet:

```bash
AWAKEFL_DEVNET=1 pytest tests/test_anchor_client.py
```

---

## 3. Como o sistema funciona

### Ordem das operações em uma rodada

```
treino local (passos fixos)  ->  delta (w_local - w_global)
     ->  delta suavizado  ->  S(t)  ->  R(t)  ->  banimento  ->  agregação
```

Duas decisões de ordem que importam:

- o **banimento acontece antes da agregação** — o update que derrubou a
  reputação abaixo do limiar já não entra no modelo global daquela rodada;
- o **delta é suavizado antes de virar nota**, e não depois. Suavizar a nota não
  desfaz o ruído; suavizar o vetor, sim.

### Reputação — escala e fórmula

Reputação **R ∈ [0, 1]**: `1.0` = plenamente confiável, `0.5` = **neutro, valor
inicial de todos**, `0.0` = sem credibilidade. Todo participante entra em 0,5 e
precisa *ganhar* a confiança do grupo (na prática sobe para ~0,93 em 4 rodadas).

Esse valor espelha `INITIAL_REPUTATION = 500` do programa Anchor, na escala
0..=1000 — a Solana não trabalha com float, então tudo que cruza a fronteira
vira inteiro (`reputation.to_program_scale()`; `to_basis_points()` dá a
representação interna de maior precisão, com 10 000 ≡ 1.0).

**Por que neutro e não 1,0?** Porque `register_participant` é aberto: qualquer
wallet se registra pelo custo do rent de uma conta de 66 bytes. Se o
recém-chegado nascesse com reputação máxima, o banimento permanente valeria
zero — bastaria gerar outra wallet e voltar com a ficha limpa (*whitewashing*).
Começar no meio da escala faz a identidade acumulada valer alguma coisa. O preço
disso é o *cold start*, tratado pelo período de graça.

> **Achado experimental.** O valor inicial **não é** um parâmetro de detecção.
> Reaplicando a EMA sobre os mesmos S(t) observados, sair de R₀ = 1,0 para
> R₀ = 0,5 antecipou o banimento em 1 rodada em apenas 1 dos 3 atacantes — o
> peso de R₀ cai para 3% em 5 rodadas e R(t) converge para a média de S(t)
> independentemente de onde começou. R₀ governa resistência a whitewashing e
> proteção ao recém-chegado, não latência de detecção. Reproduza a comparação
> com `--rep-initial 1.0`.

### Treino local nivelado por cima (`local_steps: auto`)

Todos os participantes dão o **mesmo número de passos de SGD** por rodada, e esse
número é o de uma época do **maior** participante. Com épocas fixas, quem tem 586
amostras dá 18 passos e quem tem 1.928 dá 60 — o update do primeiro chega ~1,8×
mais ruidoso, e o detector lê esse ruído como divergência. Na prática isso bania
participantes honestos por serem pequenos (veja `analise_tamanho.py`).

> **Cuidado com o valor.** Nivelar pela *média* fecha o viés e quebra o
> experimento junto: com 40 passos, a queda A→B despencou de 14,7 pp para
> **0,95 pp**, porque os atacantes — que estavam entre os participantes grandes —
> perderam um terço dos passos de envenenamento. Nivelando por cima ninguém
> treina menos do que treinaria, e só os pequenos ganham.

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

**Duas médias móveis, com papéis diferentes.** Antes de pontuar, o update de
cada participante também passa por uma média móvel (`reputation.smooth_updates`,
padrão ligado). Não é redundância:

```
média( cos(direção + ruído) )   <   cos( média(direção + ruído) )
        ↑ suavizar o SCORE            ↑ suavizar o UPDATE
```

O ruído de amostragem tem média zero e se cancela ao somar updates de várias
rodadas; um viés malicioso, por ser sistemático, atravessa a média intacto.
Suavizar só o score não recupera nada — a informação já foi descartada na
conversão para nota. A do update cancela ruído; a de R(t) dá memória à
reputação.

**Banimento:** quando `R(t) < ban_threshold` (padrão 0,4), a reputação é
**dividida por 10** e o participante é banido **permanentemente, sem reversão** —
não volta a ser amostrado nem entra na agregação em nenhuma rodada futura.

As `grace_rounds` (padrão 2) protegem as primeiras contribuições **de cada
participante**, contadas por *tempo de casa* (`contrib_count`) e não pelo número
global da rodada. Isso cobre dois casos: o início da federação, quando o modelo
global ainda está instável e todos parecem inconsistentes; e quem entra no meio
do caminho — com graça por rodada global, um hospital que se registrasse na
rodada 50 entraria sem proteção nenhuma, em R = 0,5, a um passo do limiar, justo
quando é o único carregando aquela distribuição de dados. `contrib_count` é
exatamente o campo que a conta `Participant` já mantém on-chain. Na simulação,
em que todos entram na rodada 1, os dois critérios coincidem.

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

Há um *stub* documentado para cada instrução do programa Anchor
(`GhMhTkv7jeHMejEyypQaEFPqduHgXDSzE5g7jE3rXGRA` na Devnet), com o mesmo nome e
os mesmos argumentos, mais os derivadores de PDA:

| Stub | Instrução | Quem assina |
| --- | --- | --- |
| `anchor_initialize` | `initialize()` | autoridade |
| `anchor_register_participant` | `register_participant()` | a instituição |
| `anchor_submit_contribution` | `submit_contribution(update_hash, n_samples, loss, accuracy)` | a instituição |
| `anchor_validate_contribution` | `validate_contribution(score)` | autoridade |
| `anchor_penalize_participant` | `penalize_participant(reason_code)` | autoridade |
| `anchor_advance_round` | `advance_round()` | autoridade |
| `anchor_fetch_participant` | leitura da conta `Participant` | — |

A **autoridade é o agregador da rodada**, ou seja, o `server.py` deste projeto.
O servidor envia apenas o **score**, nunca a reputação já calculada: a fórmula
`R(t) = (R(t-1) + S(t)) / 2` roda dentro do programa, em aritmética inteira, e é
isso que torna o resultado auditável por terceiros.

Duas armadilhas de integração já documentadas nos stubs: `update_hash` viaja
como **String hexadecimal** de 64 chars (não bytes), e o PDA da contribuição usa
como seed o **PDA do Participant**, não a wallet dona — derivar da wallet gera um
endereço válido que o programa rejeita com `ConstraintSeeds`.

### Artefato canônico e auditoria de ponta a ponta

A tela `/painel/contribuir` da web calcula SHA-256 dos **bytes crus** do arquivo
que a instituição sobe. Para que esse número seja o mesmo que o servidor
registra, o Python grava os pesos exatamente no byte stream que ele hasheia:

```bash
python run_experiments.py --export-weights
```

Isso produz `results/pesos/<cenário>/rodadaNN_participanteNN.awfl` e um índice
`artifacts` dentro do `ledger_*.json` associando cada arquivo ao hash esperado.
Qualquer outro formato (`torch.save`, `.npz`, pickle) carrega metadados, ordem
de chaves ou compressão que mudam os bytes e, portanto, o hash.

O roteiro da auditoria manual: pegue um `.awfl`, suba em `/painel/contribuir`,
e o hash que aparece na tela tem que ser idêntico ao `weights_hash` daquela
contribuição no livro-razão. O formato é auto-descritivo (carrega os *shapes*),
então `load_weights()` reconstrói os tensores sem precisar do código do modelo —
é o que permite a um terceiro auditar sem confiar em ninguém.

### Enviando de verdade para a Solana

[`anchor_client.py`](anchor_client.py) implementa o `AnchorLedger`, que tem a
**mesma interface** do `SimulatedOnChainLedger` — o loop federado não sabe com
qual dos dois está falando. Instale o extra e escolha o modo:

```bash
pip install -r requirements-chain.txt
```

| `--chain` | O que faz |
| --- | --- |
| `simulado` | padrão: JSON local, instantâneo, sem custo |
| `dry-run` | monta as instruções e deriva os PDAs reais, **sem enviar nada** |
| `devnet` | transações de verdade (exige `--authority-keypair`) |

```bash
# confere a integração inteira sem gastar SOL nem depender da rede
python run_experiments.py --scenarios C --chain dry-run --rounds 2 --clients 3
```

### Execução real na Devnet, do começo ao fim

`bootstrap_devnet.py` monta o mundo antes da corrida: carteiras, saldo e
registro. Todos os passos são idempotentes — rodar duas vezes não duplica nada.

```bash
python bootstrap_devnet.py plano     --participants 3 --rounds 3   # custo estimado
python bootstrap_devnet.py checar    --participants 3              # só leitura
python bootstrap_devnet.py financiar --participants 3              # airdrop
python bootstrap_devnet.py registrar --participants 3              # register_participant
```

Com tudo pronto:

```bash
python run_experiments.py --chain devnet --scenarios C \
    --clients 3 --rounds 3 --malicious-ids 2 \
    --authority-keypair ~/.config/solana/id.json
```

E o resultado aparece em `/painel/extrato` e `/devnet` do site, lidos direto da
chain — nenhum arquivo intermediário no caminho.

**Comece pequeno.** 3 participantes × 3 rodadas são 24 transações e ~0,021 SOL.
A configuração padrão (10 × 12) seriam 262 transações e ~0,23 SOL, vários
minutos de execução, e provavelmente limite de taxa no RPC público. O rent das
contas `Contribution` **não volta** — o programa não tem instrução de `close`.

> **A rodada é da chain, não do servidor.** O programa deriva o PDA da
> contribuição a partir de `config.current_round`, então o cliente lê esse
> valor da chain e chama `advance_round` ao fim de cada rodada. Derivar o PDA
> do contador local do FL parece funcionar até a primeira transação real, que
> falha com `ConstraintSeeds` — e o dry-run não pega, porque não confere nada
> contra o programa.

Três coisas que valem saber antes de ir para a Devnet:

1. **Cada participante precisa da própria wallet.** `submit_contribution` é
   assinada pela *instituição*, não pela autoridade — é ela que se compromete
   com o próprio hash. `derive_simulation_keypairs()` gera as N keypairs de
   forma determinística (para o experimento ser reproduzível), mas **financiar
   cada uma é um passo manual** (`solana airdrop`): há rent de conta (~0,0016
   SOL por `Contribution`) e taxa por transação.
2. **São duas transações por contribuição**, nesta ordem: a instituição submete,
   a autoridade valida. Inverter faz a validação referenciar uma conta que
   ainda não existe.
3. **O servidor envia só o score**, nunca a reputação calculada. A fórmula
   `R(t) = (R(t-1) + S(t)) / 2` roda dentro do programa — é isso que torna o
   resultado auditável por terceiros em vez de "confie no meu servidor".

O IDL é o **mesmo arquivo que o site usa** (`web/src/lib/idl/awakefl.json`).
Como o anchorpy ainda lê o formato anterior ao Anchor 0.30, a conversão acontece
em memória (`para_idl_legado()`) em vez de existir uma segunda cópia do IDL para
divergir.

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
A = 98,25% · B = 86,60% · C = 98,25%, com precisão e recall de detecção = 1,00
e banimentos nas rodadas 6, 7 e 7. A defesa recupera **exatamente** o baseline.

---

## 5. Resultado com desvio padrão

Uma execução é anedota. `sweep.py` roda o experimento inteiro em N sementes
independentes e agrega:

```bash
python sweep.py --seeds 10
```

Saída em `results_sweep/sumario.md`, com tabelas prontas para o texto e a curva
de convergência média com faixa de ±1 desvio padrão. Também varre ataques:
`--attacks label_flipping gradient_poisoning backdoor free_rider`.

Referência com os padrões atuais (10 sementes, `label_flipping`, 3 atacantes):

| Cenário | Acurácia final |
| --- | --- |
| A — baseline | 98,23% ± 0,33 |
| B — ataque | 69,13% ± 26,78 |
| C — defesa | **98,02% ± 0,35** |

Precisão **1,00 ± 0,00** · recall **1,00 ± 0,00** · 30 de 30 atacantes banidos,
em 5,40 ± 0,68 rodadas.

O resultado central não é o ganho médio de +28,9 pp — é que **o desvio de C
(±0,35) é tão apertado quanto o do baseline (±0,33), contra ±26,8 do cenário
atacado**. A defesa não recupera acurácia "em média": ela devolve
previsibilidade.

### Viés de tamanho

`analise_tamanho.py` mede se o detector está punindo participantes por terem
poucos dados — a falha que motivou `local_steps: auto` e `smooth_updates`:

```bash
python analise_tamanho.py results_sweep --por-rodada
```

| 10 sementes | S pequenos | S grandes | lacuna | precisão | falsos+ |
| --- | --- | --- | --- | --- | --- |
| antes das correções | 0,592 | 0,927 | 0,336 | 0,97 | 1 |
| **com os padrões atuais** | **0,945** | **0,945** | **−0,001** | **1,00** | **0** |

A lacuna precisa cair **sem** que precisão ou recall caiam junto — senão a
"correção" virou uma brecha de segurança. É por isso que o script reporta as
três coisas na mesma tabela.

---

## 6. Estrutura dos arquivos

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
| [`anchor_client.py`](anchor_client.py) | cliente Anchor real (`--chain devnet`), mesmo contrato do ledger simulado |
| [`sweep.py`](sweep.py) | varredura de sementes e ataques, com média ± desvio padrão |
| [`analise_tamanho.py`](analise_tamanho.py) | mede o viés do detector contra participantes pequenos |
| [`bootstrap_devnet.py`](bootstrap_devnet.py) | prepara carteiras, saldo e registro para rodar na Devnet |
| [`tests/`](tests) | testes unitários de reputação e ataques |

`reputation.py` é deliberadamente **puro**: opera sobre vetores NumPy, não
conhece PyTorch nem Flower e não tem estado global. Assim dá para portar para
Rust praticamente linha a linha e testar isoladamente com `pytest`.
