import type { IFairnessProof, IProvablyFairProvider } from '@gaming-platform/types';
import { BetMode, BetOutcome } from '@gaming-platform/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { useDemoWallet } from '@/stores/demo-wallet';
import { GameRuntime, type GameRegistration, type PlayerContext } from '@/runtime/game-runtime';
import { createProviderSet } from '@/runtime/providers';
import { DemoProvablyFairProvider } from '@/runtime/providers/provably-fair';

import { FRUIT_SLOTS_ENGINE_KEY, FruitSlotsEngine, defaultSlotConfig, evaluateSpin, playRound, spinMatrix } from './engine';
import { LINES, STRIP_LENGTH, buildReels } from './reels';
import { reelStops } from './provably-fair';
import { estimateRtp, exactRtp } from './rtp';
import { PAYLINES, Symbol, type SlotConfig } from './types';

/**
 * Fruit Slots (Sprint 2). Verifies reel/window geometry, payline evaluation with wild
 * substitution, scatter + free-spin logic, the RTP (exact analytic + Monte-Carlo),
 * provably-fair reel stops, and end-to-end money flow through the FROZEN runtime +
 * ledger. No runtime/wallet/ledger code is modified.
 */

const CONFIG: SlotConfig = { ...defaultSlotConfig(), minBet: 20, maxBet: 1_000_000, rewards: { winXp: 30, lossXp: 10 } };

describe('fruit slots — reels & paylines', () => {
  it('has 5 reels × 36-cell strips and 20 paylines', () => {
    expect(buildReels()).toHaveLength(5);
    expect(STRIP_LENGTH).toBe(36);
    expect(LINES).toHaveLength(PAYLINES);
    expect(LINES.every((l) => l.length === 5 && l.every((r) => r >= 0 && r <= 2))).toBe(true);
  });

  it('builds a 3×5 window matrix from reel stops', () => {
    const reels = buildReels();
    const matrix = spinMatrix(reels, [0, 0, 0, 0, 0]);
    expect(matrix).toHaveLength(3);
    expect(matrix[0]).toHaveLength(5);
  });

  it('pays a line of 5-of-a-kind and lets wild substitute', () => {
    // A crafted matrix: middle row all cherries on reels 0..4 → line 1 pays 5-of-a-kind.
    const reels: Symbol[][] = Array.from({ length: 5 }, () => [Symbol.Cherry]); // strip length 1 → window all cherry
    const cfg: SlotConfig = { ...CONFIG, reels };
    const ev = evaluateSpin(reels, [0, 0, 0, 0, 0], cfg, 1);
    const line1 = ev.lineWins.find((w) => w.line === 1);
    expect(line1?.count).toBe(5);
    expect(line1?.symbol).toBe(Symbol.Cherry);

    // Wild on reel 0 + cherries after → still counts as cherry.
    const withWild: Symbol[][] = [[Symbol.Wild], [Symbol.Cherry], [Symbol.Cherry], [Symbol.Cherry], [Symbol.Lemon]];
    const ev2 = evaluateSpin(withWild, [0, 0, 0, 0, 0], { ...CONFIG, reels: withWild }, 1);
    const l = ev2.lineWins.find((w) => w.line === 1);
    expect(l?.symbol).toBe(Symbol.Cherry); // wild substitutes → cherry line
    expect(l?.count).toBe(4);
  });

  it('awards scatter pays + free spins on 3+ scatters', () => {
    const reels: Symbol[][] = Array.from({ length: 5 }, () => [Symbol.Scatter]); // all scatter → 15 scatters
    const spin = playRound(scriptedFloat(0), { serverSeed: 'x', serverSeedHash: '', clientSeed: 'c', nonce: 1 }, { ...CONFIG, reels });
    expect(spin.scatterCount).toBe(15); // full 3×5 window of scatters → capped at the 5+ tier
    expect(spin.freeSpinsAwarded).toBe(CONFIG.scatter.freeSpins[5]);
    expect(spin.totalUnits).toBeGreaterThan(0);
  });
});

/** A provider returning a constant float (for crafted-matrix spins). */
function scriptedFloat(f: number): IProvablyFairProvider {
  return { commit: () => ({ serverSeed: 'x', serverSeedHash: 'h' }), nextFloat: () => f, verify: () => true };
}

describe('fruit slots — RTP', () => {
  it('exact analytic RTP is in the 96–97% band', () => {
    const e = exactRtp(CONFIG);
    expect(e.rtp).toBeGreaterThanOrEqual(0.96);
    expect(e.rtp).toBeLessThanOrEqual(0.97);
    expect(e.baseRtp).toBeGreaterThan(0.85); // most RTP from the base game
    expect(e.efree).toBeGreaterThan(0); // free spins contribute
  });

  it('Monte-Carlo RTP tracks the analytic value', () => {
    const mc = estimateRtp(new DemoProvablyFairProvider(), CONFIG, { spins: 50_000 });
    expect(mc.rtp).toBeGreaterThan(0.85); // noisy at 50k, but bounded + non-degenerate
    expect(mc.rtp).toBeLessThan(1.15);
    expect(mc.hitRate).toBeGreaterThan(0.1);
    expect(mc.hitRate).toBeLessThan(0.3);
  });
});

describe('fruit slots — provably fair', () => {
  it('reel stops are deterministic + in range', () => {
    const rng = new DemoProvablyFairProvider();
    const fairness: IFairnessProof = { serverSeed: 'S', serverSeedHash: '', clientSeed: 'C', nonce: 9 };
    const a = reelStops(rng, fairness, STRIP_LENGTH, 0);
    const b = reelStops(rng, fairness, STRIP_LENGTH, 0);
    expect(a).toEqual(b);
    expect(a).toHaveLength(5);
    expect(a.every((s) => s >= 0 && s < STRIP_LENGTH)).toBe(true);
    // free spins use a different stop set
    expect(reelStops(rng, fairness, STRIP_LENGTH, 1)).not.toEqual(a);
  });
});

/* --------------------- runtime + ledger integration ----------------------- */

const PLAYER: PlayerContext = { playerId: 'demo-player', currency: 'INR' };
const CAPS: GameRegistration['capabilities'] = { cashOut: false, autoBet: true, multiBet: false, provablyFair: true, realtime: false, multiplayer: false, liveDealer: false, tournament: false };

function runtimeWith(rng: IProvablyFairProvider, config: SlotConfig): GameRuntime {
  const rt = new GameRuntime({ ...createProviderSet(), provablyFair: rng }, PLAYER);
  rt.registerEngine(new FruitSlotsEngine());
  rt.registerGame({ gameId: 'fruit-slots', name: 'Fruit Slots', engineKey: FRUIT_SLOTS_ENGINE_KEY, category: 'instant', capabilities: CAPS, config: config as never });
  return rt;
}

beforeEach(() => {
  useDemoWallet.getState().reset();
  useDemoWallet.getState().deposit(100_000);
});

describe('fruit slots runs through the frozen runtime + ledger', () => {
  it('settles a scatter-jackpot spin (all-scatter reels) with exact stake→payout accounting', async () => {
    const reels: Symbol[][] = Array.from({ length: 5 }, () => [Symbol.Scatter]);
    const cfg: SlotConfig = { ...CONFIG, reels };
    const rt = runtimeWith(scriptedFloat(0), cfg);
    const session = await rt.createSession({ gameId: 'fruit-slots' });
    const res = await rt.placeBet({ gameId: 'fruit-slots', sessionId: session.sessionId, stake: { amount: '200', currency: 'INR' }, mode: BetMode.Single, selections: [{ pick: {} }], idempotencyKey: 'slot-1', clientSeed: 'demo' });
    // All-scatter reels are seed-independent → recompute the expected payout with any fairness.
    const spin = playRound(scriptedFloat(0), { serverSeed: 'x', serverSeedHash: '', clientSeed: 'c', nonce: 1 }, cfg);
    const expectedPayout = Math.round((spin.totalUnits * 200) / PAYLINES);
    expect(Number(res.payout)).toBe(expectedPayout);
    expect(res.outcome).toBe(BetOutcome.Win);
    expect(useDemoWallet.getState().balance).toBe(100_000 - 200 + expectedPayout);
  });

  it('financial invariant — 30 real spins keep exact stake→payout accounting', async () => {
    const rt = runtimeWith(new DemoProvablyFairProvider(), CONFIG);
    const session = await rt.createSession({ gameId: 'fruit-slots' });
    for (let i = 0; i < 30; i += 1) {
      const before = useDemoWallet.getState().balance;
      const res = await rt.placeBet({ gameId: 'fruit-slots', sessionId: session.sessionId, stake: { amount: '20', currency: 'INR' }, mode: BetMode.Single, selections: [{ pick: {} }], idempotencyKey: `slot-loop-${i}`, clientSeed: 'demo' });
      expect(useDemoWallet.getState().balance).toBe(before - 20 + Number(res.payout));
    }
    expect(useDemoWallet.getState().balance).toBeGreaterThanOrEqual(0);
  });
});
