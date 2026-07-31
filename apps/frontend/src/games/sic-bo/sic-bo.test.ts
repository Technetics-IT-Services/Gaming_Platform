import type { IFairnessProof, IProvablyFairProvider } from '@gaming-platform/types';
import { BetMode, BetOutcome } from '@gaming-platform/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { useDemoWallet } from '@/stores/demo-wallet';
import { GameRuntime, type GameRegistration, type PlayerContext } from '@/runtime/game-runtime';
import { createProviderSet } from '@/runtime/providers';
import { DemoProvablyFairProvider } from '@/runtime/providers/provably-fair';

import { SIC_BO_ENGINE_KEY, SicBoEngine } from './engine';
import { betReturn, oddsFor } from './paytable';
import { ALL_OUTCOMES, isTriple, probability, resolveBet, total, winCount } from './probability';
import { dieNonce, rollDice, verifyRoll } from './provably-fair';
import { allBets, betRtp, rtpRange } from './rtp';
import { BetType, type Dice, type PlacedBet } from './types';

/**
 * Sic Bo (Sprint 3). Verifies the exact probability model, bet resolution, derived
 * payouts, the 96–98% RTP band for the full table, provably-fair dice + replay, and
 * end-to-end money flow through the FROZEN runtime + ledger. No runtime/wallet/ledger
 * code is modified.
 */

describe('sic-bo probability model', () => {
  it('enumerates 216 outcomes with correct headline counts', () => {
    expect(ALL_OUTCOMES).toHaveLength(216);
    expect(winCount({ type: BetType.Small })).toBe(105); // 4–10 minus triples
    expect(winCount({ type: BetType.Big })).toBe(105);
    expect(winCount({ type: BetType.Odd })).toBe(105);
    expect(winCount({ type: BetType.Even })).toBe(105);
    expect(winCount({ type: BetType.AnyTriple })).toBe(6);
    expect(winCount({ type: BetType.Triple, value: 6 })).toBe(1); // one specific triple
    expect(winCount({ type: BetType.Total, value: 4 })).toBe(3); // 1-1-2 in three orders
    expect(winCount({ type: BetType.Total, value: 10 })).toBe(27); // the modal total
    expect(probability({ type: BetType.Total, value: 4 })).toBeCloseTo(3 / 216, 10);
  });

  it('resolves each bet strictly from the dice', () => {
    const triple6: Dice = [6, 6, 6];
    expect(resolveBet({ type: BetType.Big }, triple6).won).toBe(false); // triples lose big/small
    expect(resolveBet({ type: BetType.AnyTriple }, triple6).won).toBe(true);
    expect(resolveBet({ type: BetType.Triple, value: 6 }, triple6).won).toBe(true);
    expect(resolveBet({ type: BetType.Single, value: 6 }, triple6).tier).toBe(3); // three 6s
    const mixed: Dice = [1, 2, 3];
    expect(resolveBet({ type: BetType.Combo2, value: [1, 2] }, mixed).won).toBe(true);
    expect(resolveBet({ type: BetType.Combo3, value: [1, 2, 3] }, mixed).won).toBe(true);
    expect(resolveBet({ type: BetType.Total, value: 6 }, mixed).won).toBe(true);
    expect(resolveBet({ type: BetType.Small }, mixed).won).toBe(true); // total 6, no triple
  });
});

describe('sic-bo payouts & RTP', () => {
  it('every bet in the table has RTP in the 96–98% band', () => {
    const bets = allBets();
    expect(bets.length).toBeGreaterThanOrEqual(70);
    for (const bet of bets) {
      const rtp = betRtp(bet);
      expect(rtp).toBeGreaterThanOrEqual(0.96);
      expect(rtp).toBeLessThanOrEqual(0.98);
    }
    const range = rtpRange();
    expect(range.min).toBeGreaterThanOrEqual(0.96);
    expect(range.max).toBeLessThanOrEqual(0.98);
  });

  it('derives payouts from probability (higher for rarer bets) and pays tiered Single', () => {
    // Rarer bet ⇒ bigger odds.
    const tripleOdds = oddsFor({ type: BetType.Triple, value: 3 }) as number;
    const bigOdds = oddsFor({ type: BetType.Big }) as number;
    expect(tripleOdds).toBeGreaterThan(bigOdds);
    expect(bigOdds).toBeCloseTo(1, 1); // even-money bets ≈ 1:1
    // Single pays more for more appearances.
    const [m1, m2, m3] = oddsFor({ type: BetType.Single, value: 4 }) as [number, number, number];
    expect(m3).toBeGreaterThan(m2);
    expect(m2).toBeGreaterThan(m1);
    // Total return derives strictly from the dice.
    expect(betReturn({ type: BetType.Big }, [5, 5, 4])).toBeGreaterThan(1); // total 14 wins big
    expect(betReturn({ type: BetType.Big }, [1, 1, 2])).toBe(0); // total 4 loses big
  });
});

const pf = new DemoProvablyFairProvider();

describe('sic-bo provably fair', () => {
  it('rolls deterministic dice and verifies a round', () => {
    const fairness: IFairnessProof = { serverSeed: 'S', serverSeedHash: '', clientSeed: 'C', nonce: 5 };
    const a = rollDice(pf, fairness);
    const b = rollDice(pf, fairness);
    expect(a).toEqual(b);
    expect(a.every((d) => d >= 1 && d <= 6)).toBe(true);
    expect(dieNonce(5, 2)).toBe(502);
    const v = verifyRoll(pf, { serverSeed: 'S', clientSeed: 'C', nonce: 5, expected: a });
    expect(v.valid).toBe(true);
    expect(verifyRoll(pf, { serverSeed: 'S', clientSeed: 'C', nonce: 5, expected: [1, 1, 1] as Dice }).valid).toBe(a[0] === 1 && a[1] === 1 && a[2] === 1);
  });
});

/* --------------------- runtime + ledger integration ----------------------- */

const PLAYER: PlayerContext = { playerId: 'demo-player', currency: 'INR' };
const CAPS: GameRegistration['capabilities'] = { cashOut: false, autoBet: true, multiBet: true, provablyFair: true, realtime: false, multiplayer: false, liveDealer: false, tournament: false };

/** A provider that forces a chosen dice outcome. */
function forcedDice(dice: Dice): IProvablyFairProvider {
  return { commit: () => ({ serverSeed: 'x', serverSeedHash: 'h' }), nextFloat: (i) => (dice[((i as { nonce: number }).nonce ?? 0) % 100]! - 0.5) / 6, verify: () => true };
}

function runtimeWith(rng: IProvablyFairProvider): GameRuntime {
  const rt = new GameRuntime({ ...createProviderSet(), provablyFair: rng }, PLAYER);
  rt.registerEngine(new SicBoEngine());
  rt.registerGame({ gameId: 'sic-bo', name: 'Sic Bo', engineKey: SIC_BO_ENGINE_KEY, category: 'instant', capabilities: CAPS, config: { minBet: 1, maxBet: 1_000_000, rewards: { winXp: 30, lossXp: 10 } } });
  return rt;
}

beforeEach(() => {
  useDemoWallet.getState().reset();
  useDemoWallet.getState().deposit(10_000);
});

describe('sic-bo runs through the frozen runtime + ledger', () => {
  it('settles multiple bets on one roll with exact stake→payout accounting', async () => {
    const dice: Dice = [5, 5, 4]; // total 14 → Big + Even + Double(5)
    const rt = runtimeWith(forcedDice(dice));
    const bets: PlacedBet[] = [
      { type: BetType.Big, amount: 50 },
      { type: BetType.Even, amount: 50 },
      { type: BetType.Small, amount: 50 }, // loses
      { type: BetType.Double, value: 5, amount: 50 },
    ];
    const session = await rt.createSession({ gameId: 'sic-bo' });
    const res = await rt.placeBet({ gameId: 'sic-bo', sessionId: session.sessionId, stake: { amount: '200', currency: 'INR' }, mode: BetMode.Single, selections: bets.map((b) => ({ pick: b })), idempotencyKey: 'sicbo-1', clientSeed: 'demo' });
    const expectedPayout = bets.reduce((s, b) => s + Math.round(b.amount * betReturn(b, dice)), 0);
    expect(Number(res.payout)).toBe(expectedPayout);
    expect(res.outcome).toBe(BetOutcome.Win); // net positive here
    expect(useDemoWallet.getState().balance).toBe(10_000 - 200 + expectedPayout);
    // The losing Small bet returns nothing.
    expect(betReturn({ type: BetType.Small, amount: 50 } as PlacedBet, dice)).toBe(0);
  });

  it('a losing board keeps the whole stake (no credit)', async () => {
    const dice: Dice = [6, 6, 6]; // triple → Big/Small/Odd/Even all lose
    const rt = runtimeWith(forcedDice(dice));
    const session = await rt.createSession({ gameId: 'sic-bo' });
    const res = await rt.placeBet({ gameId: 'sic-bo', sessionId: session.sessionId, stake: { amount: '100', currency: 'INR' }, mode: BetMode.Single, selections: [{ pick: { type: BetType.Small, amount: 50 } }, { pick: { type: BetType.Big, amount: 50 } }], idempotencyKey: 'sicbo-2', clientSeed: 'demo' });
    expect(Number(res.payout)).toBe(0);
    expect(useDemoWallet.getState().balance).toBe(9_900);
  });

  it('financial invariant — 30 real rolls keep exact stake→payout accounting', async () => {
    const rt = runtimeWith(new DemoProvablyFairProvider());
    const session = await rt.createSession({ gameId: 'sic-bo' });
    for (let i = 0; i < 30; i += 1) {
      const before = useDemoWallet.getState().balance;
      const res = await rt.placeBet<PlacedBet>({ gameId: 'sic-bo', sessionId: session.sessionId, stake: { amount: '30', currency: 'INR' }, mode: BetMode.Single, selections: [{ pick: { type: BetType.Big, amount: 10 } }, { pick: { type: BetType.Small, amount: 10 } }, { pick: { type: BetType.Single, value: 3, amount: 10 } }], idempotencyKey: `sicbo-loop-${i}`, clientSeed: 'demo' });
      expect(useDemoWallet.getState().balance).toBe(before - 30 + Number(res.payout));
    }
    expect(useDemoWallet.getState().balance).toBeGreaterThanOrEqual(0);
  });
});

describe('sic-bo helpers', () => {
  it('total + triple detection', () => {
    expect(total([3, 4, 5])).toBe(12);
    expect(isTriple([4, 4, 4])).toBe(true);
    expect(isTriple([4, 4, 5])).toBe(false);
  });
});
