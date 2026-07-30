import { describe, expect, it } from 'vitest';

import {
  GameError,
  RuntimeError,
  RuntimeErrorCode,
  SettlementError,
  ValidationError,
  WalletError,
  toRuntimeError,
} from './errors';

/**
 * Error framework (STEP 2 / STEP 11).
 *
 * Every failure inside the runtime must be a typed `RuntimeError` with a stable
 * `code` + `category` — no raw `Error` escapes. These lock the taxonomy so
 * consumers can switch on `code` and the runtime can map errors to events.
 */
describe('errors — RuntimeError base', () => {
  it('carries code, message, details and a real Error identity', () => {
    const err = new RuntimeError(RuntimeErrorCode.UNKNOWN, 'boom', { a: 1 });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(RuntimeError);
    expect(err.code).toBe(RuntimeErrorCode.UNKNOWN);
    expect(err.message).toBe('boom');
    expect(err.details).toEqual({ a: 1 });
    expect(err.category).toBe('runtime');
  });

  it('names the error after its concrete subclass (for stack traces)', () => {
    expect(new RuntimeError(RuntimeErrorCode.UNKNOWN, 'x').name).toBe('RuntimeError');
    expect(new ValidationError(RuntimeErrorCode.INVALID_BET, 'x').name).toBe('ValidationError');
    expect(new WalletError(RuntimeErrorCode.WALLET_FAILURE, 'x').name).toBe('WalletError');
  });

  it('allows details to be omitted', () => {
    const err = new RuntimeError(RuntimeErrorCode.UNKNOWN, 'no details');
    expect(err.details).toBeUndefined();
  });
});

describe('errors — subclass categories', () => {
  it('each subclass pins its category discriminant', () => {
    expect(new ValidationError(RuntimeErrorCode.INVALID_BET, 'x').category).toBe('validation');
    expect(new GameError(RuntimeErrorCode.ENGINE_FAILURE, 'x').category).toBe('game');
    expect(new WalletError(RuntimeErrorCode.WALLET_FAILURE, 'x').category).toBe('wallet');
    expect(new SettlementError(RuntimeErrorCode.SETTLEMENT_FAILURE, 'x').category).toBe('settlement');
  });

  it('subclasses remain instanceof RuntimeError (single catch point)', () => {
    expect(new ValidationError(RuntimeErrorCode.INVALID_BET, 'x')).toBeInstanceOf(RuntimeError);
    expect(new GameError(RuntimeErrorCode.ENGINE_FAILURE, 'x')).toBeInstanceOf(RuntimeError);
  });
});

describe('errors — toRuntimeError', () => {
  it('passes a RuntimeError through unchanged', () => {
    const original = new ValidationError(RuntimeErrorCode.BELOW_MIN_BET, 'too small');
    expect(toRuntimeError(original)).toBe(original);
  });

  it('wraps a plain Error, preserving the message', () => {
    const wrapped = toRuntimeError(new Error('native failure'));
    expect(wrapped).toBeInstanceOf(RuntimeError);
    expect(wrapped.code).toBe(RuntimeErrorCode.UNKNOWN);
    expect(wrapped.message).toBe('native failure');
  });

  it('stringifies non-Error throwables', () => {
    expect(toRuntimeError('string failure').message).toBe('string failure');
    expect(toRuntimeError(42).message).toBe('42');
    expect(toRuntimeError(null).message).toBe('null');
  });
});
