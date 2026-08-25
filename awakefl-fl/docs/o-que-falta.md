# O Que Falta no AwakeFL — agenda de pesquisa

Biblioteca de perguntas em aberto. Cada item é uma coisa que **não sabemos** e
que dá para descobrir: o que já existe de evidência, o que falta medir, e o que
muda no projeto dependendo da resposta.

Não é lista de tarefas. Uma tarefa se marca como feita; um item daqui se
**responde**, e a resposta pode ser contrária ao que se esperava — o que também
é resultado.

Os documentos irmãos: **Anatomia do AwakeFL** (arquitetura), **Aritmética da
Reputação** (as contas), **Registro de decisões** (por que cada escolha,
`D01`–`D23`, `A01`–`A07`, `E01`–`E06`) e **Trajetória do Desenvolvimento** (a
história e a revisão de trabalhos relacionados).

---

## A regra desta agenda

Vários itens aqui chegaram por retirada: uma afirmação foi feita, não se
sustentou na conferência, e virou pergunta em vez de ser apagada.

A regra que produziu isso, e que vale para o que vier:

> **Não afirmar sobre terceiro o que não se mediu — nem a favor, nem contra.**

O caso que a estabeleceu foi a coluna de *slow poisoning* na tabela comparativa.
Ela atribuía "Parcial" ao AwakeFL sem experimento nenhum. A correção óbvia seria
trocar por "não avaliado" e manter a coluna — mas isso deixaria de pé as
avaliações dos **outros** sistemas, que também nunca medimos. Uma tabela que diz
"Krum: Não" e "AwakeFL: não avaliado" não é mais honesta que a original: é a
mesma afirmação sem evidência, só que agora enviesada contra nós.

Retirar a coluna inteira custou um argumento de venda e deixou a comparação
menor. É o preço de só afirmar o que dá para defender. E o item `P01` existe para
que essa coluna possa voltar um dia — com medição, para todos.

---

## Como cada item está escrito

**Pergunta** · o que se quer saber, em forma de pergunta respondível
**Por que ficou** · o motivo de não ter sido feito
**O que já existe** · a evidência disponível hoje, com a referência interna
**Como responder** · o desenho experimental mínimo
**O que muda** · o que a resposta destrava no projeto ou no texto

Prioridade: **[1]** responde algo que hoje está afirmado sem base · **[2]**
fecha um objetivo declarado da IC · **[3]** expande o escopo.

---

# Parte 1 — Perguntas que fecham buracos existentes

## P01 · A reputação pega envenenamento lento? [1]

**Pergunta.** Um atacante que envenena pouco a cada rodada — mantendo o score
individual dentro da faixa aceitável — acaba sendo detectado pela **memória** da
reputação, ou passa indefinidamente?

**Por que ficou.** Os quatro ataques implementados (`label_flipping`,
`gradient_poisoning`, `backdoor`, `free_rider`) são de efeito imediato. Nenhum
tem parâmetro de intensidade gradual.

**O que já existe.** Nada de medição direta. O que existe é razão teórica para
achar que *poderia* funcionar: a média móvel `R(t) = 0,5·R(t−1) + 0,5·S(t)`
(`D11`) acumula desvios pequenos ao longo do tempo, coisa que uma defesa que
julga só a rodada atual não faz. E razão teórica para achar que *não*: Fang et
al. (2020) constroem ataques que passam por detectores baseados em estatística
mimetizando clientes honestos.

**Como responder.**

1. Implementar um ataque com parâmetro de intensidade `ε` — o update honesto
   somado a uma fração `ε` do update envenenado.
2. Varrer `ε` de 0 a 1 e registrar, para cada valor: rodada de detecção (ou
   ausência dela), acurácia final, e o score médio do atacante.
3. Achar o `ε` crítico: o ponto em que o atacante deixa de ser pego dentro do
   horizonte de rodadas.
4. **Repetir o mesmo protocolo com os baselines** (`P03`). Sem isso, a resposta
   vale para o AwakeFL e para mais ninguém — e a tabela comparativa continua sem
   poder voltar.

**O que muda.** Devolve a coluna à tabela comparativa, com número em vez de
adjetivo. Se o `ε` crítico do AwakeFL for menor que o dos baselines, é o
resultado mais forte que o projeto pode produzir — seria evidência de que a
persistência da reputação compra alguma coisa que a agregação robusta não compra.
Se for igual, também é resultado: significa que o ganho do AwakeFL está só na
auditoria, e o texto precisa dizer isso.

## P02 · Quanto custa e quanto demora uma rodada na Solana? [1] [2]

**Pergunta.** Qual a latência e o custo em lamports de um ciclo completo —
`submit_contribution` + `validate_contribution` + `advance_round` — para N
participantes na Devnet?

**Por que ficou.** `--chain devnet` está implementado e validado em *dry-run*,
mas nunca enviou transação real: as carteiras de simulação não foram financiadas
nem registradas (Trajetória §7.5).

**O que já existe.** O cliente Anchor funciona, o PDA foi conferido contra a
conta real, e o programa está publicado
(`GhMhTkv7jeHMejEyypQaEFPqduHgXDSzE5g7jE3rXGRA`). Falta rodar.

**Como responder.** Financiar as carteiras pelo faucet, registrar os
participantes, rodar o experimento padrão com `--chain devnet` e cronometrar.
Reportar mediana e cauda (p95), não só a média — o que interessa numa cadeia é o
pior caso.

**O que muda.** Fecha o **objetivo específico 4** da proposta de IC, que hoje
está parcial. E transforma "custo baixo" de estimativa de arquitetura em
resultado medido — hoje é a nota de rodapé ² da tabela comparativa.

## P03 · Onde o AwakeFL fica em relação aos baselines da literatura? [1] [2]

**Pergunta.** Rodando o mesmo cenário, com a mesma partição e as mesmas sementes,
como o AwakeFL se compara a Krum, mediana pura e FLTrust?

**Por que ficou.** O projeto sempre se comparou consigo mesmo — cenário A contra
B contra C. Isso mede se a defesa funciona, não se ela funciona **melhor**.

**O que já existe.** Os números internos são sólidos: A = 98,25%, B = 86,60%,
C = 98,25%; em 10 sementes, precisão e recall 1,00 ± 0,00. Não há régua externa.

**Como responder.** Implementar as três regras como estratégias de agregação
alternativas e rodar o mesmo `run_experiments.py`. Krum e mediana são baratos.
FLTrust exige um *root dataset* de menos de 100 amostras no servidor — o que
quebra a premissa de zero dados, e essa quebra é justamente o ponto a favor do
AwakeFL (Trajetória §10.3).

**O que muda.** É o que separa "nossa defesa funciona" de "nossa defesa é
competitiva". Sem isso, um parecerista pergunta *comparado a quê?* e não há
resposta.

## P04 · O `n_samples` declarado importa? [1]

**Pergunta.** Quanta acurácia se perde se a agregação parar de confiar no número
de amostras auto-declarado pelo participante?

**Por que ficou.** O FedAvg pondera por `n_samples`, e esse campo **não é
verificado por ninguém** — é auto-declarado, como loss e acurácia. Um atacante
pode inflar o próprio peso mentindo.

**O que já existe.** O erro `E03` documenta o momento em que isso foi percebido:
uma frase de divulgação afirmava que o sistema não acreditava em nenhum campo
declarado, e era falsa exatamente por causa deste.

**Como responder.** Rodar o cenário padrão com três políticas de peso — peso
proporcional ao declarado (atual), peso uniforme, e peso proporcional **limitado**
(teto na mediana do grupo). Medir a acurácia dos três, e depois medir o ganho de
um atacante que declara 10× o próprio tamanho, em cada política.

**O que muda.** Se a perda por usar peso uniforme for pequena, dá para remover
uma superfície de ataque inteira de graça. Se for grande, o campo precisa de
verificação — e aí vira `P08`.

---

# Parte 2 — Perguntas que expandem o desenho

## P05 · Comitê de validadores, quórum e prazo de contestação [2]

**Pergunta.** Substituir a autoridade única por N validadores com quórum muda a
detecção, ou só a governança?

**Por que ficou.** O MVP precisava do fluxo completo funcionando antes de ganhar
protocolo de governança (Trajetória §7.2). Hoje há uma `Config.authority` única.

**O que já existe.** A discussão de desenho está registrada; o código, não. E há
referência externa forte: o **BPRFL** (2025) implementa consenso de reputação com
comitê de tamanho dinâmico ajustado pela reputação acumulada, e verificação de
consistência por intervalo de confiança contra conluio. O **BFLC** (2021) fez
antes, e a literatura registra a fraqueza dele: nós maliciosos entrando no comitê
e enviesando-o.

**Como responder.** Ler o BPRFL a fundo antes de projetar qualquer coisa — é o
vizinho mais próximo e já resolveu parte do problema. Depois, o desenho mínimo:
`validate_contribution` acumulando assinaturas até um quórum, e uma janela de
rodadas entre a penalidade e o banimento definitivo.

**O que muda.** Remove o ponto único de confiança na **decisão**. Não remove o
ponto único de confiança no **cálculo** — isso é `P06`.

## P06 · Verificação on-chain do score [3]

**Pergunta.** Dá para provar que o score publicado corresponde ao update
comprometido, sem colocar os pesos na cadeia?

**Por que ficou.** Recalcular cosseno contra a mediana de dez vetores de milhares
de dimensões dentro de um programa Solana está fora de orçamento computacional, e
os pesos não estão na cadeia (Trajetória §7.1).

**O que já existe.** O artefato canônico (`D14`) e o compromisso por hash
(`D22`) — a metade fácil do problema. O hash do navegador bate com o do servidor,
verificado no CI. O que falta é a prova de que o **cálculo** sobre aquele
artefato foi feito corretamente.

**Como responder.** Provavelmente ZKP sobre o cálculo do score. É pesquisa, não
implementação: começar levantando o que existe de prova de computação sobre
operações vetoriais grandes, e se o custo cabe numa transação Solana.

**O que muda.** Fecha o último ponto de confiança do desenho. É o item mais
ambicioso desta agenda e o mais provável de virar trabalho de mestrado em vez de
IC.

## P07 · Resistência a Sybil [3]

**Pergunta.** Qual o custo mínimo de identidade que torna o banimento permanente
economicamente relevante?

**Por que ficou.** O banimento permanente (`D09`) pressupõe que uma identidade
nova custe algo. Hoje custa o aluguel de uma conta de 66 bytes na Devnet —
praticamente nada.

**O que já existe.** A mitigação parcial da reputação inicial neutra (`D07`): o
atacante que recomeça volta ao meio da escala, não ao topo. O achado `A01` mostra
que essa escolha não custou detecção. E o campo `stake_amount` existe na conta
`Participant`, zerado — é o gancho que nunca foi usado.

**Como responder.** Modelar: dado um atacante que ganha `G` por rodada envenenando
e é banido em média na rodada `k`, qual stake `S` torna o ataque não-lucrativo?
Os números de `k` já existem (banimentos nas rodadas 6 e 7). Falta definir `G`.

**O que muda.** Sem isso, o banimento permanente é uma promessa de protocolo com
custo de evasão perto de zero — e essa é a crítica mais direta que se pode fazer
ao desenho.

## P08 · Contribuição proporcional ao porte [3]

**Pergunta.** Como medir o valor real que um participante agrega, em vez de
confiar no tamanho que ele declara?

**Por que ficou.** Adiado conscientemente: o hospital pequeno não tem como
inventar dados, mas também não consegue demonstrar tanto valor quanto o grande.
O MVP precisava andar (Trajetória §7.4).

**O que já existe.** Metade do problema foi resolvida sem querer. O viés que
punia participantes pequenos (`A02`) era de **treino**, não de contribuição: 14
passos de SGD contra 60 produziam de 1,8 a 2,2× mais ruído angular. Corrigido por
`D12` e `D13`, o gap de score caiu de 0,336 para −0,001. O que sobra é o
**incentivo**, não a detecção.

**Como responder.** Valor de Shapley, ou uma aproximação barata dele — medir a
acurácia do modelo global com e sem cada participante. Custo alto: exige
reagregar. Existe literatura de aproximação (o protocolo *Proof-of-Shapley* é um
ponto de partida).

**O que muda.** Destrava a discussão de recompensa, que hoje o projeto não tem.
E responde `P04` por outro caminho: se dá para medir contribuição, o `n_samples`
declarado deixa de importar.

## P09 · CIFAR-10, Flower e participação parcial [2]

**Pergunta.** Os resultados sobrevivem fora do MNIST, com backend Flower real e
participação parcial por rodada?

**Por que ficou.** A proposta de IC menciona MNIST **e** CIFAR-10; todos os
experimentos rodaram em MNIST. A estratégia Flower existe no código, mas o motor
local é o padrão, por reprodutibilidade. E `fraction_fit` está implementado e
nunca foi exercitado — todos os experimentos usaram participação total
(Trajetória §7.8).

**O que já existe.** O código dos três. Zero medição.

**Como responder.** Trocar o dataset é o mais barato dos três e o que mais rende:
CIFAR-10 é mais difícil, os updates são mais ruidosos, e a mediana de referência
fica menos estável. Há risco real de o detector piorar — o que seria um achado
honesto e publicável.

**O que muda.** Fecha uma promessa explícita da proposta. E a participação
parcial é o cenário realista: num consórcio de hospitais, ninguém aparece todas
as rodadas.

## P10 · Quantos participantes o detector precisa? [3]

**Pergunta.** Abaixo de quantos participantes a mediana de referência deixa de
ser confiável?

**Por que ficou.** Os experimentos padronizaram em 10 participantes. A demo usa 3.

**O que já existe.** O achado `A07`: com poucos participantes a detecção é mais
lenta, porque a mediana de referência fica mais frágil. Está registrado
qualitativamente, sem curva.

**Como responder.** Varrer N de 3 a 30 e medir a rodada de detecção e a taxa de
falso positivo em cada ponto. Barato — é o mesmo experimento repetido.

**O que muda.** Define o cenário de aplicação com números. "Serve para consórcio
cross-silo" é afirmação; "precisa de pelo menos N participantes" é resultado.

---

## P13 · O que a reputação deve dizer sobre quem está presente e calado? [2]

**Pergunta.** Um participante registrado que **nunca submete** mantém a
reputação inicial para sempre e continua recebendo o modelo global. A reputação
deveria decair por inatividade — e, se sim, sem recriar o viés contra
participantes pequenos?

**Por que ficou.** Nunca foi decidido; simplesmente não existe. A reputação só
se move quando uma contribuição é validada, dos dois lados: on-chain o
`apply_ema` só roda dentro de `validate_contribution`, e off-chain o
`apply_scores` itera apenas sobre quem submeteu naquela rodada. Quem não aparece
não é tocado.

**O que já existe.** O ataque `free_rider` implementado é *"submete um modelo
não treinado"*, e esse **é detectado** — o termo de magnitude simétrico (`D03`)
existe exatamente porque o cosseno sozinho não pega quem devolve o modelo quase
intocado. A variante *"não submete nada"* nunca foi modelada, e não há
experimento sobre ela.

**Como responder.** Primeiro medir o dano: rodar a federação com uma fração de
participantes inertes e ver quanto a acurácia final perde em relação ao cenário
A. Se a perda for pequena, a inatividade é um problema de justiça, não de
utilidade — e isso muda o remédio. Depois, se houver remédio, comparar duas
políticas: decaimento por rodada ausente contra peso de agregação proporcional à
atividade recente.

**O contra-argumento, que precisa entrar na análise.** Punir ausência recria, por
outra porta, o problema que o achado `A02` custou caro para descobrir: um
hospital honesto de 436 amostras sendo banido porque o detector media **porte**
em vez de comportamento. Num consórcio cross-silo, quem mais falta às rodadas é
justamente o participante pequeno — menos infraestrutura, menos pessoal, menos
dado novo por período. Um decaimento mal calibrado o expulsa, e o projeto volta
a ser um filtro de porte.

Por isso a hipótese a testar talvez não seja *"a ausência deve custar"*, e sim
*"a presença deve render"* — que é a `P08`, medir contribuição marginal, por
outro caminho.

**O que muda.** Define o que a reputação deste sistema significa. Hoje ela mede
**qualidade quando há contribuição**, não engajamento — e o texto da IC deveria
dizer isso explicitamente, porque um leitor assume o contrário.

**Custo técnico, se a resposta for decair.** Exigiria um campo tipo
`last_active_round` no `Participant`, levando a conta de 66 para 74 bytes —
migração de conta, com instrução de `realloc`. E como o programa não percorre
contas, o decaimento teria de ser disparado participante a participante pela
autoridade.

---

# Parte 3 — Perguntas sobre a própria revisão

## P11 · Existe FL sobre Solana publicado? [1]

**Pergunta.** O AwakeFL é o primeiro sistema de reputação para FL sobre Solana,
ou a busca é que foi insuficiente?

**Por que ficou.** A busca de 21/08/2026 não encontrou nenhum trabalho de FL
sobre Solana. Isso **não** é prova de inexistência — é uma busca informal, sem
string documentada e sem protocolo.

**O que já existe.** A revisão da Trajetória §10, que cobre a literatura de
blockchain + FL de forma razoável mas é declaradamente não-sistemática.

**Como responder.** Busca sistemática com string documentada, bases definidas
(IEEE Xplore, ACM DL, Scopus, arXiv), critérios de inclusão e exclusão
registrados, e o número de resultados em cada etapa. É o procedimento padrão de
revisão sistemática, e leva menos tempo do que parece.

**O que muda.** Só depois disso dá para escrever "até onde sabemos, o primeiro"
no texto da IC. Antes disso, a frase é indefensável — e é exatamente o tipo de
afirmação que um parecerista testa com uma busca de dois minutos.

## P12 · As referências herdadas conferem? [1]

**Pergunta.** Quantas outras referências do texto da IC têm o mesmo problema das
que já foram conferidas?

**Por que ficou.** A seção 12 da proposta trazia sete referências marcadas
`[VERIFICAR]`. Foram conferidas em 21/08/2026, e **quatro** tinham erro: um
título trocado (Yin et al.), uma descrição invertida (DFL), uma caracterização
desatualizada (BPRFL) e uma conclusão que a fonte não sustenta (o survey). Mais
uma ambiguidade de homônimo (FLChain). As referências da seção 13 continuam
marcadas `[A COMPLETAR]`.

**O que já existe.** A lista corrigida em Trajetória §10.9, com quinze
referências verificadas na fonte.

**Como responder.** Mesma coisa que foi feita: abrir cada uma, ler o abstract,
conferir título, autoria, ano e venue, e reescrever a descrição a partir do que o
artigo diz — não do que se lembra dele.

**O que muda.** Taxa de erro de 4 em 7 numa amostra é alta o suficiente para
supor que o resto tem o mesmo problema. Cada referência errada é um flanco na
defesa, e custa cinco minutos consertar.

---

## Índice por prioridade

**[1] Sustentam algo hoje afirmado sem base**
`P01` slow poisoning · `P02` custo e latência · `P03` baselines ·
`P04` `n_samples` declarado · `P11` busca sistemática · `P12` referências

**[2] Fecham objetivo declarado da IC**
`P02` (objetivo 4) · `P03` · `P05` comitê · `P09` CIFAR-10 e Flower ·
`P13` inatividade

**[3] Expandem o escopo**
`P06` ZKP · `P07` Sybil e stake · `P08` Shapley · `P10` escala mínima

Se for para escolher três: `P02` e `P03` porque fecham o objetivo 4 e dão régua
externa, e `P01` porque é a pergunta que só este desenho permite fazer.

---

*Última atualização: 24 de agosto de 2026.*
