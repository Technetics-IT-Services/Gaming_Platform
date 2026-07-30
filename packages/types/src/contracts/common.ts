/**
 * Platform contract primitives (Phase 2.1).
 *
 * The vocabulary every platform module shares. These are type-only definitions
 * — NO business logic, NO IO — so they are safe to import from the browser, the
 * NestJS server, or any game engine. This module is intentionally self-contained
 * (it does not import from the rest of `@gaming-platform/types`) so the whole
 * `contracts/` folder can later be lifted into a dedicated `@gaming-platform/contracts`
 * package without churn.
 */

/**
 * A monetary amount as a fixed-precision decimal **string** — never a JS number
 * / float. Mirrors the database `Decimal(38,18)` and the wallet-engine ledger,
 * so amounts round-trip losslessly between UI, runtime, and backend.
 */
export type Money = string;

/** ISO-4217 currency code, e.g. `'USD'`, `'INR'`, or an internal credit code. */
export type CurrencyCode = string;

/** ISO-8601 timestamp string (UTC). */
export type Timestamp = string;

/* Opaque identifiers — kept as branded-ish aliases for readability at call sites. */
export type PlayerId = string;
/** Stable game slug/key (e.g. `'crash'`, `'dice'`, `'teen-patti'`). */
export type GameId = string;
export type SessionId = string;
export type RoundId = string;
export type BetId = string;

/**
 * The single, canonical game lifecycle EVERY game runs through, in order. The
 * Runtime (see `IGameRuntime`) is responsible for driving these phases; a game
 * engine only participates in `ExecuteEngine` / `CalculateResult`.
 */
export enum GameLifecyclePhase {
  CreateSession = 'create_session',
  ValidateBet = 'validate_bet',
  DebitWallet = 'debit_wallet',
  ExecuteEngine = 'execute_engine',
  CalculateResult = 'calculate_result',
  Settlement = 'settlement',
  CreditWallet = 'credit_wallet',
  SaveHistory = 'save_history',
  UpdateStatistics = 'update_statistics',
  Notify = 'notify',
  Analytics = 'analytics',
}

export enum SessionStatus {
  Active = 'active',
  Idle = 'idle',
  Closed = 'closed',
  Expired = 'expired',
}

export enum RoundStatus {
  Pending = 'pending',
  InProgress = 'in_progress',
  Settled = 'settled',
  Voided = 'voided',
  Refunded = 'refunded',
}

/** The financial outcome of a single bet. */
export enum BetOutcome {
  Win = 'win',
  Loss = 'loss',
  Push = 'push',
  Void = 'void',
  Refund = 'refund',
  InProgress = 'in_progress',
}
