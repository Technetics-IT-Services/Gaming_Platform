'use client';

import type { CurrencyCode, IBetRequest, IGameSession } from '@gaming-platform/types';
import { SessionStatus } from '@gaming-platform/types';

import { RuntimeErrorCode, ValidationError } from './errors';

/**
 * Betting engine (Phase 2.2).
 *
 * Game-INDEPENDENT validation of a bet against limits, balance, currency, risk,
 * and session state. It supports the shared betting model (single / multiple /
 * auto — see `IBetRequest.mode`); auto-bet stepping and auto cash-out are driven
 * by the runtime/UI replaying single bets through this same validator. Returns a
 * typed result — never throws — so the runtime can emit `BET_REJECTED` cleanly.
 */
export interface BetLimits {
  minBet: number;
  maxBet: number;
  allowedCurrencies?: CurrencyCode[];
}

export interface BetValidationContext {
  session: IGameSession | null;
  balance: number;
  limits: BetLimits;
}

export type ValidationResult = { ok: true } | { ok: false; error: ValidationError };

const RISK = new Set(['low', 'medium', 'high']);

export class BetEngine {
  validate(bet: IBetRequest, ctx: BetValidationContext): ValidationResult {
    const fail = (code: RuntimeErrorCode, message: string, details?: Record<string, unknown>): ValidationResult => ({
      ok: false,
      error: new ValidationError(code, message, details),
    });

    // Session
    if (!ctx.session) return fail(RuntimeErrorCode.INVALID_SESSION, 'No active session for this bet.');
    if (ctx.session.status === SessionStatus.Expired) {
      return fail(RuntimeErrorCode.SESSION_EXPIRED, 'Session has expired; start a new one.');
    }

    // Bet shape
    if (!bet.idempotencyKey) return fail(RuntimeErrorCode.INVALID_BET, 'Missing idempotency key.');
    if (!Array.isArray(bet.selections) || bet.selections.length === 0) {
      return fail(RuntimeErrorCode.INVALID_BET, 'Bet has no selections.');
    }
    const stake = Number(bet.stake.amount);
    if (!Number.isFinite(stake) || stake <= 0) {
      return fail(RuntimeErrorCode.INVALID_BET, 'Stake must be a positive amount.', { stake: bet.stake.amount });
    }

    // Limits
    if (stake < ctx.limits.minBet) {
      return fail(RuntimeErrorCode.BELOW_MIN_BET, `Below minimum bet (${ctx.limits.minBet}).`, { stake, min: ctx.limits.minBet });
    }
    if (stake > ctx.limits.maxBet) {
      return fail(RuntimeErrorCode.ABOVE_MAX_BET, `Above maximum bet (${ctx.limits.maxBet}).`, { stake, max: ctx.limits.maxBet });
    }

    // Currency
    if (ctx.limits.allowedCurrencies && !ctx.limits.allowedCurrencies.includes(bet.stake.currency)) {
      return fail(RuntimeErrorCode.INVALID_CURRENCY, `Currency ${bet.stake.currency} not accepted.`);
    }

    // Balance
    if (stake > ctx.balance) {
      return fail(RuntimeErrorCode.INSUFFICIENT_BALANCE, 'Insufficient balance for this bet.', { stake, balance: ctx.balance });
    }

    // Risk
    if (bet.risk && !RISK.has(bet.risk)) {
      return fail(RuntimeErrorCode.INVALID_RISK, `Invalid risk level: ${bet.risk}.`);
    }

    return { ok: true };
  }
}
