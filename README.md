<div align="center">

# AwakeFL

**Treinar juntos sem precisar confiar uns nos outros.**

Reputação auditável em blockchain para Federated Learning — para que um
participante mal-intencionado seja identificado, penalizado e removido, com o
histórico registrado de forma que ninguém possa reescrever.

[![Devnet](https://img.shields.io/badge/Solana-Devnet-14F195?style=flat-square)](https://explorer.solana.com/address/GhMhTkv7jeHMejEyypQaEFPqduHgXDSzE5g7jE3rXGRA?cluster=devnet)
[![Anchor](https://img.shields.io/badge/Anchor-0.31-blue?style=flat-square)](https://www.anchor-lang.com/)
[![Status](https://img.shields.io/badge/status-MVP%20em%20pesquisa-orange?style=flat-square)](#-status-do-projeto)

**[Visão técnica →](README-TECNICO.md)** · como funciona por dentro, como rodar,
como contribuir com código

</div>

---

## O problema

Hospitais têm dados de pacientes. Bancos têm dados de fraude. Nenhum dos dois
pode entregar esses dados para ninguém — e os dois ganhariam muito com um modelo
treinado sobre o conjunto.

**Federated Learning** resolve metade disso: cada instituição treina localmente e
envia só os parâmetros do modelo, nunca os dados. O dado sensível nunca sai de
casa.

A outra metade continua aberta. O servidor que junta essas contribuições **não
tem como saber se elas são honestas**. Um participante pode enviar parâmetros
corrompidos e degradar o modelo de todo mundo — ou pior, inserir um
comportamento específico que só ele sabe acionar. E como as contribuições
individuais não deixam rastro auditável, ninguém consegue provar depois quem fez
o quê.

> É o problema de sempre da colaboração entre desconhecidos: alguém precisa
> pagar a conta de confiar primeiro.

## O que o AwakeFL faz

Cada contribuição vira um registro público e permanente. Cada participante
carrega uma reputação que sobe quando ele colabora e desce quando ele destoa.
Quem cai abaixo do limiar é banido — e o banimento é **definitivo**, porque está
gravado onde ninguém apaga.

```
   Participante treina localmente
              ↓
   Registra o compromisso na blockchain    ← hash dos pesos, imutável
              ↓
   O sistema mede a consistência           ← contra o consenso da rodada
              ↓
   A reputação é atualizada                ← R(t) = 0,5·R(t-1) + 0,5·S(t)
              ↓
   Abaixo do limiar → banimento permanente
```

Três coisas que fazem diferença no desenho:

**A nota não é digitada por ninguém.** Ela é calculada comparando a direção da
contribuição com o consenso dos demais participantes daquela rodada. O
validador assina o que a lógica produziu — não escolhe o número.

**A justificativa vai junto.** Não fica só "score 340". Fica *"veto de norma:
update 2,67× a mediana do grupo — o crédito de direção foi zerado"*. Um número
sozinho não é auditável; a razão é.

**A autoridade não pode banir quem o histórico não condena.** O programa recusa a
penalização se a reputação registrada ainda estiver acima do limiar. Isso não
elimina a necessidade de um coordenador — mas o prende ao registro público.

## Funciona?

Testado em 10 sementes independentes, com 10 participantes e 12 rodadas, sobre
MNIST com distribuição não-IID:

| Cenário | Acurácia final |
| --- | --- |
| **A** — sem atacante | 98,23% ± 0,33 |
| **B** — com atacante, sem defesa | 69,13% ± 26,78 |
| **C** — com atacante, defesa ligada | 98,02% ± 0,35 |

Precisão e recall da detecção: **1,00 ± 0,00**. Nenhum honesto banido por engano,
nenhum atacante escapou. Banimentos entre as rodadas 6 e 7.

O número mais interessante não é a média — é o desvio de 26,78 no cenário B. O
ataque não apenas derruba a acurácia: torna o resultado **imprevisível**. A
defesa devolve previsibilidade, e é isso que permite alguém depender do modelo
para alguma coisa.

## O que dá para ver hoje

O painel roda na Devnet da Solana, com carteira Phantom ou Solflare:

| Tela | O que faz |
| --- | --- |
| **Visão geral** | reputação, rodada corrente, estado do seu nó |
| **Nova contribuição** | envia o arquivo de pesos e registra o compromisso na chain |
| **Extrato** | histórico completo das suas contribuições e assinaturas |
| **Regras** | as regras de consenso e penalidade, em português |
| **Validador** | fecha a rodada e assina os scores calculados |

Também há uma [simulação determinística](web/README.md) do ciclo, que mostra as
mesmas regras sem precisar de carteira nenhuma.

O SOL usado é de Devnet — não tem valor, e todas as contas são públicas.

## Por que Solana

A ideia de juntar blockchain com Federated Learning não é nova, e a crítica
recorrente na literatura é o custo: registrar cada contribuição de cada rodada em
redes onde um bloco leva mais de dez segundos torna o esquema caro e lento.

Solana muda essa conta. A escolha aqui é por custo e latência de transação, não
por preferência de ecossistema.

> **Ressalva honesta:** esse custo ainda **não foi medido** neste projeto.
> Nenhuma transação real foi cronometrada até agora. É argumento de arquitetura,
> não resultado experimental — e está na fila como próximo passo.

---

## 🚧 Status do projeto

**Isto é um MVP de pesquisa em desenvolvimento ativo — não é um produto pronto
para produção.**

O projeto nasceu como exploração técnica durante o curso **Bloco 4** e está sendo formalizado como
**Iniciação Científica**, com a intenção de crescer até virar **Trabalho de
Conclusão de Curso**. O que existe hoje é uma prova de conceito completa de ponta
a ponta: a simulação de Federated Learning, o programa on-chain publicado na
Devnet e a interface que executa o ciclo inteiro.

O que ainda **não** existe, e está declarado de propósito:

- **O cálculo da nota acontece fora da blockchain.** A cadeia registra e audita,
  mas não recalcula. Quem confia no número, confia em quem o calculou. Fechar
  isso exige prova de conhecimento zero ou um comitê de validadores.
- **Há uma autoridade única.** Comitê, quórum e prazo de contestação estão
  desenhados e não implementados.
- **Nada foi testado fora do MNIST**, nem com participação parcial por rodada.
- **Resistência a Sybil é parcial.** Uma identidade nova custa quase nada, então
  o banimento permanente vale menos do que deveria.
- **Devnet apenas.** Não há deploy em mainnet e não haverá enquanto o desenho
  estiver mudando.

Cada um desses pontos está registrado com o desenho experimental necessário para
respondê-lo — não como intenção vaga, mas como pergunta de pesquisa formulada.

## Documentação

| Documento | Para quem |
| --- | --- |
| **[Visão técnica](README-TECNICO.md)** | quem quer rodar, entender por dentro ou contribuir |
| [Anatomia do AwakeFL](https://github.com/AlessaLeit/awakeFL/blob/documentacao/awakefl-fl/docs/anatomia-awakefl.html) | a arquitetura em dois níveis de leitura |
| [Aritmética da Reputação](https://github.com/AlessaLeit/awakeFL/blob/documentacao/awakefl-fl/docs/aritmetica-reputacao.html) | as contas passo a passo, com números reais |
| [Registro de decisões](https://github.com/AlessaLeit/awakeFL/blob/documentacao/awakefl-fl/docs/registro-de-decisoes.md) | por que cada escolha, e o que se paga por ela |
| [Trajetória do desenvolvimento](https://github.com/AlessaLeit/awakeFL/blob/documentacao/awakefl-fl/docs/trajetoria-do-desenvolvimento.md) | a história do projeto e os trabalhos relacionados |
| [O Que Falta](https://github.com/AlessaLeit/awakeFL/blob/documentacao/awakefl-fl/docs/o-que-falta.md) | as perguntas em aberto, e como respondê-las |

> Os documentos acima vivem na branch `documentacao`.

---

<div align="center">
<sub>Projeto de pesquisa · Solana Devnet · 2026</sub>
</div>
