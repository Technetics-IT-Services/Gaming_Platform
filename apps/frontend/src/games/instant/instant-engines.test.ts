import type { IBetRequest, IFairnessProof, IGameSession, IProvablyFairProvider } from '@gaming-platform/types';
import { BetMode, RuntimeState, SessionStatus, SettlementType } from '@gaming-platform/types';
import { describe, expect, it } from 'vitest';

import { BingoEngine, BINGO_CONFIG, bingoLines } from './bingo-engine';
import { COIN_FLIP_CONFIG, CoinFlipEngine } from './coin-flip-engine';
import { GridRevealEngine, type GridRevealState, gridMultiplier } from './grid-reveal-engine';
import { KENO_CONFIG, KenoEngine } from './keno-engine';
import { LIMBO_CONFIG, LimboEngine, limboMultiplier } from './limbo-engine';
import { LUCKY_PICK_CONFIG, LuckyPickEngine, luckyMultiplier } from './lucky-pick-engine';
import { shuffleFair } from './rng';
import { TOWER_CONFIG, TowerEngine, type TowerState, towerMultiplier } from './tower-engine';
import { WHEEL_SEGMENTS, WheelEngine } from './wheel-engine';

/**
 * Phase 4 instant-game engines. Each is PURE + provably fair; a stub RNG makes the
 * outcome deterministic. Tests pin probability/EV, the payout tables, edge cases,
 * and the interactive flow.
 */

const session: IGameSession = {
  sessionId: 's',
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
/** RNG driven by an index-derived float — for EV sampling over many rounds. */
const seqRng = (values: number[]): IProvablyFairProvider => {
  let i = 0;
  return { commit: () => ({ serverSeed: 's', serverSeedHash: 'h' }), nextFloat: () => values[i++ % values.length]!, verify: () => true };
};
const bet = <T>(pick: T, amount = '100'): IBetRequest<T> => ({
  gameId: 'x',
  sessionId: 's',
  stake: { amount, currency: 'INR' },
  mode: BetMode.Single,
  selections: [{ pick }],
  idempotencyKey: 'k',
});

describe('limbo-engine', () => {
  const engine = new LimboEngine();
  it('wins iff generated ≥ target and pays the target', () => {
    const res = engine.createRound({ session, bet: bet({ target: 2 }), config: LIMBO_CONFIG, rng: rngReturning(0.6), fairness });
    expect(res.state.generated).toBe(limboMultiplier(0.6));
    expect(res.win).toBe(res.state.generated >= 2);
    expect(res.multiplier).toBe(res.win ? 2 : 0);
  });

  it('holds a ~1% house edge across the range (EV ≈ 0.99)', () => {
    const N = 20_000;
    const floats = Array.from({ length: N }, (_, i) => (i + 0.5) / N);
    let ev = 0;
    for (const r of floats) {
      const res = engine.createRound({ session, bet: bet({ target: 3 }), config: LIMBO_CONFIG, rng: rngReturning(r), fairness });
      ev += res.win ? 3 : 0;
    }
    expect(ev / N).toBeGreaterThan(0.95);
    expect(ev / N).toBeLessThan(1.0);
  });
});

describe('coin-flip-engine', () => {
  const engine = new CoinFlipEngine();
  it('flips heads for r < 0.5 and pays 1.98× on a correct call', () => {
    expect(engine.createRound({ session, bet: bet<'heads' | 'tails'>('heads'), config: COIN_FLIP_CONFIG, rng: rngReturning(0.3), fairness }).win).toBe(true);
    const t = engine.createRound({ session, bet: bet<'heads' | 'tails'>('heads'), config: COIN_FLIP_CONFIG, rng: rngReturning(0.7), fairness });
    expect(t.state.outcome).toBe('tails');
    expect(t.win).toBe(false);
    expect(engine.createRound({ session, bet: bet<'heads' | 'tails'>('tails'), config: COIN_FLIP_CONFIG, rng: rngReturning(0.7), fairness }).multiplier).toBe(1.98);
  });
});

describe('wheel-engine', () => {
  it('every risk set has a ~4% house edge (mean ≈ 0.96)', () => {
    for (const risk of ['low', 'medium', 'high'] as const) {
      const mean = WHEEL_SEGMENTS[risk].reduce((a, b) => a + b, 0) / WHEEL_SEGMENTS[risk].length;
      expect(mean).toBeGreaterThan(0.94);
      expect(mean).toBeLessThan(0.98);
    }
  });
  it('lands on a valid segment and pays its multiplier', () => {
    const engine = new WheelEngine();
    const res = engine.createRound({ session, bet: bet<'low' | 'medium' | 'high'>('low'), config: undefined, rng: rngReturning(0), fairness });
    expect(res.state.index).toBe(0);
    expect(res.state.multiplier).toBe(WHEEL_SEGMENTS.low[0]);
  });
});

describe('grid-reveal-engine (Mines / Bomb Hunt)', () => {
  const engine = new GridRevealEngine();
  const config = { tiles: 25, mines: 3 };
  const rng = rngReturning(0.5);
  const board = new Set(shuffleFair(config.tiles, rng, fairness).slice(0, config.mines));
  const safe = Array.from({ length: 25 }, (_, i) => i).find((i) => !board.has(i))!;
  const mine = [...board][0]!;
  const step = (gameState: GridRevealState, action: { type: string; payload?: unknown }) =>
    engine.step({ session, bet: bet({ mines: 3 }), config, rng, fairness, gameState, action });

  it('multiplier grows with each safe reveal (1% edge)', () => {
    expect(gridMultiplier(25, 3, 1)).toBeCloseTo(0.99 * (25 / 22), 2);
    expect(gridMultiplier(25, 3, 2)).toBeGreaterThan(gridMultiplier(25, 3, 1));
  });

  it('starts awaiting the player and grows on a safe reveal', () => {
    const start = engine.start({ session, bet: bet({ mines: 3 }), config, rng, fairness });
    expect(start.state).toBe(RuntimeState.AwaitingPlayer);
    const safeStep = step(start.gameState, { type: 'reveal', payload: { index: safe } });
    expect(safeStep.state).toBe(RuntimeState.AwaitingPlayer);
    expect(safeStep.gameState.multiplier).toBeCloseTo(gridMultiplier(25, 3, 1), 2);
  });

  it('reveals a mine → loss; cashout after a safe reveal → win', () => {
    const start = engine.start({ session, bet: bet({ mines: 3 }), config, rng, fairness });
    const boom = step(start.gameState, { type: 'reveal', payload: { index: mine } });
    expect(boom.state).toBe(RuntimeState.Completed);
    expect(boom.settlement?.type).toBe(SettlementType.Loss);
    expect(boom.gameState.board).toContain(mine);

    const safeStep = step(start.gameState, { type: 'reveal', payload: { index: safe } });
    const cashed = step(safeStep.gameState, { type: 'cashout' });
    expect(cashed.state).toBe(RuntimeState.Completed);
    expect(cashed.settlement?.type).toBe(SettlementType.Win);
    expect(Number(cashed.settlement?.payout)).toBe(Math.round(100 * safeStep.gameState.multiplier));
  });

  it('rejects cashing out before any reveal and illegal actions', () => {
    const start = engine.start({ session, bet: bet({ mines: 3 }), config, rng, fairness });
    expect(() => step(start.gameState, { type: 'cashout' })).toThrow();
    expect(() => step(start.gameState, { type: 'teleport' })).toThrow();
  });
});

describe('tower-engine (interactive)', () => {
  const engine = new TowerEngine();
  const rng = rngReturning(0.5);
  const step = (gameState: TowerState, action: { type: string; payload?: unknown }) =>
    engine.step({ session, bet: bet(null), config: TOWER_CONFIG, rng, fairness, gameState, action });

  it('climbs on a safe pick and loses on a trap', () => {
    const start = engine.start({ session, bet: bet(null), config: TOWER_CONFIG, rng, fairness });
    expect(start.state).toBe(RuntimeState.AwaitingPlayer);
    // Trap for row 0 is deterministic; pick a non-trap and a trap tile.
    const trap0 = Math.floor(rng.nextFloat({ serverSeed: 'srv', clientSeed: `${fairness.clientSeed}#${1000}`, nonce: 1 }) * TOWER_CONFIG.tilesPerRow);
    const safeTile = (trap0 + 1) % TOWER_CONFIG.tilesPerRow;
    const climbed = step(start.gameState, { type: 'pick', payload: { tile: safeTile } });
    expect(climbed.gameState.level).toBe(1);
    expect(climbed.gameState.multiplier).toBeCloseTo(towerMultiplier(TOWER_CONFIG, 1), 2);
    const trapped = step(start.gameState, { type: 'pick', payload: { tile: trap0 } });
    expect(trapped.settlement?.type).toBe(SettlementType.Loss);
  });
});

describe('keno-engine', () => {
  const engine = new KenoEngine();
  it('counts matches and pays from the pick×match paytable', () => {
    const res = engine.createRound({ session, bet: bet<number[]>([1, 2, 3, 4, 5]), config: KENO_CONFIG, rng: rngReturning(0), fairness });
    expect(res.state.drawn).toHaveLength(KENO_CONFIG.draws);
    expect(res.state.matches).toBe(res.state.selected.filter((n) => res.state.drawn.includes(n)).length);
    expect(res.state.multiplier).toBe(KENO_CONFIG.paytable[5]![res.state.matches] ?? 0);
    expect(engine.createRound({ session, bet: bet<number[]>([1, 2, 3, 4, 5]), config: KENO_CONFIG, rng: rngReturning(0), fairness }).state.drawn).toEqual(res.state.drawn);
  });
});

describe('bingo-engine', () => {
  it('exposes 12 winning lines and pays by lines completed', () => {
    expect(bingoLines(5)).toHaveLength(12);
    const res = new BingoEngine().createRound({ session, bet: bet(null), config: BINGO_CONFIG, rng: rngReturning(0.5), fairness });
    expect(res.state.marked).toHaveLength(BINGO_CONFIG.draws);
    expect(res.state.multiplier).toBe(BINGO_CONFIG.paytable[res.state.lines] ?? 0);
  });
});

describe('lucky-pick-engine', () => {
  it('maps floats to tiers and keeps a ~4% edge', () => {
    expect(luckyMultiplier(0.1, LUCKY_PICK_CONFIG.tiers)).toBe(0);
    expect(luckyMultiplier(0.99, LUCKY_PICK_CONFIG.tiers)).toBe(10);
    const mean = LUCKY_PICK_CONFIG.tiers.reduce((a, t) => a + t.mult * t.weight, 0);
    expect(mean).toBeGreaterThan(0.94);
    expect(mean).toBeLessThan(0.98);
  });
  it('reveals every box and pays the picked box', () => {
    const res = new LuckyPickEngine().createRound({ session, bet: bet(2), config: LUCKY_PICK_CONFIG, rng: seqRng([0.05, 0.7, 0.95, 0.5, 0.99]), fairness });
    expect(res.state.boxes).toHaveLength(5);
    expect(res.multiplier).toBe(res.win ? res.state.boxes[2] : 0);
  });
});
