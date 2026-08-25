// ============================================================================
// ARQUIVO GERADO — nao edite a mao.
//
// Fonte: programs/awakefl/src/lib.rs + programs/awakefl/src/state.rs
// Gerar : python scripts/gerar-playground.py
//
// Esta e a versao achatada para o Solana Playground, que espera um unico
// src/lib.rs. A logica e identica a do programa real; muda so o declare_id!,
// que o Playground sincroniza sozinho no build.
// ============================================================================

use anchor_lang::prelude::*;

// Program ID do deploy na Devnet (Solana Playground, 2026-08-12).
// Se um dia rodar `anchor build` local, `anchor keys sync` mantém este valor e
// o do Anchor.toml em sincronia.
declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod awakefl {
    use super::*;

    /// Cria o Config global do sistema. Chamado uma única vez.
    /// O signer vira a autoridade (o agregador da rodada de FL).
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.current_round = 0;
        config.total_participants = 0;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Registra o signer como participante, com reputação inicial 500.
    pub fn register_participant(ctx: Context<RegisterParticipant>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let participant = &mut ctx.accounts.participant;

        participant.owner = ctx.accounts.owner.key();
        participant.reputation = INITIAL_REPUTATION;
        participant.contrib_count = 0;
        participant.is_banned = false;
        participant.stake_amount = 0;
        participant.bump = ctx.bumps.participant;

        config.total_participants = config
            .total_participants
            .checked_add(1)
            .ok_or(FlError::MathOverflow)?;

        emit!(ParticipantRegistered {
            participant: participant.key(),
            owner: participant.owner,
            reputation: participant.reputation,
            round: config.current_round,
        });
        Ok(())
    }

    /// Submete o hash do update de pesos da rodada corrente, junto das
    /// métricas auto-declaradas. Um participante banido não consegue submeter.
    pub fn submit_contribution(
        ctx: Context<SubmitContribution>,
        update_hash: String,
        n_samples: u64,
        loss: f64,
        accuracy: f64,
    ) -> Result<()> {
        // Sem esta checagem, uma String maior que MAX_HASH_LEN estoura o
        // buffer alocado e a instrução falha com AccountDidNotSerialize,
        // um erro bem menos legível do que este.
        require!(update_hash.len() <= MAX_HASH_LEN, FlError::HashTooLong);

        let config = &ctx.accounts.config;
        let participant = &mut ctx.accounts.participant;
        let contribution = &mut ctx.accounts.contribution;

        contribution.participant = participant.key();
        contribution.round = config.current_round;
        contribution.update_hash = update_hash;
        contribution.n_samples = n_samples;
        contribution.loss = loss;
        contribution.accuracy = accuracy;
        contribution.status = ContributionStatus::Pendente;
        contribution.bump = ctx.bumps.contribution;

        participant.contrib_count = participant
            .contrib_count
            .checked_add(1)
            .ok_or(FlError::MathOverflow)?;

        emit!(ContributionSubmitted {
            participant: participant.key(),
            round: contribution.round,
            n_samples,
        });
        Ok(())
    }

    /// A autoridade avalia a contribuição com um score 0..=1000.
    /// A reputação é atualizada pela média móvel exponencial:
    ///   R(t) = 0.5 * R(t-1) + 0.5 * S(t)  ->  (R(t-1) + S(t)) / 2
    pub fn validate_contribution(ctx: Context<ValidateContribution>, score: u64) -> Result<()> {
        require!(score <= MAX_REPUTATION, FlError::InvalidScore);

        let participant = &mut ctx.accounts.participant;
        let contribution = &mut ctx.accounts.contribution;

        require!(
            contribution.status == ContributionStatus::Pendente,
            FlError::AlreadyValidated
        );

        let previous = participant.reputation;
        participant.apply_ema(score);

        // Metade da escala é o limiar entre contribuição aceita e rejeitada.
        contribution.status = if score >= MAX_REPUTATION / 2 {
            ContributionStatus::Aprovado
        } else {
            ContributionStatus::Rejeitado
        };

        emit!(ContributionValidated {
            participant: participant.key(),
            round: contribution.round,
            score,
            previous_reputation: previous,
            new_reputation: participant.reputation,
        });
        Ok(())
    }

    /// Penaliza um malicioso: reputação / 10 e banimento PERMANENTE.
    /// É o contra-ataque ao "sleepy adversary" — toda a reputação
    /// acumulada em rodadas honestas é destruída de uma vez.
    ///
    /// O banimento é uma **consequência verificável**, não uma decisão da
    /// autoridade: o programa só executa se a própria reputação registrada
    /// já estiver abaixo de `BAN_THRESHOLD`. Assim qualquer pessoa confere a
    /// legitimidade do ban lendo a conta, sem precisar confiar em ninguém.
    pub fn penalize_participant(ctx: Context<PenalizeParticipant>, reason_code: u8) -> Result<()> {
        let participant = &mut ctx.accounts.participant;
        require!(!participant.is_banned, FlError::AlreadyBanned);
        require!(
            participant.reputation < BAN_THRESHOLD,
            FlError::ReputationAboveThreshold
        );

        let previous = participant.reputation;
        participant.reputation = previous / PENALTY_DIVISOR;
        participant.is_banned = true;

        emit!(ParticipantPenalized {
            participant: participant.key(),
            owner: participant.owner,
            previous_reputation: previous,
            new_reputation: participant.reputation,
            reason_code,
        });
        Ok(())
    }

    /// Encerra uma submissão que ficou sem julgamento e cuja rodada já passou.
    ///
    /// Não remove nada: hash, rodada e métricas declaradas continuam gravados,
    /// e a conta segue existindo. Só o `status` avança para um estado terminal
    /// — a mesma coisa que `validate_contribution` já faz ao gravar `Aprovado`
    /// ou `Rejeitado`. Por isso expirar não abala a garantia de auditoria:
    /// quem lê a cadeia continua sabendo que houve submissão, de quem, em que
    /// rodada e com que compromisso.
    ///
    /// Existe porque, sem ela, uma pendência que nunca poderá receber nota
    /// — resíduo de teste, participante que sumiu — fica para sempre na fila
    /// da autoridade, sem nenhum caminho de saída.
    ///
    /// O `contrib_count` do participante NÃO é decrementado: a submissão
    /// aconteceu e o registro dela permanece. Mexer no contador aqui seria
    /// reescrever um fato para melhorar uma estatística.
    pub fn expire_contribution(ctx: Context<ExpireContribution>) -> Result<()> {
        let config = &ctx.accounts.config;
        let contribution = &mut ctx.accounts.contribution;

        require!(
            contribution.status == ContributionStatus::Pendente,
            FlError::AlreadyValidated
        );
        // Só rodada encerrada. Na rodada corrente a autoridade ainda tem a
        // obrigação de pontuar; expirar seria fugir do trabalho.
        require!(
            contribution.round < config.current_round,
            FlError::RoundStillOpen
        );

        contribution.status = ContributionStatus::Expirado;

        emit!(ContributionExpired {
            participant: contribution.participant,
            round: contribution.round,
        });
        Ok(())
    }

    /// Avança a rodada global de FL. Só a autoridade pode.
    pub fn advance_round(ctx: Context<AdvanceRound>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.current_round = config
            .current_round
            .checked_add(1)
            .ok_or(FlError::MathOverflow)?;

        emit!(RoundAdvanced {
            round: config.current_round,
        });
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Contextos de contas
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Config::INIT_SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterParticipant<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = owner,
        space = 8 + Participant::INIT_SPACE,
        seeds = [b"participant", owner.key().as_ref()],
        bump
    )]
    pub participant: Account<'info, Participant>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitContribution<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"participant", owner.key().as_ref()],
        bump = participant.bump,
        has_one = owner,
        constraint = !participant.is_banned @ FlError::ParticipantBanned
    )]
    pub participant: Account<'info, Participant>,
    #[account(
        init,
        payer = owner,
        space = 8 + Contribution::INIT_SPACE,
        seeds = [
            b"contribution",
            participant.key().as_ref(),
            config.current_round.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub contribution: Account<'info, Contribution>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ValidateContribution<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"participant", participant.owner.as_ref()],
        bump = participant.bump
    )]
    pub participant: Account<'info, Participant>,
    #[account(
        mut,
        seeds = [
            b"contribution",
            participant.key().as_ref(),
            contribution.round.to_le_bytes().as_ref()
        ],
        bump = contribution.bump,
        constraint = contribution.participant == participant.key() @ FlError::ContributionMismatch
    )]
    pub contribution: Account<'info, Contribution>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ExpireContribution<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [
            b"contribution",
            contribution.participant.as_ref(),
            contribution.round.to_le_bytes().as_ref()
        ],
        bump = contribution.bump
    )]
    pub contribution: Account<'info, Contribution>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct PenalizeParticipant<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"participant", participant.owner.as_ref()],
        bump = participant.bump
    )]
    pub participant: Account<'info, Participant>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct AdvanceRound<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,
    pub authority: Signer<'info>,
}

// ---------------------------------------------------------------------------
// Eventos (a trilha de auditoria imutável)
// ---------------------------------------------------------------------------

#[event]
pub struct ParticipantRegistered {
    pub participant: Pubkey,
    pub owner: Pubkey,
    pub reputation: u64,
    pub round: u64,
}

#[event]
pub struct ContributionSubmitted {
    pub participant: Pubkey,
    pub round: u64,
    pub n_samples: u64,
}

#[event]
pub struct ContributionValidated {
    pub participant: Pubkey,
    pub round: u64,
    pub score: u64,
    pub previous_reputation: u64,
    pub new_reputation: u64,
}

#[event]
pub struct ParticipantPenalized {
    pub participant: Pubkey,
    pub owner: Pubkey,
    pub previous_reputation: u64,
    pub new_reputation: u64,
    pub reason_code: u8,
}

#[event]
pub struct RoundAdvanced {
    pub round: u64,
}

#[event]
pub struct ContributionExpired {
    pub participant: Pubkey,
    pub round: u64,
}

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------

#[error_code]
pub enum FlError {
    #[msg("Score deve estar entre 0 e 1000")]
    InvalidScore,
    #[msg("Esta contribuicao ja foi validada")]
    AlreadyValidated,
    #[msg("Participante banido nao pode contribuir")]
    ParticipantBanned,
    #[msg("Participante ja esta banido")]
    AlreadyBanned,
    #[msg("Contribuicao nao pertence a este participante")]
    ContributionMismatch,
    #[msg("update_hash excede o tamanho maximo")]
    HashTooLong,
    #[msg("Overflow aritmetico")]
    MathOverflow,
    // Variante NOVA vai sempre no fim do enum: o Anchor numera os erros pela
    // ordem de declaracao (6000, 6001, ...), entao inserir no meio renumeraria
    // todos os seguintes e qualquer cliente com IDL antigo passaria a exibir a
    // mensagem errada.
    #[msg("Reputacao ainda acima do limiar: o banimento precisa ser justificado pelo registro")]
    ReputationAboveThreshold,
    #[msg("A rodada desta contribuicao ainda esta aberta: pontue em vez de expirar")]
    RoundStillOpen,
}

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
