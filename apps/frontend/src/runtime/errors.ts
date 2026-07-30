/**
 * Runtime error framework (Phase 2.2).
 *
 * Every failure inside the Runtime is a typed error — no raw `throw new Error()`.
 * Validation failures are returned (not thrown) via the bet-engine result; truly
 * exceptional failures throw a `RuntimeError` subclass which the Runtime converts
 * into an `ERROR` / `SETTLEMENT_FAILED` event. Type-safe and tree-shakable.
 */

export enum RuntimeErrorCode {
  // validation
  INVALID_BET = 'INVALID_BET',
  BELOW_MIN_BET = 'BELOW_MIN_BET',
  ABOVE_MAX_BET = 'ABOVE_MAX_BET',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  INVALID_CURRENCY = 'INVALID_CURRENCY',
  INVALID_RISK = 'INVALID_RISK',
  INVALID_SESSION = 'INVALID_SESSION',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  ROUND_NOT_FOUND = 'ROUND_NOT_FOUND',
  ROUND_ALREADY_SETTLED = 'ROUND_ALREADY_SETTLED',
  // engine / wallet / settlement
  ENGINE_FAILURE = 'ENGINE_FAILURE',
  WALLET_FAILURE = 'WALLET_FAILURE',
  SETTLEMENT_FAILURE = 'SETTLEMENT_FAILURE',
  FEATURE_DISABLED = 'FEATURE_DISABLED',
  UNKNOWN = 'UNKNOWN',
}

/** Base shape for every runtime error. */
export interface IRuntimeError {
  readonly category: 'runtime' | 'game' | 'wallet' | 'settlement' | 'validation';
  readonly code: RuntimeErrorCode;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export interface IValidationError extends IRuntimeError {
  category: 'validation';
}
export interface IGameError extends IRuntimeError {
  category: 'game';
}
export interface IWalletError extends IRuntimeError {
  category: 'wallet';
}
export interface ISettlementError extends IRuntimeError {
  category: 'settlement';
}

export class RuntimeError extends Error implements IRuntimeError {
  readonly category: IRuntimeError['category'] = 'runtime';
  readonly code: RuntimeErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: RuntimeErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends RuntimeError implements IValidationError {
  override readonly category = 'validation' as const;
}
export class GameError extends RuntimeError implements IGameError {
  override readonly category = 'game' as const;
}
export class WalletError extends RuntimeError implements IWalletError {
  override readonly category = 'wallet' as const;
}
export class SettlementError extends RuntimeError implements ISettlementError {
  override readonly category = 'settlement' as const;
}

/** Narrow any thrown value into a RuntimeError so nothing leaks a raw exception. */
export function toRuntimeError(err: unknown): RuntimeError {
  if (err instanceof RuntimeError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new RuntimeError(RuntimeErrorCode.UNKNOWN, message);
}
