# Registro de decisões — AwakeFL

Caderno de bordo do desenvolvimento. Guarda **por que** cada coisa é como é —
incluindo as alternativas descartadas, os números que decidiram as dúvidas e os
erros que só apareceram depois de medir.

Existe para que, meses depois, a pergunta *"por que a reputação começa em 0,5?"*
tenha resposta escrita em vez de arqueologia de commits.

---

## Como usar

**Para escrever a IC.** As decisões estão numeradas (`D01`, `D02`…) para poderem
ser citadas no texto. Os achados experimentais (`A01`, `A02`…) trazem os números
e como reproduzi-los.

**Para continuar o desenvolvimento.** Antes de mudar um parâmetro, procure-o
aqui. Vários valores que parecem arbitrários foram escolhidos contra uma
alternativa específica, e mexer neles reabre um problema já resolvido.

**Para acrescentar.** Formato de cada entrada: *contexto* (o problema),
*alternativas* (o que mais foi considerado), *escolha* e *consequência* (o que
se paga por ela). Se não houver alternativa descartada, provavelmente não era
uma decisão — era só código.

Os documentos irmãos: **Anatomia do AwakeFL** (arquitetura), **Aritmética da
Reputação** (as contas passo a passo), **Trajetória do Desenvolvimento** (a
história em prosa: em que ordem tudo foi construído e o que ficou de fora) e
**O Que Falta no AwakeFL** (trabalho futuro).

---

# Parte 1 — Decisões de projeto

## Score de consistência

### D01 · Cosseno em vez de distância euclidiana

**Contexto.** Medir o quanto a contribuição de um participante combina com o
consenso.

**Alternativas.** Distância euclidiana entre o update e a referência; cosseno.

**Escolha.** Cosseno, e o tamanho vira uma medida separada (D03).

**Consequência.** O cosseno é invariante à escala. Um hospital com mais dados
produz um update naturalmente maior; com distância euclidiana ele pareceria
divergente **por ser grande**, e seria punido por isso. Separar direção de
tamanho permite pesá-los diferente — e foi o que possibilitou o veto de norma
(D04) sem endurecer o critério para quem está dentro da faixa.

### D02 · Mediana por coordenada, não média

**Contexto.** Construir o vetor que representa "o consenso" da rodada.

**Alternativas.** Média dos updates; mediana coordenada a coordenada.

**Escolha.** Mediana.

**Consequência.** A média tem *breakdown point* zero: um único atacante que
amplifique o próprio update em 100× arrasta a média para perto de si e **vira
ele o consenso** — todos os honestos passariam a parecer divergentes. A mediana
tem breakdown point de 50%: só é corrompível controlando mais da metade dos
participantes. No exemplo de 5 participantes documentado na *Aritmética*, a
mediana fica em `[0,95 · 0,30]` enquanto a média já foi arrastada para
`[0,63 · 0,31]` por um atacante só.

### D03 · Termo de magnitude simétrico: `min(r, 1/r)`

**Contexto.** Punir updates com tamanho anômalo.

**Alternativas.** Punir só updates grandes; punir os dois extremos.

**Escolha.** Simétrico.

**Consequência.** Punir update grande é intuitivo (envenenamento por
amplificação). Punir update minúsculo parece estranho até aparecer o
**free-rider**, que não treina e devolve o modelo quase intocado. O cosseno
sozinho não o pega: a direção do ruído dele é aleatória e às vezes calha de
apontar para o lado certo. É o termo de magnitude que denuncia.

### D04 · Veto de norma zera o crédito de direção, não desconta

**Contexto.** Um atacante que aponte na direção certa mas amplifique a
magnitude domina a agregação — é o ataque de *model replacement*, usado para
injetar backdoor sem divergir em ângulo.

**Alternativas.** Descontar o crédito de direção proporcionalmente ao exagero;
zerá-lo acima de um limiar.

**Escolha.** Zerar, acima de 2,5× (ou abaixo de 1/2,5×) a norma mediana.

**Consequência.** Um desconto proporcional deixaria o atacante **otimizar** a
amplificação até o ponto em que o ganho de influência compensasse a perda de
nota. Zerar remove o cálculo: não existe amplificação que valha a pena. Na demo
de 3 participantes, foi exatamente o veto que derrubou o atacante — razão de
norma 2,67, score 375.

### D05 · Calibração pela mediana da rodada, não por limiar absoluto

**Contexto.** Quanto os honestos concordam entre si não é constante: com dados
IID o cosseno entre updates honestos fica em ~0,9; com dados heterogêneos cai
para ~0,4 **sem ninguém ser malicioso**. E muda ao longo do treino.

**Alternativas.** Limiar fixo de cosseno; dividir pelo cosseno mediano da
própria rodada.

**Escolha.** Dividir pelo mediano.

**Consequência.** Um limiar fixo teria dois comportamentos, ambos inúteis: com
dados heterogêneos bane a federação inteira; com dados parecidos não pega
ninguém. Calibrando, S(t) responde *"quão pior que o participante mediano você
está hoje"* — pergunta invariante ao regime de dados. **Efeito colateral
descoberto depois:** essa mesma calibração neutraliza boa parte do ganho da
suavização de updates (ver A05).

### D06 · Pesos 0,7 direção / 0,3 magnitude

**Contexto.** Combinar os dois sinais em uma nota.

**Escolha.** Direção pesa mais que o dobro.

**Consequência.** A direção é o que pega os ataques que importam, e o tamanho é
fácil de imitar. No exemplo da *Aritmética*, o atacante tira **nota máxima em
magnitude** — a norma dele é exatamente a típica. Um sistema que olhasse só o
tamanho o consideraria irrepreensível.

## Reputação

### D07 · Reputação inicial neutra (0,5), não boa-fé (1,0)

**Contexto.** Com quanto um participante recém-registrado entra.

**Alternativas.** 1,0 (presunção de boa-fé, "você só perde por evidência");
0,5 (neutro, "você precisa ganhar a confiança").

**Escolha.** 0,5 — espelhando `INITIAL_REPUTATION = 500` que o programa Anchor
já usava.

**Consequência.** `register_participant` é aberto: qualquer carteira se registra
pelo custo do aluguel de uma conta de 66 bytes. Se o recém-chegado nascesse com
reputação máxima, **o banimento permanente valeria zero** — bastaria gerar outra
carteira e voltar com a ficha limpa (*whitewashing*). O preço é o *cold start*,
tratado por D08.

O contra-argumento existe e é legítimo: numa federação **permissionada** de
hospitais, a identidade não é barata e a boa-fé seria defensável. A escolha
depende do modelo de ameaça, e este projeto assumiu rede aberta porque é o que o
código de fato faz.

Ver A01: essa decisão **não** afeta a capacidade de detecção.

### D08 · Graça por tempo de casa, não por rodada global

**Contexto.** Proteger as primeiras contribuições, quando o modelo global ainda
está instável e todos parecem inconsistentes.

**Alternativas.** Imunidade nas N primeiras rodadas *da federação*; nas N
primeiras contribuições *de cada participante*.

**Escolha.** Por participante, contando `contrib_count` — o mesmo campo que a
conta PDA on-chain já mantinha.

**Consequência.** Com graça por rodada global, um hospital que se registrasse na
rodada 50 entraria **sem proteção nenhuma**, em R = 0,5, a um passo do limiar
0,4 — justamente quando é o único carregando aquela distribuição de dados. Na
simulação, em que todos entram na rodada 1, os dois critérios coincidem; a
diferença só aparece on-chain, e é lá que ela importa.

### D09 · Banimento permanente, sem reversão

**Contexto.** O que acontece quando a reputação cruza o limiar.

**Alternativas.** Suspensão temporária; banimento definitivo.

**Escolha.** Definitivo. Não existe instrução no programa que reverta.

**Consequência.** Se banir fosse temporário, a estratégia ótima do atacante
seria **atacar de forma intermitente**: envenena, cumpre a suspensão, volta,
envenena de novo. A irreversibilidade elimina o ciclo. O custo é real e apareceu
na prática: um falso positivo é a morte civil de um participante honesto (ver
A02).

### D10 · Penalidade divide a reputação por 10

**Contexto.** O que fazer com a reputação no momento do banimento, já que ela
está abaixo do limiar de qualquer forma.

**Escolha.** Dividir por 10.

**Consequência.** Não serve para a decisão atual — serve contra o **adversário
paciente**, que contribui bem por vinte rodadas, acumula reputação alta e ataca
na vigésima primeira contando com a memória da média móvel para amortecer a
queda. A divisão torna a reputação acumulada sem valor no instante do flagrante:
não existe crédito guardado que compre um ataque.

### D11 · Média móvel com α = 0,5

**Contexto.** Quanto o passado pesa na reputação.

**Escolha.** `R(t) = 0,5·R(t−1) + 0,5·S(t)`.

**Consequência.** O peso de cada rodada cai pela metade a cada rodada seguinte.
Perdoa um azar pontual, mas condena comportamento sistemático em 3–4 rodadas.
α maior = mais memória, detecta mais devagar; α menor = reativo demais e sujeito
a falso positivo. **Nota importante:** como R converge para a média de S
independentemente de onde partiu, α governa a *velocidade*, e o valor inicial
(D07) governa apenas o transiente.

## Treino local

### D12 · Passos fixos, nivelados pelo MAIOR participante

**Contexto.** Com épocas fixas, quem tem 586 amostras dá 18 passos de SGD e quem
tem 1.928 dá 60. O update do primeiro chega ~1,8× mais ruidoso, e o detector lê
esse ruído como divergência (ver A02).

**Alternativas.** Manter épocas; fixar os passos pela média; fixar pelo máximo.

**Escolha.** `local_steps: auto` = os passos de uma época do maior participante.

**Consequência.** Nivelar pela média **quebrou o experimento** (ver A03) — foi o
erro mais caro da sessão. Nivelando por cima, ninguém treina menos do que
treinaria com épocas e só os pequenos treinam mais. O preço é o participante
pequeno repassar várias vezes pelos próprios dados (4× no caso extremo medido) e
sobreajustar um pouco. Entre um pequeno que sobreajusta e um pequeno banido por
engano, o projeto escolhe o primeiro.

### D13 · Suavizar o update antes de pontuar, não o score depois

**Contexto.** O ruído de amostragem "gira" o vetor de update, e o cosseno de um
vetor ruidoso é sistematicamente menor que o da direção verdadeira.

**Escolha.** Média móvel sobre os **updates**, antes de calcular S(t).

**Consequência.** A média móvel de R(t) sobre os *scores* não desfaz a
atenuação: ela tira a média de valores que já vieram achatados. Em símbolos,
`média(cos(direção + ruído)) < cos(média(direção + ruído))`. Suavizando o vetor,
o ruído de média zero se cancela entre rodadas e sobra a direção real; um viés
malicioso, por ser sistemático, atravessa a média intacto. Existem hoje **duas**
médias móveis com papéis diferentes: a do update cancela ruído, a de R(t) dá
memória à reputação.

## Ponte com a blockchain

### D14 · Formato canônico próprio para os pesos, não `torch.save`

**Contexto.** O navegador calcula SHA-256 dos bytes crus do arquivo que a
instituição sobe; o servidor calcula o hash em memória. Os dois precisam bater.

**Alternativas.** `torch.save`, `.npz`, pickle; formato próprio.

**Escolha.** Formato próprio: tensores na ordem do `state_dict`, cada um com
ndim (u32 LE) + dimensões (u32 LE) + dados em float32 little-endian.

**Consequência.** Qualquer formato de biblioteca carrega metadados, ordem de
chaves ou compressão que mudam os bytes e, portanto, o hash. O formato próprio é
auto-descritivo (carrega os *shapes*), então um auditor reconstrói os tensores
sem ter o código do modelo. Verificado: 861.576 bytes = 215.370 parâmetros × 4 +
96 bytes de cabeçalho, sem padding.

**Regra derivada:** existe **uma só** definição do formato no código
(`canonical_chunks`), da qual o hash e a exportação consomem. Se o formato
estivesse escrito em dois lugares, o hash do arquivo poderia divergir do hash em
memória sem ninguém perceber até a auditoria falhar.

### D15 · O índice de artefatos fica FORA da cadeia de blocos

**Contexto.** O livro-razão simulado encadeia os registros por hash. Onde
registrar o caminho dos arquivos `.awfl` exportados.

**Escolha.** Num índice separado, não no bloco.

**Consequência.** O caminho do arquivo é um detalhe da máquina que rodou o
experimento. Incluí-lo no hash faria a mesma federação produzir cadeias
diferentes só por ter exportado ou não os pesos.

### D16 · A rodada é da chain, não do servidor

**Contexto.** O programa deriva o endereço da contribuição a partir de
`config.current_round`. O servidor de FL tem o próprio contador.

**Escolha.** O cliente **lê** a rodada da chain e chama `advance_round` ao fim de
cada rodada.

**Consequência.** Derivar o endereço do contador local parecia funcionar e
falharia na **primeira transação real**, com `ConstraintSeeds` — e o dry-run não
pegaria, porque ele não confere nada contra o programa. O valor lido fica em
cache: são N contribuições por rodada e reler o Config em cada uma seria uma ida
ao RPC por participante sem informação nova.

### D17 · IDL único, convertido em memória

**Contexto.** O Anchor mudou o formato do IDL na versão 0.30; o anchorpy ainda
lê o formato anterior.

**Alternativas.** Manter duas cópias do IDL; converter na hora de carregar.

**Escolha.** Converter em memória (`para_idl_legado`).

**Consequência.** Duas cópias divergem — é a mesma classe de problema de D14 e
do `playground/lib.rs`. A conversão trata duas mudanças silenciosas: `pubkey`
virou o nome curto de `publicKey`, e `defined` deixou de ser string para virar
`{"name": ...}`.

### D18 · Variante nova de erro vai sempre no FIM do enum

**Contexto.** Acrescentar `ReputationAboveThreshold` ao programa.

**Consequência.** O Anchor numera os erros pela ordem de declaração (6000,
6001…). Inserir no meio renumera todos os seguintes, e qualquer cliente com IDL
antigo passa a exibir a **mensagem errada** para o erro certo. Cometido e
corrigido na mesma sessão (ver E04).

### D19 · Banimento só quando o próprio registro o justifica

**Contexto.** `penalize_participant` só verificava se a conta já estava banida.
A autoridade podia banir permanentemente um participante com reputação 1000, sem
justificativa, e o programa aceitava.

**Escolha.** `require!(participant.reputation < BAN_THRESHOLD)`.

**Consequência.** O programa **já guarda** a reputação, então consegue recusar um
banimento que os próprios números dele não condenam. O ban deixa de ser "a
autoridade mandou" e vira "o registro público justifica" — verificável por
qualquer um que leia a conta. Não elimina o abuso: a autoridade ainda pode
empurrar alguém para baixo do limiar com scores injustos ao longo de várias
rodadas. Mas força o abuso a ser **lento e público** em vez de instantâneo e
invisível.

> A trava equivalente na interface (botão desabilitado) é **conveniência**, não
> garantia: uma autoridade mal-intencionada ignora a tela e chama o programa
> direto.

## Interface

### D20 · O score é calculado, nunca digitado

**Contexto.** A tela do validador tinha um campo onde a autoridade digitava um
score de 0 a 1000.

**Escolha.** O agregador calcula e publica; a tela mostra e assina.

**Consequência.** Se uma pessoa escolhe a nota no olho, *"o sistema julga a
contribuição, não a declaração"* deixa de ser verdade. E há consequência pior:
**uma nota digitada não pode ser contestada** — não há o que recalcular.
Automatizar o score não é usabilidade, é o **pré-requisito da
contestabilidade**, e portanto de qualquer caminho de descentralização.

A avaliação publicada é indexada pelo **hash da contribuição**, que é o que está
gravado on-chain — assim a tela liga contribuição a avaliação sem depender de
mapeamento de carteiras.

### D21 · Publicar a justificativa, não só o número

**Escolha.** A avaliação carrega cosseno, cosseno mediano, direção calibrada,
magnitude, razão de norma e se o veto disparou.

**Consequência.** "Score 375" sozinho deixa o participante sem recurso: ele não
sabe se caiu por apontar para outro lado, por enviar update grande demais, ou
por bater no veto. Com as partes expostas, a tela consegue dizer *"veto de
norma: update 2,67× a mediana"* — e um terceiro consegue refazer a conta.

**Regra derivada:** `consistency_score` **delega** para `score_breakdown`. Se a
nota publicada e a nota aplicada pudessem divergir, a justificativa deixaria de
ser justificativa.

### D22 · Compromisso vem sempre do arquivo

**Contexto.** A tela de contribuição tinha um modo que gerava o hash a partir de
um texto livre — prático para demonstrar sem arquivo.

**Escolha.** Removido.

**Consequência.** O compromisso resultante não tinha relação com modelo nenhum.
Se alguém perguntasse "o que foi hasheado?", a resposta honesta seria "uma
string", e o argumento de auditabilidade cairia junto. **Um compromisso que não
compromete com nada é pior que nenhum.** Consequência colateral: a contribuição
de teste que estava pendente na Devnet, criada por esse modo, não pode mais ser
validada.

### D23 · A lateral é um trilho, não uma gaveta

**Contexto.** O botão de menu morava na barra superior.

**Consequência.** Uma gaveta que some por completo precisa de um controle *fora*
dela para reabrir — era por isso que o botão estava no topo. Virando trilho que
recolhe (76px) em vez de sumir, o controle passa a viver ao lado da marca e a
barra superior fica só com a carteira.

---

# Parte 2 — Achados experimentais

Todos reproduzíveis. Os comandos assumem o diretório `awakefl-fl/`.

### A01 · A reputação inicial não afeta a detecção

**Método.** Reaplicar a média móvel sobre os **mesmos S(t) observados**,
variando apenas R₀.

**Resultado.** Sair de R₀ = 1,0 para R₀ = 0,5 antecipou o banimento em **1 rodada
em apenas 1 dos 3 atacantes**.

**Explicação.** O peso de R₀ cai pela metade a cada rodada — 50%, 25%, 12%, 6%,
3% — e R(t) converge para a média de S(t) independentemente de onde partiu. R₀
governa o transiente, não o regime.

**Por que importa.** Muito trabalho de reputação trata R₀ como calibração de
detector. Ele não é: é parâmetro de **resistência a whitewashing** e de proteção
ao recém-chegado.

    python run_experiments.py --rep-initial 1.0

### A02 · O detector punia participantes por serem pequenos

**Método.** Varredura de 10 sementes; investigação do único falso positivo.

**Resultado.** Um participante **honesto** foi banido permanentemente (semente 4,
436 amostras). A causa não foi distribuição atípica — ele tinha a distribuição
**mais equilibrada** da federação. Era tamanho.

| Grupo | S médio |
| --- | --- |
| < 600 amostras (3 de 70) | **0,592** |
| ≥ 600 amostras (67 de 70) | **0,927** |

**Explicação.** 436 amostras ÷ lote 32 = ~14 passos de SGD, contra ~60 do maior.
O ruído da direção cai com a raiz do número de passos, então o update do pequeno
chega ~1,8–2,2× mais ruidoso. **O detector não distingue "malicioso" de "pequeno
demais para produzir um update estável"** — as duas coisas produzem o mesmo
sintoma.

**Leitura no domínio:** a clínica pequena era banida por ser pequena.

    python analise_tamanho.py results_sweep --por-rodada

### A03 · Nivelar os passos pela média destruiu o experimento

**Método.** Ligar `local_steps` com valor 40 (perto da média) e medir a queda de
acurácia causada pelo ataque.

| Configuração | Queda A→B |
| --- | --- |
| épocas locais | 14,7 pp |
| **40 passos (a média)** | **0,95 pp** |
| `auto` (época do maior) | 11,7 pp |

**Explicação.** Passos fixos mexem no treino de **todo mundo**, atacantes
inclusive. O maior participante dava 60 passos e o menor 18; fixar em 40 dava 22
ao pequeno e **tirava 20 do grande**. Como os atacantes estavam entre os grandes,
o ataque perdeu um terço da força de envenenamento.

**Por que importa.** Uma correção de justiça pode silenciosamente destruir o
fenômeno que o experimento se propõe a medir. Sempre reconferir o efeito
principal depois de mexer no protocolo de treino.

### A04 · A defesa devolve previsibilidade, não só acurácia

**Método.** 10 sementes independentes, configuração padrão.

| Cenário | Acurácia final |
| --- | --- |
| A — baseline | 98,23% ± 0,33 |
| B — ataque | 69,13% ± **26,78** |
| C — defesa | 98,02% ± **0,35** |

Precisão 1,00 ± 0,00 · recall 1,00 ± 0,00 · 30 de 30 atacantes banidos em
5,40 ± 0,68 rodadas.

**O resultado central não é o ganho médio de +28,9 pp.** É que o desvio de C
(±0,35) é tão apertado quanto o do baseline (±0,33), contra ±26,8 do cenário
atacado. A defesa não recupera acurácia "em média" — ela restaura a
previsibilidade. Com uma semente só isso era invisível.

    python sweep.py --seeds 10

### A05 · As duas correções agem em momentos diferentes

**Método.** Mesmas 5 sementes, mesmos atacantes, três configurações.

| Configuração | S pequenos | Lacuna | Recall | Falsos+ |
| --- | --- | --- | --- | --- |
| sem correção | 0,568 | 0,362 | 1,00 | 1 |
| A — passos fixos | 0,918 | 0,023 | 1,00 | 0 |
| B — update suavizado | 0,764 | 0,171 | 1,00 | 0 |
| **A + B** | **0,972** | **−0,028** | 1,00 | 0 |

O que separa A de B é o **quando**: A já está em 0,96 na rodada 1 porque remove
a causa; B é idêntica à base até a rodada 4 e só então sobe, porque a média
precisa acumular. No caso real investigado, o banimento indevido veio na rodada
5 e **B chegou a tempo por uma rodada**.

Com as duas ligadas, nas 10 sementes: S pequenos 0,945 contra S grandes 0,945 —
lacuna −0,001, zero falsos positivos. **O detector deixou de enxergar tamanho.**

### A06 · O atacante declara acurácia alta e é pego mesmo assim

**Método.** Demo de 3 participantes, rodada 7.

O atacante declara **91,4% de acurácia** — e é verdade, do ponto de vista dele:
ele acerta os próprios rótulos trocados. Tira score **375** contra 978 e 1000
dos honestos.

**Por que importa.** É a demonstração viva de que métrica auto-declarada não
julga ninguém. Se o sistema acreditasse na declaração, ele passaria.

### A07 · Com poucos participantes a detecção é mais lenta

Com 10 participantes e 3 atacantes, o banimento acontece por volta da rodada
5–7. Com **3 participantes e 1 atacante**, foi na rodada **7** — e não aconteceu
dentro de 6 rodadas na primeira tentativa.

**Consequência prática:** uma demonstração precisa de rodadas suficientes, ou o
banimento não aparece. Vale medir antes de montar o roteiro.

---

# Parte 3 — Erros que cometemos

Registrados porque a IC ganha mais em contar o que deu errado do que em fingir
um caminho reto.

### E01 · Medir numa janela curta demais e concluir o oposto

A primeira avaliação da correção B usou só as **3 primeiras rodadas** e concluiu
que ela não funcionava (+0,003 no score dos pequenos). Estava errada: é
exatamente o período em que a média móvel ainda não acumulou. Medindo a execução
inteira, o ganho real é 0,568 → 0,764.

**Lição.** Antes de concluir que um mecanismo com memória não funciona,
verifique se a janela de medição é maior que o tempo de acumulação dele.

### E02 · Corrigir o viés e quebrar o experimento

Descrito em A03. A correção resolveu o problema de justiça e reduziu a queda de
acurácia do ataque de 14,7 pp para 0,95 pp — sem alarme nenhum, porque a métrica
de justiça melhorou.

**Lição.** Toda mudança no protocolo de treino precisa ser validada contra **dois**
critérios: o que ela pretende consertar **e** o efeito principal do experimento.

### E03 · Uma frase de efeito que era falsa

A formulação *"o sistema não acredita em nenhum dos três números declarados"*
soava bem e estava errada: o sistema **acredita no `n_samples`**, porque pondera
a agregação por ele. A frase escondia a única superfície de confiança que
realmente existe.

**Lição.** Frase de pitch também precisa passar por revisão técnica.

### E04 · Inserir a variante de erro no meio do enum

Descrito em D18. Pego antes de commitar, mas teria renumerado os códigos 6004 a
6006 e feito clientes com IDL antigo exibirem mensagens trocadas.

### E05 · Apresentar dados derivados como se fossem observados

Uma tabela com três carteiras foi apresentada sob o título "o estado atual da
sua Devnet". As carteiras não existiam lá — tinham sido **derivadas
localmente** de uma seed. Só o saldo (zero) e a ausência de registro vinham da
rede.

**Lição.** Separar explicitamente o que foi **lido** do que foi **calculado**.

### E06 · Gerar arquivo de uma branch estando em outra

O `aritmetica-reputacao.html` foi criado na branch de integração e sumiu na
troca para a branch de documentos. Teve que ser regerado da fonte.

**Lição.** Trocar de branch **antes** de criar o arquivo, não depois.

### E07 · Dizer "validado" sobre um caminho que só o padrão exercitava

O livro-razão da Devnet (`AnchorLedger`) e o simulado são intercambiáveis: o
servidor chama os dois com os mesmos argumentos. Quando o score ganhou
justificativa publicada (`D21`), o servidor passou a mandar `breakdown` — e só o
simulado tinha esse parâmetro. `--chain dry-run` e `--chain devnet` quebravam
com `TypeError` **antes de a primeira rodada terminar**.

Junto veio um segundo: `--export-weights` era aceito e não gravava nada nos
backends de chain, porque a exportação do artefato morava dentro do ledger
simulado. Quem rodasse com `--chain devnet` terminava sem o arquivo `.awfl` que
a tela do participante pede para subir.

Nenhum dos dois aparecia no uso normal, porque o backend padrão é o simulado.
E este registro afirmava, até 24/08/2026, que `--chain devnet` estava
"implementado e validado em dry-run". Estava implementado; validado, não.

**Lição.** "Validado" precisa dizer *por qual execução*. Um caminho alternativo
que ninguém roda diverge em silêncio, e a divergência aparece na hora mais cara
— aqui, seria na primeira transação real, gastando SOL. O conserto veio com um
teste que compara as **assinaturas** dos dois backends: mais barato do que rodar
a federação inteira em cada um para descobrir que deixaram de concordar.

---

# Parte 4 — Estado atual

## O que está pronto e verificado

| Camada | Estado |
| --- | --- |
| Simulação de FL | 3 cenários, 4 ataques, 67 testes |
| Programa Anchor | 6 instruções, publicado na Devnet, testes em TypeScript |
| Site | 8 rotas; o painel executa as 6 instruções |
| Artefato canônico | hash do navegador bate com o do servidor — no CI e conferido à mão num `.awfl` real em 24/08/2026 |
| Cliente Anchor (Python) | implementado; PDA confirmado contra a conta real |

## O que existe mas nunca rodou de verdade

- **`--chain devnet`** — implementado; o dry-run monta as instruções e deriva os
  PDAs, mas **não envia nem confere nada**, e por isso não é validação (`E07`).
  Nenhuma transação real foi enviada. Falta financiar as carteiras.
- **Participação parcial** — `fraction_fit` existe; todos os experimentos
  rodaram com participação total.
- **Backend Flower** — a estratégia existe; o motor local é o padrão por
  reprodutibilidade.

## O que está em código mas não em produção

A trava de banimento (D19) está no código e **não** no binário publicado na
Devnet. Enquanto não houver redeploy, banir um participante com reputação alta
continua funcionando. Nenhuma conta muda no redeploy — só foram acrescentados
uma constante e uma variante de erro.

## Números de referência

Configuração padrão, `label_flipping`, semente 42, 10 participantes, 12 rodadas:

    A = 98,25%   B = 86,60%   C = 98,25%
    precisão 1,00 · recall 1,00 · banimentos nas rodadas 6, 7 e 7

Demo de 3 participantes, 8 rodadas: banimento na rodada 7, acurácia final
94,80%, 23 artefatos conferindo com o livro-razão.

---

*Última atualização: 24 de agosto de 2026.*
