import type { IBetRequest, IFairnessProof, IGameSession, IProvablyFairProvider } from '@gaming-platform/types';
import { BetMode, SessionStatus } from '@gaming-platform/types';
import { describe, expect, it } from 'vitest';

import { DICE_CONFIG, DiceEngine, type DicePick, diceMultiplier } from './dice-engine';
import { PLINKO_CONFIG, PLINKO_MULT, PlinkoEngine } from './plinko-engine';
import { OUTSIDE, RouletteEngine, type RoulettePick, colorOf } from './roulette-engine';

/**
 * Migrated game engines (Phase 2.3B, STEP 9 regression).
 *
 * These pin the extracted outcome + payout math so a future refactor can't silently
 * change gameplay. Each engine is PURE — a stub RNG makes the outcome deterministic.
 */

const session: IGameSession = {
  sessionId: 'sess_1',
  gameId: 'x',
  playerId: 'demo-player',
  currency: 'INR',
  status: SessionStatus.Active,
  createdAt: '2020-01-01T00:00:00.000Z',
};
const fairness: IFairnessProof = { serverSeed: 'srv', serverSeedHash: 'h', clientSeed: 'cli', nonce: 1 };
const rngReturning = (r: number): IProvablyFairProvider => ({
  commit: () => ({ serverSeed: 'srv', serverSeedHash: 'h' }),
  nextFloat: () => r,
  verify: () => true,
});
const bet = <T>(pick: T): IBetRequest<T> => ({
  gameId: session.gameId,
  sessionId: session.sessionId,
  stake: { amount: '100', currency: 'INR' },
  mode: BetMode.Single,
  selections: [{ pick }],
  idempotencyKey: 'idem-1',
});

describe('dice-engine', () => {
  const engine = new DiceEngine();
  const run = (r: number, pick: DicePick) =>
    engine.createRound({ session, bet: bet(pick), config: DICE_CONFIG, rng: rngReturning(r), fairness });

  it('derives the roll as floor(r * 10000) / 100', () => {
    expect(run(0.6, { target: 50, dir: 'over' }).state.roll).toBe(60);
    expect(run(0.12345, { target: 50, dir: 'over' }).state.roll).toBe(12.34);
  });

  it('wins rolling over and pays 0.99 * 100 / chance', () => {
    const res = run(0.6, { target: 50, dir: 'over' }); // roll 60 > 50
    expect(res.win).toBe(true);
    expect(res.multiplier).toBeCloseTo(diceMultiplier(50, 'over'), 10);
    expect(res.multiplier).toBeCloseTo(1.98, 5);
  });

  it('loses rolling over below the target (multiplier 0)', () => {
    const res = run(0.3, { target: 50, dir: 'over' }); // roll 30, not > 50
    expect(res.win).toBe(false);
    expect(res.multiplier).toBe(0);
  });

  it('wins rolling under, and exposes the roll as the history label/value', () => {
    const res = run(0.3, { target: 50, dir: 'under' }); // roll 30 < 50
    expect(res.win).toBe(true);
    expect(res.display).toEqual({ label: '30.00', value: 30 });
  });

  it('is deterministic for the same fairness', () => {
    expect(run(0.42, { target: 50, dir: 'over' }).state.roll).toBe(run(0.42, { target: 50, dir: 'over' }).state.roll);
  });
});

describe('roulette-engine', () => {
  const engine = new RouletteEngine();
  const run = (r: number, pick: RoulettePick) =>
    engine.createRound({ session, bet: bet(pick), config: undefined, rng: rngReturning(r), fairness });

  it('derives the pocket as floor(r * 37)', () => {
    expect(run(17.5 / 37, { kind: 'straight', n: 17 }).state.number).toBe(17);
    expect(run(0, { kind: 'straight', n: 0 }).state.number).toBe(0);
  });

  it('pays a straight hit 36× and labels the pocket', () => {
    const res = run(17.5 / 37, { kind: 'straight', n: 17 });
    expect(res.win).toBe(true);
    expect(res.multiplier).toBe(36);
    expect(res.display?.label).toBe('17 Black');
    expect(res.display?.value).toBe(17);
  });

  it('loses a wrong straight number', () => {
    const res = run(17.5 / 37, { kind: 'straight', n: 5 });
    expect(res.win).toBe(false);
    expect(res.multiplier).toBe(0);
  });

  it('pays an outside colour bet 2× when it hits', () => {
    // pocket 1 is red.
    expect(colorOf(1)).toBe('red');
    const res = run(1.5 / 37, { kind: 'outside', key: 'red' });
    expect(res.win).toBe(true);
    expect(res.multiplier).toBe(2);
  });

  it('every outside predicate is consistent with the pocket colour/parity', () => {
    for (const o of OUTSIDE) {
      const res = run(1.5 / 37, { kind: 'outside', key: o.key }); // pocket 1
      expect(res.win).toBe(o.hit(1));
    }
  });
});

describe('plinko-engine', () => {
  const engine = new PlinkoEngine();
  const run = (r: number) =>
    engine.createRound({ session, bet: bet(null), config: PLINKO_CONFIG, rng: rngReturning(r), fairness });

  it('walks 12 rows and lands in a valid bin', () => {
    const res = run(0.5);
    expect(res.state.dirs).toHaveLength(12);
    expect(res.state.dirs.every((d) => d === 1 || d === -1)).toBe(true);
    expect(res.state.bin).toBeGreaterThanOrEqual(0);
    expect(res.state.bin).toBeLessThanOrEqual(12);
  });

  it('reads the multiplier from the bin table and labels it', () => {
    const res = run(0.5);
    expect(res.state.mult).toBe(PLINKO_MULT[res.state.bin]);
    expect(res.multiplier).toBe(res.state.mult >= 1 ? res.state.mult : 0);
    expect(res.win).toBe(res.state.mult >= 1);
    expect(res.display).toEqual({ label: `${res.state.mult}×`, value: res.state.mult });
  });

  it('treats sub-1.0 bins as losing the stake (no payout)', () => {
    // Find a seed that lands in a <1 bin, then assert win=false.
    let sawSubOne = false;
    for (let i = 0; i < 200 && !sawSubOne; i += 1) {
      const res = run(i / 200);
      if (res.state.mult < 1) {
        sawSubOne = true;
        expect(res.win).toBe(false);
        expect(res.multiplier).toBe(0);
      }
    }
    expect(sawSubOne).toBe(true);
  });

  it('is deterministic for the same fairness float', () => {
    expect(run(0.777).state.bin).toBe(run(0.777).state.bin);
  });
});
