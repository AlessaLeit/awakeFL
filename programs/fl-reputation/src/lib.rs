use anchor_lang::prelude::*;

// ATENÇÃO: este ID é um placeholder.
// Após `anchor build`, rode `anchor keys sync` (ou copie de
// `anchor keys list`) para substituir aqui E no Anchor.toml.
// No Solana Playground o build já sincroniza este valor sozinho.
declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

/// Reputação atribuída a todo participante recém-registrado.
pub const INITIAL_REPUTATION: u16 = 500;
/// Teto da escala de reputação (0..=1000).
pub const MAX_REPUTATION: u16 = 1000;
/// Divisor aplicado à reputação ao penalizar um malicioso.
pub const PENALTY_DIVISOR: u16 = 10;

#[program]
pub mod fl_reputation {
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
    /// Auto-registro: qualquer wallet pode entrar, a reputação é que decide o peso.
    pub fn register_participant(ctx: Context<RegisterParticipant>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let participant = &mut ctx.accounts.participant;

        participant.owner = ctx.accounts.owner.key();
        participant.reputation = INITIAL_REPUTATION;
        participant.contributions_count = 0;
        participant.validated_count = 0;
        participant.last_score = 0;
        participant.joined_round = config.current_round;
        participant.banned = false;
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

    /// Submete o hash do update de modelo da rodada corrente.
    /// Não guardamos o modelo, só o compromisso criptográfico dele.
    /// Um participante banido não consegue submeter (constraint abaixo).
    pub fn submit_contribution(ctx: Context<SubmitContribution>, model_hash: [u8; 32]) -> Result<()> {
        let config = &ctx.accounts.config;
        let participant = &mut ctx.accounts.participant;
        let contribution = &mut ctx.accounts.contribution;

        contribution.participant = participant.key();
        contribution.round = config.current_round;
        contribution.model_hash = model_hash;
        contribution.score = 0;
        contribution.validated = false;
        contribution.timestamp = Clock::get()?.unix_timestamp;
        contribution.bump = ctx.bumps.contribution;

        participant.contributions_count = participant
            .contributions_count
            .checked_add(1)
            .ok_or(FlError::MathOverflow)?;

        emit!(ContributionSubmitted {
            participant: participant.key(),
            round: contribution.round,
            model_hash,
            timestamp: contribution.timestamp,
        });
        Ok(())
    }

    /// A autoridade avalia a contribuição com um score 0..=1000 e a
    /// reputação é atualizada pela média móvel exponencial:
    ///
    ///   R(t) = 0.5 * R(t-1) + 0.5 * S(t)  ->  (R(t-1) + S(t)) / 2
    ///
    /// Aritmética inteira: a divisão trunca (perde no máximo 1 ponto).
    pub fn validate_contribution(ctx: Context<ValidateContribution>, score: u16) -> Result<()> {
        require!(score <= MAX_REPUTATION, FlError::InvalidScore);

        let participant = &mut ctx.accounts.participant;
        let contribution = &mut ctx.accounts.contribution;

        require!(!contribution.validated, FlError::AlreadyValidated);

        let previous = participant.reputation;
        let new_reputation = ((previous as u32 + score as u32) / 2) as u16;

        participant.reputation = new_reputation;
        participant.last_score = score;
        participant.validated_count = participant
            .validated_count
            .checked_add(1)
            .ok_or(FlError::MathOverflow)?;

        contribution.score = score;
        contribution.validated = true;

        emit!(ContributionValidated {
            participant: participant.key(),
            round: contribution.round,
            score,
            previous_reputation: previous,
            new_reputation,
        });
        Ok(())
    }

    /// Penaliza um malicioso: reputação / 10 e banimento PERMANENTE.
    /// É o contra-ataque ao "sleepy adversary" — toda a reputação
    /// acumulada em rodadas honestas é destruída de uma vez.
    pub fn penalize_participant(ctx: Context<PenalizeParticipant>, reason_code: u8) -> Result<()> {
        let participant = &mut ctx.accounts.participant;
        require!(!participant.banned, FlError::AlreadyBanned);

        let previous = participant.reputation;
        participant.reputation = previous / PENALTY_DIVISOR;
        participant.banned = true;

        emit!(ParticipantPenalized {
            participant: participant.key(),
            owner: participant.owner,
            previous_reputation: previous,
            new_reputation: participant.reputation,
            reason_code,
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
        constraint = !participant.banned @ FlError::ParticipantBanned
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
// Estado
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct Config {
    /// Agregador da rodada: valida contribuições e penaliza.
    pub authority: Pubkey,
    pub current_round: u64,
    pub total_participants: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Participant {
    pub owner: Pubkey,
    /// Escala 0..=1000, inicia em 500.
    pub reputation: u16,
    pub contributions_count: u64,
    pub validated_count: u64,
    pub last_score: u16,
    pub joined_round: u64,
    /// Banimento é permanente — não há instrução para reverter.
    pub banned: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Contribution {
    pub participant: Pubkey,
    pub round: u64,
    /// SHA-256 do update de modelo. O peso fica off-chain.
    pub model_hash: [u8; 32],
    pub score: u16,
    pub validated: bool,
    pub timestamp: i64,
    pub bump: u8,
}

// ---------------------------------------------------------------------------
// Eventos (a trilha de auditoria imutável)
// ---------------------------------------------------------------------------

#[event]
pub struct ParticipantRegistered {
    pub participant: Pubkey,
    pub owner: Pubkey,
    pub reputation: u16,
    pub round: u64,
}

#[event]
pub struct ContributionSubmitted {
    pub participant: Pubkey,
    pub round: u64,
    pub model_hash: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct ContributionValidated {
    pub participant: Pubkey,
    pub round: u64,
    pub score: u16,
    pub previous_reputation: u16,
    pub new_reputation: u16,
}

#[event]
pub struct ParticipantPenalized {
    pub participant: Pubkey,
    pub owner: Pubkey,
    pub previous_reputation: u16,
    pub new_reputation: u16,
    pub reason_code: u8,
}

#[event]
pub struct RoundAdvanced {
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
    #[msg("Overflow aritmetico")]
    MathOverflow,
}
