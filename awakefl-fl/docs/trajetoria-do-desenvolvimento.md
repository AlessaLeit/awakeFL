# Trajetória do desenvolvimento — AwakeFL

Este é o documento em prosa. Conta **como o projeto chegou onde está**: em que
ordem as coisas foram construídas, quais momentos mudaram o rumo, o que foi
adiado de propósito e o que ficou por fazer.

Ele não repete os outros. Quando uma decisão aparece aqui, é pelo lugar dela na
história; o *por quê* completo, com alternativas e consequências, está no
**Registro de decisões** sob o código citado (`D07`, `A02`, `E01`…).

Os documentos irmãos:

| Documento | Responde |
| --- | --- |
| **Anatomia do AwakeFL** | como as peças se encaixam |
| **Aritmética da Reputação** | as contas, passo a passo, com números |
| **Registro de decisões** | por que cada escolha, e o que se paga por ela |
| **O Que Falta no AwakeFL** | as perguntas em aberto, e como respondê-las |
| **Trajetória** (este) | como chegamos aqui, e o que ficou de fora |

---

## 1. O ponto de partida

A pergunta de pesquisa veio antes do código: *como detectar e mitigar ataques de
envenenamento no Federated Learning de forma auditável e com rastreabilidade
imutável?*

Ela já embutia uma aposta. Existem duas famílias de resposta possíveis — melhorar
a **regra de agregação** (Krum, mediana, trimmed mean) ou construir **governança
sobre os participantes** (reputação, banimento, auditoria). A pergunta escolhida
puxa para a segunda: as palavras "auditável" e "imutável" não descrevem uma
propriedade estatística, descrevem um registro. Essa aposta condicionou tudo o
que veio depois, inclusive o que o projeto **não** tenta provar (ver §7).

Duas consequências práticas dessa escolha, ambas visíveis no código de hoje:

- A defesa não podia viver só na memória do agregador. Se o score que bane
  alguém desaparece quando o processo termina, não há auditoria — há apenas a
  palavra do servidor.
- O sistema precisava de um **estado que sobrevive à rodada**. Foi isso que
  transformou "score de uma contribuição" em "reputação de um participante", e é
  daí que sai a média móvel `R(t) = 0,5·R(t−1) + 0,5·S(t)` (`D11`).

---

## 2. Fase 1 — o livro-razão antes daquilo que ele mede

*10 a 12 de agosto.*

A primeira coisa construída foi a camada on-chain, não o Federated Learning.
Em três dias saíram: a estrutura Anchor com as contas `Config`, `Participant` e
`Contribution`; a versão para o Solana Playground; o site em Next.js com uma
demonstração simulada do ciclo; a camada de acesso ao programa; os providers de
carteira; e o deploy na Devnet com o Program ID fixado
(`GhMhTkv7jeHMejEyypQaEFPqduHgXDSzE5g7jE3rXGRA`).

No dia 12 o projeto foi renomeado de `fl-reputation` para **AwakeFL**, ganhou o
design system e a área do participante em `/painel`.

**Por que essa ordem importa.** Construir o registro primeiro forçou uma
definição precoce do que exatamente seria gravado: um *hash* de pesos, um número
de amostras, loss, acurácia e um status. Quando a camada de FL chegou, ela não
teve liberdade de inventar seu próprio formato — teve que caber no que já existia.
Isso evitou um problema comum, o de a simulação produzir métricas ricas que a
cadeia não consegue armazenar.

O preço foi cobrado depois: durante uma semana o painel executava um ciclo de
reputação com números **digitados à mão**. A tela funcionava, e o que ela
demonstrava não existia. Isso vira um problema explícito na Fase 4.

---

## 3. Fase 2 — a camada off-chain e o primeiro choque

*19 de agosto.*

A simulação de FL entrou inteira num commit: modelo, particionamento não-IID por
Dirichlet, os quatro ataques (`label_flipping`, `gradient_poisoning`, `backdoor`,
`free_rider`), o score de consistência, o livro-razão de reputação e os três
cenários A/B/C.

O score nasceu com a forma que tem hoje: cosseno contra a mediana por coordenada
(`D01`, `D02`), termo de magnitude simétrico `min(r, 1/r)` (`D03`), veto de norma
(`D04`), calibração pela mediana da própria rodada (`D05`) e pesos 0,7/0,3
(`D06`).

E aí veio o primeiro choque entre as camadas. Elas tinham sido escritas com uma
semana de distância e **não concordavam**:

- assinaturas de instrução divergentes entre os stubs Python e o programa Rust
  (corrigido no commit `c292164`);
- e uma divergência de escala mais séria: a reputação inicial.

### O ponto decisivo: reputação inicial 1,0 ou 0,5

A especificação original dizia reputação inicial 1,0 — boa-fé. O programa Anchor
já tinha `INITIAL_REPUTATION = 500` numa escala de 0 a 1000, ou seja, 0,5.

Não era um bug de conversão. Eram duas filosofias:

| | Começar em 1,0 | Começar em 0,5 |
| --- | --- | --- |
| Recém-chegado | tratado como confiável | tratado como desconhecido |
| Banimento permanente | vale pouco: registrar outra carteira devolve a ficha limpa | custa as rodadas necessárias para reconstruir a reputação |
| Custo | *whitewashing* barato | *cold start*: quem entra fica perto do limiar |

Escolhemos 0,5 (`D07`), porque `register_participant` é aberto — uma carteira
nova custa o aluguel de uma conta de 66 bytes. Com boa-fé inicial, o banimento
permanente (`D09`) seria decorativo.

O *cold start* resultante teve que ser pago com uma segunda decisão: o período de
graça, contado por **tempo de casa** do participante (`contrib_count`) e não pelo
número da rodada global (`D08`). Sem isso, quem se registrasse na rodada 50 teria
menos proteção que quem estava lá desde o começo — e isso não é uma propriedade
que se queira num consórcio que espera receber novos membros.

Depois medimos se a escolha custava detecção. Não custava (`A01`): a reputação
inicial não muda quem é pego nem quando.

---

## 4. Fase 3 — medir para valer, e descobrir que o detector estava errado

*20 de agosto.* O dia mais denso do projeto.

Nesta fase entraram o artefato canônico de pesos, a varredura de sementes, o CI,
o cliente Anchor real em Python e — no meio disso — a descoberta de um viés que
invalidava o detector.

### 4.1 O viés de tamanho

A varredura de sementes revelou um participante **honesto**, com 436 amostras,
sendo banido permanentemente.

A causa não era o score: era o treino. Cada participante rodava uma época sobre
os próprios dados, então o pequeno dava ~14 passos de SGD e o grande ~60. Menos
passos significa mais ruído angular no update — de 1,8 a 2,2 vezes mais. O
detector, que mede direção, lia esse ruído como divergência e punia o
participante **por ser pequeno** (`A02`).

Isso é grave para a tese do projeto. O cenário-alvo é um consórcio de hospitais,
onde o hospital pequeno é exatamente quem mais depende do arranjo federado. Um
detector que o expulsa não é uma defesa — é um filtro de porte.

Duas correções, que agem em momentos diferentes (`A05`):

1. **Passos fixos, nivelados pelo maior participante** (`D12`) — todos dão o
   mesmo número de passos de SGD, independente do tamanho do próprio conjunto.
2. **Suavizar o update antes de pontuar** (`D13`) — média móvel sobre o histórico
   do próprio participante, e não sobre o score já calculado.

Resultado: a diferença de score entre pequenos e grandes caiu de 0,336 para
−0,001, e os falsos positivos foram a zero em 10 sementes. Ambas ficaram ligadas
por padrão.

### 4.2 O erro que veio junto

A primeira tentativa de correção nivelou os passos pela **média** dos
participantes. O viés sumiu — e o experimento também: a queda de acurácia
causada pelo ataque desabou de 14,7 para 0,95 pontos percentuais (`E02`). Com
poucos passos, ninguém aprendia o suficiente para que o envenenamento importasse.

A lição está registrada porque é sutil: uma correção pode melhorar a métrica que
você está olhando **destruindo a condição experimental** que dá sentido a ela.

### 4.3 A costura com o navegador

O artefato canônico (`D14`) resolveu um problema de credibilidade. O painel pede
um arquivo de pesos e calcula o SHA-256 dele no navegador; o servidor calcula o
seu. Se os dois formatos divergissem em qualquer detalhe — ordem das chaves,
endianness, precisão — o hash gravado na cadeia não provaria nada.

O formato foi definido byte a byte (número de dimensões `u32` LE, dimensões,
`float32` LE, na ordem do `state_dict`) e existe em **uma** função,
`canonical_chunks()`. O CI verifica que o hash do navegador bate com o do
servidor.

### 4.4 A rodada é da chain

O cliente Anchor real (`efa009b`) trouxe um erro que o modo *dry-run* nunca
mostraria: o servidor derivava o PDA da contribuição a partir do **próprio**
contador de rodadas, enquanto o programa usa `config.current_round`. Na primeira
transação real isso falharia com `ConstraintSeeds`.

A correção (`D16`) foi tornar a chain a fonte da verdade sobre a rodada, e o
servidor responsável por fechá-la explicitamente com `advance_round()`.

---

## 5. Fase 4 — a honestidade da interface

*20 de agosto, fim do dia.*

Com o backend medindo bem, a atenção voltou para a tela — e para uma pergunta
desconfortável: **quem digita o score?**

Até ali, o validador abria a contribuição e escrevia um número de 0 a 1000 num
campo de texto. Toda a matemática das fases anteriores — mediana, veto de norma,
calibração — não passava por ali. O painel demonstrava uma autoridade humana
arbitrando reputação, que é justamente o que o projeto diz combater.

Três mudanças fecharam isso:

- **O score é calculado, nunca digitado** (`D20`). O campo de texto sumiu. O
  score é buscado pelo `updateHash` da contribuição, exibido em modo leitura, e o
  botão passou a se chamar "Assinar" em vez de "Validar".
- **Publicar a justificativa, não só o número** (`D21`). A tela mostra a frase que
  explica o score — *"veto de norma: update 2,67× a mediana do grupo — o crédito
  de direção foi zerado"*. Um número sozinho não é auditável; a razão é.
- **Compromisso vem sempre do arquivo** (`D22`). O modo que gerava hash a partir
  de um texto qualquer foi removido: ele permitia registrar um compromisso que
  não correspondia a peso nenhum.

E no programa Anchor entrou a trava de banimento (`D19`): `penalize_participant`
agora exige `reputation < BAN_THRESHOLD`. Antes, a autoridade podia banir alguém
com reputação 875 — sem que o registro on-chain justificasse a decisão. A trava
não impede uma autoridade maliciosa de agir; impede que ela aja **de forma
inconsistente com o histórico público**, que é o máximo que uma camada de
auditoria pode prometer.

O papel do validador ficou reduzido, e isso é intencional: ele fecha a rodada e
assina o que a lógica calculou. Não é ele que decide o número.

---

## 6. Fase 5 — documentar

*21 de agosto.*

Três documentos, com públicos diferentes: a **Anatomia** (como funciona, em dois
níveis de leitura), a **Aritmética** (as contas com números reais) e o **Registro
de decisões** (23 decisões, 7 achados, 6 erros). Este documento fecha a série.

Uma escolha de formato: o registro é Markdown, não PDF nem slide. É documento
vivo, cola direto no texto da IC e o diff no git mostra o que mudou entre uma
revisão e outra.

---

## 7. Os pontos de trava — o que ficou de fora, e por quê

Esta seção existe para que nada aqui seja lido como pronto quando não está.

### 7.1 O score é calculado off-chain

**O que é.** A cadeia guarda o score, o hash e a justificativa. Ela não
**recalcula** nada. Quem confia no número, confia em quem o calculou.

**Por que ficou.** Recalcular cosseno contra a mediana de dez vetores de milhares
de dimensões dentro de um programa Solana está fora de orçamento computacional, e
os pesos nem estão na cadeia.

**O que fecharia.** Prova de conhecimento zero do score, ou um comitê de
validadores independentes que recalculam e assinam por quórum. As duas coisas
estão em *O Que Falta no AwakeFL* como trabalho futuro.

**Estado honesto.** Este é o ponto único de confiança que sobra no desenho. Deve
ser dito na defesa antes que perguntem.

### 7.2 Comitê de validadores, quórum e prazo de contestação

Discutido em detalhe, **não implementado**. Hoje há uma autoridade única
(`Config.authority`). O desenho conversado previa: N validadores assinando, um
quórum para efetivar, e uma janela em que o participante penalizado pode
contestar antes de o banimento se tornar definitivo.

Ficou fora porque o MVP precisava do fluxo completo funcionando ponta a ponta
antes de ganhar um protocolo de governança. Está registrado como melhoria futura.

### 7.3 Resistência a Sybil

O banimento permanente pressupõe que registrar uma identidade nova custe algo.
Hoje custa o aluguel de uma conta de 66 bytes na Devnet — praticamente nada. A
reputação inicial neutra (`D07`) mitiga, não resolve: o atacante recomeça no meio
da escala em vez do topo.

O campo `stake_amount` existe na conta `Participant` e está zerado. Ele é o
gancho para um mecanismo de garantia econômica que nunca foi implementado.

### 7.4 Contribuição proporcional ao porte

Levantado durante o desenvolvimento e adiado conscientemente: um hospital pequeno
não tem como inventar dados, mas também não consegue demonstrar tanto valor
quanto um grande. Hoje o FedAvg pondera pelo `n_samples` **declarado** — um campo
auto-declarado, que o sistema não verifica.

Corrigido em parte pelo viés de treino (§4.1). Não corrigido no que diz respeito
ao incentivo: medir contribuição marginal (valor de Shapley, por exemplo) é
trabalho futuro.

### 7.5 O `--chain devnet` nunca enviou uma transação real

Implementado, validado em *dry-run*, com o PDA conferido contra a conta real na
Devnet. Nunca executou de verdade porque as carteiras de simulação não foram
financiadas nem registradas.

### 7.6 A trava de banimento não está em produção

`D19` está no código-fonte e **não** no binário publicado. Enquanto não houver
redeploy, banir alguém com reputação alta continua funcionando na Devnet. O
redeploy não migra conta nenhuma — foram acrescentados uma constante e uma
variante de erro, esta última colocada no fim do enum de propósito (`D18`, `E04`).

### 7.7 Os testes Anchor mudaram e não rodaram

Os testes em TypeScript foram reescritos para cobrir a trava nova. `anchor test`
exige a CLI da Solana, que não está disponível neste ambiente — precisa de WSL2.

### 7.8 CIFAR-10, Flower e participação parcial

A proposta de IC menciona MNIST **e** CIFAR-10. Todos os experimentos rodaram em
MNIST. A estratégia Flower existe no código, mas o motor local é o padrão, por
reprodutibilidade. E `fraction_fit` (participação parcial por rodada) está
implementado e nunca foi exercitado: todos os experimentos usaram participação
total.

---

## 8. O que a trajetória ensinou sobre método

Três hábitos que se pagaram, e que valem para a IC:

**Medir na janela inteira.** A primeira avaliação de uma das correções olhou
apenas as rodadas 1 a 3 e concluiu que ela não tinha efeito (+0,003). Na corrida
completa, o efeito era de 0,568 para 0,764 (`E01`). Uma janela curta não é uma
medição pequena — é uma medição possivelmente invertida.

**Separar o que foi observado do que foi derivado.** Em determinado momento três
carteiras calculadas localmente foram apresentadas como "o estado atual da
Devnet". Elas nunca existiram na cadeia (`E05`). O registro passou a marcar
explicitamente o que foi lido de uma fonte e o que foi computado.

**Frase de efeito precisa passar no teste.** Uma sentença de pitch afirmava que o
sistema "não acredita em nenhum dos três campos declarados". Era falsa: o
`n_samples` declarado pondera a agregação (`E03`). Toda afirmação de marketing do
projeto deveria ser testável contra o código — e várias não eram.

---

## 9. Onde a trajetória encontra a proposta de IC

Mapeamento honesto entre o que a proposta promete e o que existe hoje.

### Objetivos específicos

| # | Objetivo | Estado |
| --- | --- | --- |
| 1 | Ambiente de simulação FL multi-participante | **Feito.** 10 participantes, não-IID por Dirichlet, 12 rodadas. |
| 2 | Reproduzir e documentar os ataques | **Feito.** Os quatro: label flipping, gradient poisoning, backdoor, free-rider. |
| 3 | Mecanismo de reputação com `R(t) = 0,5·R(t−1) + 0,5·S(t)` e limiares | **Feito.** Limiar de banimento em 400/1000, com graça por tempo de casa. |
| 4 | Avaliar acurácia, loss e velocidade de detecção | **Feito em parte.** Acurácia, precisão e recall medidos em 10 sementes; latência e custo das transações Solana **não** medidos (§7.5). |
| 5 | Camada on-chain Anchor/Solana como livro-razão | **Feito.** Publicada na Devnet, seis instruções, painel executando todas. |

### Hipóteses

**H1 — o atacante degrada acurácia e convergência.** Sustentada. Cenário A =
98,25%, cenário B = 86,60% na configuração padrão. Em 10 sementes, B fica em
69,13% com desvio padrão de 26,78 — e o desvio é o achado mais interessante: o
ataque não só derruba a acurácia, ele torna o resultado **imprevisível** (`A04`).

**H2 — a reputação identifica o anômalo em poucas rodadas.** Sustentada.
Banimentos nas rodadas 6 e 7, com precisão 1,00 e recall 1,00 nas 10 sementes.
Ressalva registrada: com poucos participantes a detecção é mais lenta (`A07`),
porque a mediana de referência fica mais frágil.

**H3 — o banimento limita o dano e permite recuperação.** Sustentada. Cenário C =
98,25%, empatando com o baseline. Com a ressalva de que o banimento é executado
pela autoridade — a cadeia registra e trava a inconsistência (`D19`), mas não
decide.

---

## 10. Trabalhos relacionados

**Sobre a origem desta seção.** O levantamento inicial veio da seção 12 da
proposta de IC, produzida fora desta trajetória de desenvolvimento. As sete
referências que estavam marcadas `[VERIFICAR]` foram conferidas na fonte em **21
de agosto de 2026**, e a conferência mudou o conteúdo: três descrições estavam
incorretas e um título estava errado. O que segue é o texto corrigido, com o que
foi checado marcado como tal.

### 10.1 O que a conferência das referências encontrou

| Referência da proposta | Situação |
| --- | --- |
| Xu & Lyu, *A Reputation Mechanism Is All You Need* | **Confirmada.** arXiv 2011.10464; publicada no workshop FL-ICML'21. Atenção: é workshop, não trilha principal — pesa menos numa revisão. |
| Yin et al., 2018 | **Título errado na proposta.** Não é "Amplitude and Variance"; é *Byzantine-Robust Distributed Learning: Towards Optimal Statistical Rates*, ICML/PMLR v80. |
| DFL (ACM, 2023) | **Confirmada, descrição errada.** Ver §10.4. |
| BPRFL (ScienceDirect, 2025) | **Confirmada, descrição errada.** Ver §10.4. |
| FLChain (2019) | **Confirmada, com ambiguidade de nome.** Ver §10.4. |
| TFFL / Rashid et al., 2025 | **Confirmada.** IEEE TIFS, *Trustworthy and Fair Federated Learning via Reputation-Based Consensus and Adaptive Incentives*, doi 10.1109/TIFS.2025.3546841. |
| Survey (PMC) | **Confirmada, conclusão superdimensionada.** Ver §10.5. |

Três correções adicionais de conteúdo:

**A mediana por coordenada não é uma técnica anônima.** A proposta lista
"Coordinate-wise Median" como entrada separada, sem autoria. Ela vem do **mesmo
artigo** que o Trimmed Mean — Yin et al. (2018) analisa os dois. Vale citar
junto, inclusive porque o artigo mostra que a mediana **não** exige estimar a
fração de atacantes, enquanto o trimmed mean exige o parâmetro β. Isso é
argumento direto a favor de `D02`.

**Faltam três trabalhos que são mais próximos do AwakeFL do que metade dos
citados** — FoolsGold, BFLC e FoundationFL. Estão em §10.3 e §10.6.

**A tabela comparativa da proposta contém uma linha que nenhum experimento
sustenta.** Ver §10.7.

### 10.2 A taxonomia, e onde o AwakeFL cai

A divisão em duas famílias que a proposta faz — agregação robusta *versus*
reputação/governança — está correta e é útil. Vale explicitar o que separa as
duas: **o que cada uma tenta impedir**.

A agregação robusta tenta impedir que a contribuição maliciosa **influencie o
modelo desta rodada**. Ela não guarda nada: na rodada seguinte, o atacante volta
com o mesmo direito de participação. É defesa por diluição.

A reputação tenta impedir que o participante malicioso **continue participando**.
Isso exige memória entre rodadas, e memória exige um lugar para guardar —
que é onde a blockchain entra.

O AwakeFL usa as duas: mediana por coordenada como referência de consenso (a
parte estatística), e reputação persistente com banimento permanente (a parte de
governança). O que ele **não** faz é substituir o FedAvg por uma regra robusta na
agregação em si — a mediana entra como referência de comparação para pontuar,
não como agregador.

### 10.3 Agregação robusta a bizantinos

**FedAvg** (McMahan et al., 2017) — média ponderada pelo número de amostras. É a
base, e é o que o AwakeFL usa para agregar. Vulnerabilidade conhecida: breakdown
point zero, um único participante amplificado arrasta a média (`D02` documenta o
exemplo numérico).

**Krum** (Blanchard et al., NIPS 2017) — seleciona a atualização com menor soma
de distâncias euclidianas aos vizinhos mais próximos. Descarta informação útil
por construção: escolhe *um* update e ignora os demais.

**Trimmed Mean e Coordinate-wise Median** (Yin et al., ICML 2018) — o artigo
prova taxas estatísticas de erro para ambos. A mediana precisa de hipóteses mais
brandas (assimetria limitada) e **dispensa** conhecer a fração de bizantinos; o
trimmed mean precisa de β, e erra o alvo se β for mal estimado.

**FLTrust** (Cao et al., NDSS 2021) — o servidor mantém um *root dataset* limpo,
de menos de 100 amostras, treina o próprio update e pontua cada cliente pela
similaridade de cosseno com ele, com clipping ReLU nos cossenos negativos.
Reportam acurácia comparável ao FedAvg sem ataque, mesmo com 40–60% de clientes
maliciosos.

> **Relação direta com o AwakeFL.** O score do AwakeFL é estruturalmente o
> mesmo mecanismo — cosseno contra uma referência — trocando o *root dataset*
> pela **mediana por coordenada da própria rodada**. Isso preserva a premissa de
> zero dados no servidor, que o FLTrust quebra. É uma diferença que vale ser dita
> explicitamente na defesa, porque é a favor do projeto.

**FoolsGold** (Fung et al., RAID 2020) — **ausente da proposta e o mais próximo
do que o AwakeFL faz.** Reduz o peso de clientes cujos gradientes são
suspeitosamente *similares* entre si, mirando sybils coordenados. Dois detalhes
importam aqui:

- Ele compara o **histórico agregado** de updates, não o update da rodada
  isolado, porque a similaridade instantânea é ruidosa demais. Isso é
  exatamente o raciocínio por trás de `D13` (suavizar o update antes de pontuar).
- Ele tem um mecanismo de *pardoning* para não punir honestos que por acaso se
  parecem com sybils. O AwakeFL chegou ao mesmo problema por outro caminho — o
  viés contra participantes pequenos (`A02`) — e resolveu nivelando os passos de
  treino (`D12`) em vez de reponderar a similaridade.

Citar FoolsGold é obrigatório: sem isso, `D13` parece uma invenção quando na
verdade é convergência independente com uma prática estabelecida.

**Limitação da família inteira.** Fang et al. (USENIX Security 2020) mostram
ataques de envenenamento local desenhados **contra** essas regras, que passam por
elas mimetizando estatísticas de clientes honestos. Isso vale para o score do
AwakeFL também — e é a razão honesta para não prometer detecção de *slow
poisoning* (§10.7).

### 10.4 Blockchain + FL — os concorrentes diretos, com as descrições corrigidas

**DFL** (Tian et al., arXiv 2110.15457; ACM *Distributed Ledger Technologies:
Research and Practice*, 2023, doi 10.1145/3600225).

> ⚠️ **A descrição na proposta está invertida.** A proposta diz que o DFL
> "substitui o servidor central por smart contracts" e por isso "enfrenta alto
> custo de gás". É o contrário: o DFL **critica** a agregação por smart contract
> — argumentando que gerar um bloco custa mais de 10 segundos — e propõe uma
> arquitetura de blockchain que **abre mão do consenso global**, com cada nó
> gerando blocos de forma assíncrona. O livro-razão vira uma "prova distribuída
> de contribuição" ao modelo.
>
> Corrigir isso importa: do jeito que está escrito, a proposta atribui ao
> concorrente exatamente o problema que ele resolve. Numa banca, isso é o tipo de
> erro que desqualifica a revisão inteira.

**BPRFL** (*A blockchain-based privacy-preserving reputation consensus federated
learning*, ScienceDirect, 2025).

> ⚠️ **A proposta o descreve como "predominantemente teórico com validação
> limitada".** Não procede. O artigo reporta experimentos: sob 50% de clientes
> maliciosos em *label-flipping*, +5,98% de acurácia sobre o FL tradicional e
> +2,09% sobre o BFLC, com ganho de 20% em eficiência de consenso.
>
> E ele é o **vizinho mais próximo do AwakeFL** — tem consenso de reputação com
> verificação de consistência por intervalo de confiança (contra conluio), comitê
> de tamanho dinâmico ajustado pela reputação acumulada, e privacidade
> diferencial com ruído em grupo por VRF. Ou seja: implementa justamente o comitê
> de validadores que o AwakeFL deixou como trabalho futuro (§7.2).

**FLChain** — atenção, **dois artigos diferentes de 2019 com esse nome**:

- Bao, Su, Xiong, Huang & Hu, *FLChain: A Blockchain for Auditable Federated
  Learning with Trust and Incentive* (BIGCOM 2019) — este é o que a proposta quer
  citar, foco em auditoria e incentivo.
- Majeed & Hong, *FLchain: Federated Learning via MEC-enabled Blockchain Network*
  (APNOMS 2019) — outro trabalho, outro escopo.

A citação precisa dizer qual.

**BFLC** (Li et al., IEEE Network 35(1):234-241, 2021; arXiv 2004.00773) —
**ausente da proposta**, e é o ancestral direto da linha de reputação em
blockchain: consenso por comitê, blocos separados para updates locais e globais,
sem servidor central. É o baseline contra o qual o BPRFL se compara. Uma
limitação reconhecida na literatura: nós maliciosos podem entrar no comitê e
enviesá-lo — o mesmo risco que qualquer desenho de quórum do AwakeFL teria.

### 10.5 Sobre a conclusão atribuída ao survey

A proposta afirma que o survey "identifica a combinação de reputação e smart
contracts como a **solução definitiva** para o problema de poisoning, validando a
premissa do AwakeFL".

> ⚠️ Isso não é o que um survey faz, e não é o que este faz. O trabalho mais
> provável de ser o citado — *Blockchain-Based Federated Learning System: A
> Survey on Design Choices* (Sensors 23(12):5658; PMC10302079) — cataloga cerca
> de **31 variações de escolha de projeto**, avaliando prós e contras de cada uma
> segundo robustez, eficiência, privacidade e justiça. É um mapa de alternativas,
> não uma coroação.
>
> A frase como está é uma citação de autoridade que a fonte não sustenta. O que
> a literatura sustenta é mais modesto e ainda assim suficiente: reputação
> ancorada em registro imutável é uma **linha de projeto reconhecida e ativa**,
> com trabalhos publicados em venues sérias entre 2019 e 2025.
>
> Trocar "solução definitiva" por "linha reconhecida" custa nada e remove um
> flanco.

### 10.6 O argumento a favor de não inventar uma regra de agregação nova

Há um trabalho recente que serve de defesa direta a uma escolha do AwakeFL:
*Do We Really Need to Design New Byzantine-robust Aggregation Rules?* (NDSS
2025, arXiv 2501.17381). A tese, no abstract: não há necessidade de projetar
novas regras de agregação robusta; o FL pode ser protegido **reforçando as regras
já bem estabelecidas**. Os autores propõem o FoundationFL, que gera updates
sintéticos no servidor e aplica trimmed mean ou mediana sobre o conjunto.

Isso é útil para o AwakeFL por um motivo específico: o projeto usa cosseno e
mediana, ambos conhecidos, e **não reivindica novidade estatística**. Em vez de
isso ser uma fraqueza a esconder, há literatura recente argumentando que é a
postura correta. A contribuição pretendida está em outro lugar — na camada de
governança e auditoria.

### 10.7 O posicionamento honesto do AwakeFL

**O que é razoável reivindicar:**

- **Custo e latência.** A escolha da Solana é defensável contra os trabalhos
  baseados em Ethereum, e é a resposta direta ao problema que o DFL identifica
  (bloco de mais de 10 segundos). Uma ressalva: isso ainda **não foi medido**
  neste projeto (§7.5, objetivo 4 da IC). Enquanto não houver uma transação real
  cronometrada, é argumento de arquitetura, não resultado experimental.
- **A justificativa publicada junto do score** (`D21`). Nos trabalhos revisados,
  o que vai para a cadeia é o número — a reputação, o peso, o voto. O AwakeFL
  grava também a frase que explica de onde o número veio. Não encontrei isso
  descrito nos trabalhos consultados; é modesto, mas é específico.
- **Exclusão permanente travada contra o próprio registro** (`D19`). A autoridade
  não consegue banir quem o histórico público não condena. Isso é diferente de
  "a autoridade é confiável" e diferente de "não há autoridade".
- **Nenhum trabalho de FL sobre Solana apareceu na busca.** Registrado com
  cuidado: significa que a busca de 21/08/2026 não encontrou, **não** que não
  exista. Antes de afirmar ineditismo no texto da IC, é preciso uma busca
  sistemática com string documentada.

**O que não é razoável reivindicar:**

- **Novidade na regra de detecção.** Cosseno contra uma referência é FLTrust;
  cosseno sobre histórico é FoolsGold; mediana por coordenada é Yin et al. A
  combinação específica é do projeto; os ingredientes não.
- **Garantias teóricas.** Yin et al. provam taxas de erro; o AwakeFL não prova
  nada — mede em 10 sementes. É evidência empírica, com desvio padrão, e deve ser
  apresentada como tal.
- **Suporte a *slow poisoning*.** A reivindicação foi **retirada**. Os quatro
  ataques implementados são de efeito imediato; nunca rodamos um envenenamento
  gradual e sutil, então não há experimento que sustente nem um "parcial". Fang
  et al. (2020) mostram que ataques adaptativos passam por detectores desse tipo,
  o que torna a presunção ainda mais arriscada. Fica como hipótese a testar
  (§10.8), não como propriedade do sistema.
- **"Prevenção: Protocolo"** merece nota de rodapé: o banimento é de protocolo,
  mas o score que o dispara é calculado off-chain (§7.1).

**Tabela comparativa corrigida.** Substitui a da seção 12.5 da proposta. A coluna
de *slow poisoning* sai, porque nenhum dos trabalhos comparados foi avaliado por
nós nesse quesito — manter a coluna exigiria medir todos, não só o AwakeFL:

| Solução | Tipo | Auditável | Prevenção | Custo |
| --- | --- | --- | --- | --- |
| FedAvg | Estatística | Não | Nenhuma | Baixo |
| Krum / Median | Estatística | Não | Reativa | Baixo |
| FLTrust | Estatística | Não | Reativa | Médio |
| FoolsGold | Estatística | Não | Reativa | Baixo |
| FLChain | Blockchain | Sim | Protocolo | Alto |
| DFL | Blockchain | Sim | Protocolo | Médio |
| BFLC | Reputação / BC | Sim | Protocolo | Médio |
| BPRFL | Reputação / BC | Sim | Protocolo | Médio |
| AwakeFL | Reputação / BC | Sim | Protocolo¹ | Baixo² |

¹ O banimento é de protocolo; o score que o dispara é calculado off-chain (§7.1).
² Estimado pela arquitetura da Solana. **Ainda não medido** neste projeto (§7.5).

### 10.8 O que a revisão sugere como próximo passo

Ordenado por custo-benefício para a IC:

1. **Implementar o ataque de *slow poisoning*** (`P01`). É a hipótese mais
   interessante que o desenho de reputação permite testar — a memória entre
   rodadas deveria, em tese, pegar o que uma defesa por rodada não pega. E é o
   que permitiria a coluna retirada da tabela comparativa voltar, com número.
2. **Medir latência e custo na Devnet** (`P02`). Fecha o objetivo 4 e sustenta a
   comparação com os trabalhos sobre Ethereum.
3. **Comparar com um baseline da literatura** (`P03`). Rodar o mesmo cenário com
   Krum e com mediana pura, e mostrar onde o AwakeFL fica. Sem isso, os números
   de acurácia não têm régua externa.
4. **Ler o BPRFL a fundo** (`P05`). É o vizinho mais próximo, e o comitê com
   reputação que ele implementa é exatamente o §7.2 deste projeto.

Cada um destes está desdobrado em **O Que Falta no AwakeFL**, com o desenho
experimental e o que a resposta muda — junto com outras oito perguntas em aberto
que não couberam nesta lista.

### 10.9 Referências desta seção

Verificadas em 21 de agosto de 2026.

- Blanchard, P., El Mhamdi, E. M., Guerraoui, R., Stainer, J. (2017). *Machine
  Learning with Adversaries: Byzantine Tolerant Gradient Descent* (Krum). NIPS.
- Yin, D., Chen, Y., Ramchandran, K., Bartlett, P. (2018). *Byzantine-Robust
  Distributed Learning: Towards Optimal Statistical Rates*. ICML, PMLR v80.
  arXiv:1803.01498.
- McMahan, B. et al. (2017). *Communication-Efficient Learning of Deep Networks
  from Decentralized Data*. AISTATS.
- Cao, X., Fang, M., Liu, J., Gong, N. (2021). *FLTrust: Byzantine-robust
  Federated Learning via Trust Bootstrapping*. NDSS. arXiv:2012.13995.
- Fung, C., Yoon, C. J. M., Beschastnikh, I. (2020). *The Limitations of
  Federated Learning in Sybil Settings* (FoolsGold). RAID. arXiv:1808.04866.
- Fang, M., Cao, X., Jia, J., Gong, N. (2020). *Local Model Poisoning Attacks to
  Byzantine-Robust Federated Learning*. USENIX Security, pp. 1623–1640.
- Xu, X., Lyu, L. (2021). *A Reputation Mechanism Is All You Need: Collaborative
  Fairness and Adversarial Robustness in Federated Learning*. FL-ICML'21.
  arXiv:2011.10464.
- Li, Y., Chen, C., Liu, N., Huang, H., Zheng, Z., Yan, Q. (2021). *A
  Blockchain-Based Decentralized Federated Learning Framework with Committee
  Consensus* (BFLC). IEEE Network 35(1):234–241. arXiv:2004.00773.
- Bao, X., Su, C., Xiong, Y., Huang, W., Hu, Y. (2019). *FLChain: A Blockchain
  for Auditable Federated Learning with Trust and Incentive*. BIGCOM.
- Tian, Y. et al. (2023). *DFL: High-Performance Blockchain-Based Federated
  Learning*. ACM Distributed Ledger Technologies: Research and Practice.
  doi:10.1145/3600225. arXiv:2110.15457.
- (2025). *A blockchain-based privacy-preserving reputation consensus federated
  learning* (BPRFL). ScienceDirect, artigo S1110016825011330.
- Rashid, M. M. et al. (2025). *Trustworthy and Fair Federated Learning via
  Reputation-Based Consensus and Adaptive Incentives* (TFFL). IEEE TIFS.
  doi:10.1109/TIFS.2025.3546841.
- *Blockchain-Based Federated Learning System: A Survey on Design Choices* (2023).
  Sensors 23(12):5658. PMC10302079.
- (2025). *Do We Really Need to Design New Byzantine-robust Aggregation Rules?*
  NDSS. arXiv:2501.17381.

---

*Última atualização: 21 de agosto de 2026.*
