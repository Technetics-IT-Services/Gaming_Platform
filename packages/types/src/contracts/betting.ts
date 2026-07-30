/**
 * Shared betting model (Phase 2.1).
 *
 * ONE bet shape for every game — single, multiple, and auto bets, with optional
 * cash-out, risk, multiplier and provably-fair fields, plus forward-compatible
 * hooks for multiplayer / live-dealer / tournaments. Type-only.
 */
import type { BetId, BetOutcome, CurrencyCode, Money, RoundId, SessionId, Timestamp } from './common';

/** How a bet is placed. */
export enum BetMode {
  /** One selection, one round. */
  Single = 'single',
  /** N independent selections settled together (e.g. sports accumulator). */
  Multiple = 'multiple',
  /** Repeated single bets driven by `IAutoBetConfig`. */
  Auto = 'auto',
}

/** Volatility / risk profile a game may expose (e.g. dice, plinko). */
export enum RiskLevel {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

export interface IStake {
  amount: Money;
  currency: CurrencyCode;
}

/**
 * A single selection within a bet. `pick` is the engine-specific payload — a dice
 * target, a roulette number set, a card side, a crash auto-cashout multiplier,
 * etc. The runtime treats it as opaque and hands it to the engine.
 */
export interface IBetSelection<TPick = unknown> {
  marketId?: string;
  pick: TPick;
  /** Decimal odds if the game/market is odds-based (sports, some tables). */
  odds?: number;
}

/** Auto-bet strategy (client-driven; the runtime replays single bets). */
export interface IAutoBetConfig {
  rounds: number;
  onWin?: { resetStake?: boolean; adjustByPct?: number };
  onLoss?: { resetStake?: boolean; adjustByPct?: number };
  stopOnProfit?: Money;
  stopOnLoss?: Money;
}

/**
 * Canonical bet request. Every game, runtime and backend endpoint accepts this
 * shape; game-specific data lives inside `selections[].pick` and `metadata`.
 */
export interface IBetRequest<TPick = unknown> {
  gameId: string;
  sessionId: SessionId;
  stake: IStake;
  mode: BetMode;
  /** 1 entry for `Single`/`Auto`, N for `Multiple`. */
  selections: IBetSelection<TPick>[];
  risk?: RiskLevel;
  autoBet?: IAutoBetConfig;
  /** Provably-fair client seed (optional; runtime supplies a default). */
  clientSeed?: string;
  /** Required for safe retries — the wallet debit/credit dedupes on this. */
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

/** Canonical bet result returned to the UI after settlement. */
export interface IBetResult {
  betId: BetId;
  roundId: RoundId;
  outcome: BetOutcome;
  stake: Money;
  /** Total returned to the player (0 on a loss). */
  payout: Money;
  /** `payout - stake` (may be negative). */
  netProfit: Money;
  /** Effective total-return multiplier (0 on a loss). */
  multiplier: number;
  /** Wallet balance after settlement, when the wallet provider reports it. */
  balanceAfter?: Money;
  settledAt: Timestamp;
}

/** In-round cash-out (crash-style games and any future cashable round). */
export interface ICashOutRequest {
  sessionId: SessionId;
  roundId: RoundId;
  atMultiplier?: number;
  idempotencyKey: string;
}

export interface ICashOutResult {
  roundId: RoundId;
  multiplier: number;
  payout: Money;
  settledAt: Timestamp;
}
