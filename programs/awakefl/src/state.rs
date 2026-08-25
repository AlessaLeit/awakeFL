use anchor_lang::prelude::*;

// ---------------------------------------------------------------------------
// Constantes do modelo de reputacao
// ---------------------------------------------------------------------------

/// Reputacao atribuida a todo participante recem-registrado: NEUTRA, metade
/// da escala. Espelhada off-chain em `reputation.initial = 0.5`.
///
/// Nao e o topo da escala de proposito. `register_participant` e aberto: uma
/// wallet nova custa o rent de uma conta de 66 bytes. Se o recem-chegado
/// nascesse com 1000, o banimento permanente valeria zero — bastaria registrar
/// outra wallet e voltar com a ficha limpa (whitewashing). Comecar no meio faz
/// a reputacao acumulada valer alguma coisa.
///
/// A contrapartida e o cold start: quem entra fica a apenas 100 pontos do
/// limiar de banimento praticado pelo agregador (400). Por isso a autoridade
/// deve conceder um periodo de graca contado por `contrib_count` — tempo de
/// casa do participante, nao numero da rodada global.
pub const INITIAL_REPUTATION: u64 = 500;
/// Teto da escala de reputacao (0..=1000).
pub const MAX_REPUTATION: u64 = 1000;
/// Divisor aplicado a reputacao ao penalizar um malicioso.
pub const PENALTY_DIVISOR: u64 = 10;

/// Limiar abaixo do qual um participante pode ser penalizado. Espelha o
/// `reputation.ban_threshold` do off-chain (0,4 na escala [0,1]).
///
/// Existe para que o banimento seja uma CONSEQUENCIA VERIFICAVEL e nao uma
/// decisao da autoridade. Sem esta constante, `penalize_participant` so
/// checava se a conta ja estava banida — ou seja, a autoridade podia banir
/// permanentemente um participante com reputacao 1000, sem justificativa
/// alguma, e o programa aceitava. Com ela, o contrato se recusa a executar um
/// banimento que os proprios numeros dele nao condenam, e qualquer pessoa
/// confere a legitimidade lendo a conta.
///
/// Nao elimina o abuso: a autoridade ainda pode empurrar alguem para baixo do
/// limiar com scores injustos ao longo de varias rodadas. Mas forca o abuso a
/// ser lento e publico, em vez de instantaneo e invisivel.
pub const BAN_THRESHOLD: u64 = 400;
/// Comprimento maximo de `update_hash`. 64 = SHA-256 em hexadecimal.
/// Este numero entra DIRETO no calculo de espaco da conta Contribution.
pub const MAX_HASH_LEN: usize = 64;

// ---------------------------------------------------------------------------
// Config global
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct Config {
    /// Agregador da rodada: valida contribuicoes e penaliza.
    pub authority: Pubkey, // 32
    pub current_round: u64,      // 8
    pub total_participants: u64, // 8
    pub bump: u8,                // 1
}
// INIT_SPACE = 49 | space = 8 + 49 = 57

// ---------------------------------------------------------------------------
// Participant
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct Participant {
    /// Dono do no de treinamento.
    pub owner: Pubkey, // 32
    /// Score de reputacao, escala 0..=1000, inicia em 500.
    pub reputation: u64, // 8
    /// Numero de contribuicoes submetidas (validadas ou nao). Alem da
    /// estatistica, e o "tempo de casa" do participante: o agregador usa este
    /// contador para decidir o periodo de graca antes de poder penalizar,
    /// de modo que quem se registra na rodada 50 tenha a mesma protecao de
    /// quem estava la desde a primeira.
    pub contrib_count: u64, // 8
    /// Banimento permanente: nao ha instrucao que reverta.
    pub is_banned: bool, // 1
    /// Reservado para o mecanismo de stake/slashing (fora do escopo do MVP).
    pub stake_amount: u64, // 8
    /// Bump do PDA. NAO estava na sua spec: guardar o bump evita
    /// recalcular o PDA (~1.500 CU por chamada a find_program_address)
    /// em toda instrucao que valide esta conta.
    pub bump: u8, // 1
}
// INIT_SPACE = 32 + 8 + 8 + 1 + 8 + 1 = 58
// space      = 8 (discriminator) + 58 = 66 bytes

// ---------------------------------------------------------------------------
// Contribution
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct Contribution {
    /// PDA do Participant que submeteu (nao a wallet dona).
    pub participant: Pubkey, // 32
    /// Rodada de treinamento a que esta contribuicao pertence.
    pub round: u64, // 8
    /// Hash da atualizacao de pesos. O tensor em si fica off-chain.
    /// O #[max_len] e OBRIGATORIO: sem ele, InitSpace nao compila para String,
    /// porque uma String tem tamanho variavel e a conta precisa ser fixa.
    #[max_len(MAX_HASH_LEN)]
    pub update_hash: String, // 4 (prefixo de tamanho) + 64 = 68
    /// Numero de amostras usadas no treino local (peso do FedAvg).
    pub n_samples: u64, // 8
    /// Loss reportado pelo participante. Valor auto-declarado: nao e prova.
    pub loss: f64, // 8
    /// Acuracia reportada pelo participante. Idem.
    pub accuracy: f64, // 8
    /// Estado da avaliacao pela autoridade.
    pub status: ContributionStatus, // 1
    pub bump: u8, // 1
}
// INIT_SPACE = 32 + 8 + 68 + 8 + 8 + 8 + 1 + 1 = 134
// space      = 8 (discriminator) + 134 = 142 bytes

/// Enum de dados puros (todas as variantes sem payload) => 1 byte.
/// `InitSpace` calcula 1 (tag) + tamanho da MAIOR variante (aqui, 0).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum ContributionStatus {
    Pendente,
    Aprovado,
    Rejeitado,
    /// Submissao que ficou sem julgamento e teve a rodada encerrada.
    ///
    /// Variante NOVA vai no FIM, pela mesma razao das variantes de erro: a
    /// posicao vira o byte gravado na conta. Inserir no meio faria toda conta
    /// ja existente ser lida com o status errado.
    ///
    /// Nada e apagado ao expirar — hash, rodada e metricas continuam na conta.
    /// E um estado TERMINAL, nao uma remocao: o registro de que houve
    /// submissao sobrevive, e e isso que mantem o livro-razao auditavel.
    Expirado,
}

impl Default for ContributionStatus {
    fn default() -> Self {
        Self::Pendente
    }
}

impl Participant {
    /// Media movel exponencial: R(t) = 0.5*R(t-1) + 0.5*S(t)
    /// Em aritmetica inteira vira (R(t-1) + S(t)) / 2 — a divisao trunca,
    /// perdendo no maximo 1 ponto por rodada.
    pub fn apply_ema(&mut self, score: u64) {
        self.reputation = (self.reputation + score) / 2;
    }
}
