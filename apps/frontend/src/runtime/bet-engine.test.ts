import type { IBetRequest, IGameSession } from '@gaming-platform/types';
import { BetMode, RiskLevel, SessionStatus } from '@gaming-platform/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { BetEngine, type BetValidationContext } from './bet-engine';
import { RuntimeErrorCode, ValidationError } from './errors';

/**
 * Bet engine (STEP 3).
 *
 * Game-independent validation of a bet against session, shape, limits, currency,
 * balance and risk. It must NEVER throw (it returns a typed result) and must NEVER
 * allow an invalid bet through. Every rejection branch is covered plus the
 * boundary (== min, == max, == balance) and every valid mode/risk.
 */

const session = (over: Partial<IGameSession> = {}): IGameSession => ({
  sessionId: 'sess_1',
  gameId: 'crash',
  playerId: 'demo-player',
  currency: 'INR',
  status: SessionStatus.Active,
  createdAt: new Date().toISOString(),
  ...over,
});

const bet = (over: Partial<IBetRequest> = {}): IBetRequest => ({
  gameId: 'crash',
  sessionId: 'sess_1',
  stake: { amount: '10', currency: 'INR' },
  mode: BetMode.Single,
  selections: [{ pick: 2 }],
  idempotencyKey: 'idem-1',
  ...over,
});

const ctx = (over: Partial<BetValidationContext> = {}): BetValidationContext => ({
  session: session(),
  balance: 1000,
  limits: { minBet: 1, maxBet: 1000 },
  ...over,
});

let engine: BetEngine;
beforeEach(() => {
  engine = new BetEngine();
});

/** Assert a rejection with a specific code, and that a typed ValidationError came back. */
function expectReject(result: ReturnType<BetEngine['validate']>, code: RuntimeErrorCode) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected rejection');
  expect(result.error).toBeInstanceOf(ValidationError);
  expect(result.error.code).toBe(code);
}

describe('bet-engine — happy path', () => {
  it('accepts a well-formed single bet within limits and balance', () => {
    expect(engine.validate(bet(), ctx())).toEqual({ ok: true });
  });

  it('accepts multiple- and auto-mode bets', () => {
    expect(engine.validate(bet({ mode: BetMode.Multiple, selections: [{ pick: 1 }, { pick: 2 }] }), ctx()).ok).toBe(true);
    expect(engine.validate(bet({ mode: BetMode.Auto, autoBet: { rounds: 5 } }), ctx()).ok).toBe(true);
  });

  it('accepts every declared risk level', () => {
    for (const risk of [RiskLevel.Low, RiskLevel.Medium, RiskLevel.High]) {
      expect(engine.validate(bet({ risk }), ctx()).ok).toBe(true);
    }
  });
});

describe('bet-engine — session guards', () => {
  it('rejects a missing session', () => {
    expectReject(engine.validate(bet(), ctx({ session: null })), RuntimeErrorCode.INVALID_SESSION);
  });

  it('rejects an expired session', () => {
    expectReject(
      engine.validate(bet(), ctx({ session: session({ status: SessionStatus.Expired }) })),
      RuntimeErrorCode.SESSION_EXPIRED,
    );
  });

  it('checks the session before the bet shape (session guard wins)', () => {
    // Both invalid: no session AND no idempotency key — the session error surfaces.
    expectReject(
      engine.validate(bet({ idempotencyKey: '' }), ctx({ session: null })),
      RuntimeErrorCode.INVALID_SESSION,
    );
  });
});

describe('bet-engine — bet shape', () => {
  it('rejects a missing idempotency key', () => {
    expectReject(engine.validate(bet({ idempotencyKey: '' }), ctx()), RuntimeErrorCode.INVALID_BET);
  });

  it('rejects an empty selections array', () => {
    expectReject(engine.validate(bet({ selections: [] }), ctx()), RuntimeErrorCode.INVALID_BET);
  });

  it('rejects a non-array selections value', () => {
    expectReject(
      engine.validate(bet({ selections: undefined as unknown as IBetRequest['selections'] }), ctx()),
      RuntimeErrorCode.INVALID_BET,
    );
  });

  it('rejects a non-numeric stake', () => {
    expectReject(
      engine.validate(bet({ stake: { amount: 'abc', currency: 'INR' } }), ctx()),
      RuntimeErrorCode.INVALID_BET,
    );
  });

  it('rejects a zero or negative stake', () => {
    expectReject(engine.validate(bet({ stake: { amount: '0', currency: 'INR' } }), ctx()), RuntimeErrorCode.INVALID_BET);
    expectReject(engine.validate(bet({ stake: { amount: '-5', currency: 'INR' } }), ctx()), RuntimeErrorCode.INVALID_BET);
  });

  it('rejects a non-finite stake (Infinity)', () => {
    expectReject(
      engine.validate(bet({ stake: { amount: 'Infinity', currency: 'INR' } }), ctx()),
      RuntimeErrorCode.INVALID_BET,
    );
  });
});

describe('bet-engine — limits', () => {
  it('rejects a stake below the minimum', () => {
    expectReject(
      engine.validate(bet({ stake: { amount: '5', currency: 'INR' } }), ctx({ limits: { minBet: 10, maxBet: 1000 } })),
      RuntimeErrorCode.BELOW_MIN_BET,
    );
  });

  it('rejects a stake above the maximum', () => {
    expectReject(
      engine.validate(bet({ stake: { amount: '2000', currency: 'INR' } }), ctx({ limits: { minBet: 1, maxBet: 1000 } })),
      RuntimeErrorCode.ABOVE_MAX_BET,
    );
  });

  it('accepts a stake exactly at the min and at the max boundary', () => {
    const limits = { minBet: 10, maxBet: 100 };
    expect(engine.validate(bet({ stake: { amount: '10', currency: 'INR' } }), ctx({ limits })).ok).toBe(true);
    expect(engine.validate(bet({ stake: { amount: '100', currency: 'INR' } }), ctx({ limits, balance: 100 })).ok).toBe(true);
  });
});

describe('bet-engine — currency', () => {
  it('rejects a currency outside the allow-list', () => {
    expectReject(
      engine.validate(bet(), ctx({ limits: { minBet: 1, maxBet: 1000, allowedCurrencies: ['USD'] } })),
      RuntimeErrorCode.INVALID_CURRENCY,
    );
  });

  it('accepts a currency on the allow-list', () => {
    expect(
      engine.validate(bet(), ctx({ limits: { minBet: 1, maxBet: 1000, allowedCurrencies: ['INR', 'USD'] } })).ok,
    ).toBe(true);
  });

  it('accepts any currency when no allow-list is configured', () => {
    expect(engine.validate(bet({ stake: { amount: '10', currency: 'BTC' } }), ctx()).ok).toBe(true);
  });
});

describe('bet-engine — balance', () => {
  it('rejects a stake greater than the balance', () => {
    expectReject(
      engine.validate(bet({ stake: { amount: '500', currency: 'INR' } }), ctx({ balance: 100 })),
      RuntimeErrorCode.INSUFFICIENT_BALANCE,
    );
  });

  it('accepts a stake exactly equal to the balance', () => {
    expect(engine.validate(bet({ stake: { amount: '100', currency: 'INR' } }), ctx({ balance: 100 })).ok).toBe(true);
  });
});

describe('bet-engine — risk', () => {
  it('rejects an unknown risk level', () => {
    expectReject(
      engine.validate(bet({ risk: 'insane' as unknown as RiskLevel }), ctx()),
      RuntimeErrorCode.INVALID_RISK,
    );
  });

  it('allows an absent risk (optional field)', () => {
    expect(engine.validate(bet({ risk: undefined }), ctx()).ok).toBe(true);
  });
});

describe('bet-engine — contract invariants', () => {
  it('never throws, even on wildly malformed input', () => {
    expect(() =>
      engine.validate(
        { selections: null, stake: null } as unknown as IBetRequest,
        ctx({ session: null }),
      ),
    ).not.toThrow();
  });

  it('carries diagnostic details on a balance rejection', () => {
    // Within limits (max 10_000) but over balance — isolates the balance branch.
    const res = engine.validate(
      bet({ stake: { amount: '500', currency: 'INR' } }),
      ctx({ balance: 100, limits: { minBet: 1, maxBet: 10_000 } }),
    );
    if (res.ok) throw new Error('expected rejection');
    expect(res.error.code).toBe(RuntimeErrorCode.INSUFFICIENT_BALANCE);
    expect(res.error.details).toMatchObject({ balance: 100, stake: 500 });
  });
});
