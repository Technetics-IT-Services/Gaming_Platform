import type { IFairnessProof, IProvablyFairProvider } from '@gaming-platform/types';
import { BetMode, RuntimeState } from '@gaming-platform/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { useDemoWallet } from '@/stores/demo-wallet';
import { GameRuntime, type GameRegistration, type PlayerContext } from '@/runtime/game-runtime';
import { createProviderSet } from '@/runtime/providers';
import { DemoProvablyFairProvider } from '@/runtime/providers/provably-fair';

import { HILO_ENGINE_KEY, HiLoEngine } from './engine';
import { counts, oddsFor, probability, stepMultiplier } from './math';
import { verifyRound } from './provably-fair';
import { HILO_DEFAULT, type HiLoConfig, type HiLoState } from './types';

/**
 * Hi-Lo (Sprint 2). Verifies card probabilities, the per-step multiplier RTP
 * invariant (P × mult = 1 − edge → 96–97%), multiplier progression, cash-out / bust
 * settlement, provably-fair verification, and end-to-end money flow through the FROZEN
 * interactive runtime + ledger. No runtime/wallet/ledger code is modified.
 */

const EDGE = HILO_DEFAULT.houseEdge;
const CONFIG: HiLoConfig = { ...HILO_DEFAULT, minBet: 1, maxBet: 1_000_000, rewards: { winXp: 30, lossXp: 10 } };

/** A scripted provably-fair provider returning a fixed float per nonce. */
function scripted(floatByNonce: Record<number, number>): IProvablyFairProvider {
  return { commit: () => ({ serverSeed: 'srv', serverSeedHash: 'h' }), nextFloat: (i) => floatByNonce[(i as { nonce: number }).nonce] ?? 0.5, verify: () => true };
}
const FAIR: IFairnessProof = { serverSeed: 'srv', serverSeedHash: 'h', clientSeed: 'c', nonce: 1 };
const bet = { gameId: 'hilo', sessionId: 's', stake: { amount: '100', currency: 'INR' }, mode: BetMode.Single, selections: [], idempotencyKey: 'k', clientSeed: 'c' };

describe('hi-lo mathematics', () => {
  it('counts + probabilities are correct and the RTP invariant holds per step', () => {
    // Fresh 52-card deck minus a rank-7 current card → 51 remaining.
    const remaining = Array.from({ length: 52 }, (_, i) => i).filter((id) => (id % 13) + 2 !== 7 || id > 5);
    const c = counts(7, remaining);
    expect(c.higher + c.lower + c.equal).toBe(remaining.length);
    // For every rank + a full-ish deck, P(dir) × stepMult ≈ (1 − edge).
    for (const rank of [2, 7, 10, 14]) {
      const rem = Array.from({ length: 52 }, (_, i) => i).filter((id) => id !== (rank - 2)); // remove one card of this rank
      for (const dir of ['higher', 'lower', 'equal'] as const) {
        const p = probability(dir, rank, rem);
        const m = stepMultiplier(dir, rank, rem, EDGE);
        if (p > 0) expect(p * m).toBeCloseTo(1 - EDGE, 2); // 96.5% expected value per step
      }
    }
  });

  it('offers odds only for legal predictions', () => {
    const remaining = Array.from({ length: 52 }, (_, i) => i).filter((id) => id !== 51); // remove the Ace of the last suit
    const odds = oddsFor(14, remaining, EDGE, true); // Ace high → nothing higher
    expect(odds.higher).toBe(0);
    expect(odds.lower).toBeGreaterThan(0);
  });
});

describe('hi-lo engine — progression, cashout, bust', () => {
  const engine = new HiLoEngine();

  it('grows the multiplier on a correct prediction and settles a cash-out', () => {
    // float[100]=0 → first card id 0 (rank 2). float[101]=0 → next id 1 (rank 3) > 2 → 'higher' correct.
    const rng = scripted({ 100: 0, 101: 0 });
    const start = engine.start({ session: { gameId: 'hilo' } as never, bet: bet as never, config: CONFIG, rng, fairness: FAIR });
    expect(start.state).toBe(RuntimeState.AwaitingPlayer);
    expect(start.gameState.current.rank).toBe(2);
    const s1 = engine.step({ session: { gameId: 'hilo' } as never, bet: bet as never, config: CONFIG, rng, fairness: FAIR, gameState: start.gameState, action: { type: 'higher' } });
    expect((s1.gameState as HiLoState).lastCorrect).toBe(true);
    expect(s1.gameState.multiplier).toBeGreaterThan(1);
    const cash = engine.step({ session: { gameId: 'hilo' } as never, bet: bet as never, config: CONFIG, rng, fairness: FAIR, gameState: s1.gameState, action: { type: 'cashout' } });
    expect(cash.state).toBe(RuntimeState.Completed);
    expect(cash.settlement!.type).toBe('win');
    expect(Number(cash.settlement!.payout)).toBe(Math.round(100 * s1.gameState.multiplier));
  });

  it('busts on a wrong prediction (loss settlement, zero payout)', () => {
    // current rank 2 (id0), predict 'equal', next id1 (rank 3) ≠ 2 → wrong → bust.
    const rng = scripted({ 100: 0, 101: 0 });
    const start = engine.start({ session: { gameId: 'hilo' } as never, bet: bet as never, config: CONFIG, rng, fairness: FAIR });
    const busted = engine.step({ session: { gameId: 'hilo' } as never, bet: bet as never, config: CONFIG, rng, fairness: FAIR, gameState: start.gameState, action: { type: 'equal' } });
    expect(busted.state).toBe(RuntimeState.Completed);
    expect(busted.settlement!.type).toBe('loss');
    expect(busted.settlement!.payout).toBe('0');
  });

  it('rejects cashing out before any prediction', () => {
    const rng = scripted({ 100: 0 });
    const start = engine.start({ session: { gameId: 'hilo' } as never, bet: bet as never, config: CONFIG, rng, fairness: FAIR });
    expect(() => engine.step({ session: { gameId: 'hilo' } as never, bet: bet as never, config: CONFIG, rng, fairness: FAIR, gameState: start.gameState, action: { type: 'cashout' } })).toThrow(/prediction/i);
  });
});

describe('hi-lo provably fair', () => {
  it('reproduces the drawn cards from the revealed seeds', () => {
    const rng = new DemoProvablyFairProvider();
    const engine = new HiLoEngine();
    const fairness: IFairnessProof = { serverSeed: 'S', serverSeedHash: '', clientSeed: 'C', nonce: 4 };
    const start = engine.start({ session: { gameId: 'hilo' } as never, bet: bet as never, config: CONFIG, rng, fairness });
    const s1 = engine.step({ session: { gameId: 'hilo' } as never, bet: bet as never, config: CONFIG, rng, fairness, gameState: start.gameState, action: { type: 'higher' } });
    const cards = (s1.gameState as HiLoState).revealed;
    const v = verifyRound(rng, { serverSeed: 'S', clientSeed: 'C', nonce: 4, cards, predictions: ['higher'], cashed: false });
    expect(v.valid).toBe(true);
  });
});

/* --------------------- runtime + ledger integration ----------------------- */

const PLAYER: PlayerContext = { playerId: 'demo-player', currency: 'INR' };
const CAPS: GameRegistration['capabilities'] = { cashOut: true, autoBet: true, multiBet: false, provablyFair: true, realtime: false, multiplayer: false, liveDealer: false, tournament: false };

function runtimeWith(rng: IProvablyFairProvider): GameRuntime {
  const rt = new GameRuntime({ ...createProviderSet(), provablyFair: rng }, PLAYER);
  rt.registerEngine(new HiLoEngine());
  rt.registerGame({ gameId: 'hilo', name: 'Hi-Lo', engineKey: HILO_ENGINE_KEY, category: 'instant', capabilities: CAPS, config: CONFIG as never });
  return rt;
}

beforeEach(() => {
  useDemoWallet.getState().reset();
  useDemoWallet.getState().deposit(10_000);
});

describe('hi-lo runs through the frozen interactive runtime + ledger', () => {
  it('debits the stake, then credits the cash-out payout', async () => {
    const rt = runtimeWith(scripted({ 100: 0, 101: 0 })); // rank 2 → 'higher' correct
    const { roundId, step } = await rt.startInteractive<HiLoState>({ gameId: 'hilo', sessionId: (await rt.createSession({ gameId: 'hilo' })).sessionId, stake: { amount: '100', currency: 'INR' }, mode: BetMode.Single, selections: [{ pick: {} }], idempotencyKey: 'hilo-1', clientSeed: 'demo' });
    expect(step.state).toBe(RuntimeState.AwaitingPlayer);
    expect(useDemoWallet.getState().balance).toBe(9_900); // stake debited up front
    const s1 = await rt.submitAction<HiLoState>({ roundId, action: { type: 'higher' } });
    const cash = await rt.submitAction<HiLoState>({ roundId, action: { type: 'cashout' } });
    expect(cash.state).toBe(RuntimeState.Completed);
    const payout = Math.round(100 * s1.gameState.multiplier);
    expect(useDemoWallet.getState().balance).toBe(9_900 + payout); // exact stake→payout accounting
    expect(payout).toBeGreaterThan(100); // a winning cash-out
  });

  it('financial invariant — a bust keeps the stake, credits nothing', async () => {
    const rt = runtimeWith(scripted({ 100: 0, 101: 0 })); // rank 2, predict 'equal' → bust
    const { roundId } = await rt.startInteractive<HiLoState>({ gameId: 'hilo', sessionId: (await rt.createSession({ gameId: 'hilo' })).sessionId, stake: { amount: '100', currency: 'INR' }, mode: BetMode.Single, selections: [{ pick: {} }], idempotencyKey: 'hilo-2', clientSeed: 'demo' });
    const busted = await rt.submitAction<HiLoState>({ roundId, action: { type: 'equal' } });
    expect(busted.state).toBe(RuntimeState.Completed);
    expect(useDemoWallet.getState().balance).toBe(9_900); // stake lost, no credit
  });
});
