import type { IBetRequest, IFairnessProof, IGameSession, IProvablyFairProvider } from '@gaming-platform/types';
import { BetMode, SessionStatus } from '@gaming-platform/types';
import { describe, expect, it } from 'vitest';

import { CRASH_CONFIG, CrashEngine, type CrashState } from './crash-engine';

/**
 * Crash engine (STEP 2 / STEP 7 reference).
 *
 * A PURE engine: given the round fairness it derives the bust multiplier and
 * nothing else — no wallet, no timers. Tests pin the preserved distribution
 * formula, the clamp bounds, determinism, and the result envelope.
 */

const session: IGameSession = {
  sessionId: 'sess_1',
  gameId: 'crash',
  playerId: 'demo-player',
  currency: 'INR',
  status: SessionStatus.Active,
  createdAt: new Date().toISOString(),
};

const bet: IBetRequest<number> = {
  gameId: 'crash',
  sessionId: 'sess_1',
  stake: { amount: '10', currency: 'INR' },
  mode: BetMode.Single,
  selections: [{ pick: 2 }],
  idempotencyKey: 'idem-1',
};

const fairness: IFairnessProof = { serverSeed: 'srv', serverSeedHash: 'h', clientSeed: 'cli', nonce: 1 };

/** RNG stub that returns a fixed float so the outcome is fully deterministic. */
const rngReturning = (r: number): IProvablyFairProvider => ({
  commit: () => ({ serverSeed: 'srv', serverSeedHash: 'h' }),
  nextFloat: () => r,
  verify: () => true,
});

const run = (r: number) =>
  new CrashEngine().createRound({ session, bet, config: CRASH_CONFIG, rng: rngReturning(r), fairness });

describe('crash-engine — distribution', () => {
  it('clamps to the minimum 1.0 for low random values', () => {
    expect((run(0).state as CrashState).crashPoint).toBe(1);
  });

  it('follows crashPoint = floor(edge / (1 - r) * 100) / 100 mid-range', () => {
    // edge = 0.99; r = 0.5 → 0.99 / 0.5 = 1.98
    expect((run(0.5).state as CrashState).crashPoint).toBeCloseTo(1.98, 2);
    // r = 0.99 → 0.99 / 0.01 = 99
    expect((run(0.99).state as CrashState).crashPoint).toBeCloseTo(99, 0);
  });

  it('clamps to the configured maxMultiplier for r near 1', () => {
    expect((run(0.999999).state as CrashState).crashPoint).toBe(CRASH_CONFIG.maxMultiplier);
  });

  it('never returns below 1 or above the cap across the whole range', () => {
    for (let i = 0; i < 1000; i += 1) {
      const cp = (run(i / 1000).state as CrashState).crashPoint;
      expect(cp).toBeGreaterThanOrEqual(1);
      expect(cp).toBeLessThanOrEqual(CRASH_CONFIG.maxMultiplier);
    }
  });
});

describe('crash-engine — determinism & envelope', () => {
  it('is deterministic for the same fairness', () => {
    expect((run(0.42).state as CrashState).crashPoint).toBe((run(0.42).state as CrashState).crashPoint);
  });

  it('returns the canonical result envelope (unsettled)', () => {
    const result = run(0.5);
    expect(result.gameId).toBe('crash');
    expect(result.roundId).toBe(''); // assigned by the runtime, not the engine
    expect(result.multiplier).toBe(0); // resolved at cash-out/bust by settlement
    expect(result.win).toBe(false);
    expect(result.fairness).toBe(fairness);
    expect(() => new Date(result.computedAt).toISOString()).not.toThrow();
  });

  it('exposes the preserved house-edge preset', () => {
    expect(CRASH_CONFIG.houseEdgePct).toBe(1);
    expect(CRASH_CONFIG.maxMultiplier).toBe(120);
  });

  it('tolerates a fairness proof with no revealed server seed', () => {
    const noSeed: IFairnessProof = { serverSeedHash: 'h', clientSeed: 'cli', nonce: 1 };
    const result = new CrashEngine().createRound({
      session,
      bet,
      config: CRASH_CONFIG,
      rng: rngReturning(0.5),
      fairness: noSeed,
    });
    expect((result.state as CrashState).crashPoint).toBeCloseTo(1.98, 2);
  });
});
