import type { IFairnessProof, IProvablyFairProvider } from '@gaming-platform/types';
import { BetMode, RuntimeState } from '@gaming-platform/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { useDemoWallet } from '@/stores/demo-wallet';
import { GameRuntime, type GameRegistration, type PlayerContext } from '@/runtime/game-runtime';
import { createProviderSet } from '@/runtime/providers';
import { DemoProvablyFairProvider } from '@/runtime/providers/provably-fair';

import { ScheduledDrawEngine, DrawStatus } from './draw-engine';
import { LOTTERY_DEFAULT, LOTTERY_ENGINE_KEY, NumberLotteryEngine } from './engine';
import { DEFAULT_PRIZE_TABLE, rtp } from './prizes';
import { countMatches, tierCounts, tierFor, tierProbabilities } from './probability';
import { deriveDraw, quickPick, verifyDraw } from './provably-fair';
import { type LotteryState, PrizeTier, type TicketPick } from './types';

/**
 * Number Lottery (Sprint 4). Verifies the exact hypergeometric probability model, the
 * prize tiers + RTP band, quick pick, the reusable Scheduled Draw Engine, provably-fair
 * draws + replay, and end-to-end money flow through the FROZEN interactive runtime +
 * ledger. No runtime/wallet/ledger code is modified.
 */

/* -------------------------------- math ------------------------------------ */

describe('lottery probability & prizes', () => {
  it('matches the exact 6/49 tier odds', () => {
    const c = tierCounts(6, 49);
    expect(c.total).toBe(13_983_816);
    expect(c.counts[PrizeTier.Jackpot]).toBe(1);
    expect(c.counts[PrizeTier.FivePlusBonus]).toBe(6);
    expect(c.counts[PrizeTier.Five]).toBe(252);
    expect(c.counts[PrizeTier.Four]).toBe(13_545);
    expect(c.counts[PrizeTier.Three]).toBe(246_820);
    expect(c.counts[PrizeTier.Two]).toBe(1_851_150);
    const p = tierProbabilities();
    expect(Math.round(1 / p[PrizeTier.Jackpot])).toBe(13_983_816);
    expect(Math.round(1 / p[PrizeTier.FivePlusBonus])).toBe(2_330_636);
  });

  it('RTP is in the 96–97% band', () => {
    const r = rtp(DEFAULT_PRIZE_TABLE);
    expect(r).toBeGreaterThanOrEqual(0.96);
    expect(r).toBeLessThanOrEqual(0.97);
  });

  it('classifies tiers strictly from the match counts', () => {
    expect(tierFor(6, false)).toBe(PrizeTier.Jackpot);
    expect(tierFor(5, true)).toBe(PrizeTier.FivePlusBonus);
    expect(tierFor(5, false)).toBe(PrizeTier.Five);
    expect(tierFor(4, false)).toBe(PrizeTier.Four);
    expect(tierFor(2, false)).toBe(PrizeTier.Two);
    expect(tierFor(1, false)).toBeNull();
    expect(countMatches([1, 2, 3, 9, 10, 11], [1, 2, 3, 4, 5, 6])).toBe(3);
  });
});

/* ----------------------------- provably fair ------------------------------ */

const pf = new DemoProvablyFairProvider();

describe('lottery provably fair', () => {
  it('derives a valid, reproducible draw and quick pick', () => {
    const fairness: IFairnessProof = { serverSeed: 'S', serverSeedHash: '', clientSeed: 'C', nonce: 8 };
    const a = deriveDraw(pf, fairness, { drawMain: 6, range: 49, bonus: true });
    const b = deriveDraw(pf, fairness, { drawMain: 6, range: 49, bonus: true });
    expect(a).toEqual(b);
    expect(a.main).toHaveLength(6);
    expect(new Set([...a.main, a.bonus]).size).toBe(7); // all distinct
    expect(a.main.every((n) => n >= 1 && n <= 49)).toBe(true);
    expect([...a.main]).toEqual([...a.main].sort((x, y) => x - y)); // sorted

    const qp = quickPick(pf, fairness, { pick: 6, range: 49 });
    expect(new Set(qp).size).toBe(6);

    const v = verifyDraw(pf, { serverSeed: 'S', clientSeed: 'C', nonce: 8, drawMain: 6, range: 49, bonus: true, expected: a });
    expect(v.valid).toBe(true);
    expect(verifyDraw(pf, { serverSeed: 'S', clientSeed: 'C', nonce: 8, drawMain: 6, range: 49, bonus: true, expected: { main: [1, 2, 3, 4, 5, 6], bonus: 7 } }).valid).toBe(a.main.join() === '1,2,3,4,5,6' && a.bonus === 7);
  });
});

/* -------------------------- scheduled draw engine ------------------------- */

describe('scheduled draw engine', () => {
  it('schedules, counts down, closes sales, executes once and replays', () => {
    let t = 1_000_000;
    const engine = new ScheduledDrawEngine({ drawMain: 6, range: 49, bonus: true }, () => t);
    const draw = engine.schedule('draw-1', t + 60_000, { closeBeforeMs: 10_000 });
    expect(draw.status).toBe(DrawStatus.Scheduled);
    expect(engine.countdown('draw-1')).toBe(60_000);
    expect(engine.salesOpen('draw-1')).toBe(true);
    engine.addTicket('draw-1', { ticketId: 'tkt-1' }, 1);
    expect(engine.get('draw-1').tickets).toHaveLength(1);
    expect(engine.get('draw-1').jackpotPool).toBe(1);

    t += 55_000; // within 10s of the draw → sales closed
    expect(engine.salesOpen('draw-1')).toBe(false);
    expect(() => engine.addTicket('draw-1', { ticketId: 'late' })).toThrow(/sales closed/);
    expect(() => engine.execute(pf, 'draw-1', { serverSeed: 'D', serverSeedHash: '', clientSeed: 'C', nonce: 1 })).toThrow(/not reached/);

    t += 6_000; // past the draw time
    expect(engine.dueDraws()).toHaveLength(1);
    const exec = engine.execute(pf, 'draw-1', { serverSeed: 'D', serverSeedHash: '', clientSeed: 'C', nonce: 1 });
    expect(exec.result.main).toHaveLength(6);
    expect(engine.get('draw-1').status).toBe(DrawStatus.Drawn);
    // idempotent + replayable
    expect(engine.execute(pf, 'draw-1', { serverSeed: 'D', serverSeedHash: '', clientSeed: 'C', nonce: 1 }).result).toEqual(exec.result);
    expect(engine.replay(pf, 'draw-1')).toEqual(exec.result);
  });
});

/* --------------------- runtime + ledger integration ----------------------- */

const PLAYER: PlayerContext = { playerId: 'demo-player', currency: 'INR' };
const CAPS: GameRegistration['capabilities'] = { cashOut: false, autoBet: true, multiBet: false, provablyFair: true, realtime: false, multiplayer: true, liveDealer: false, tournament: false };

/** A provider whose floats always pick index 0 → the draw is [1..6] + bonus 7. */
const zeroPf: IProvablyFairProvider = { commit: () => ({ serverSeed: 'x', serverSeedHash: 'h' }), nextFloat: () => 0, verify: () => true };

function runtimeWith(rng: IProvablyFairProvider): GameRuntime {
  const rt = new GameRuntime({ ...createProviderSet(), provablyFair: rng }, PLAYER);
  rt.registerEngine(new NumberLotteryEngine());
  rt.registerGame({ gameId: 'lottery', name: 'Number Lottery', engineKey: LOTTERY_ENGINE_KEY, category: 'instant', capabilities: CAPS, config: { ...LOTTERY_DEFAULT, minBet: 1, maxBet: 1_000_000, rewards: { winXp: 40, lossXp: 5 } } as never });
  return rt;
}

beforeEach(() => {
  useDemoWallet.getState().reset();
  useDemoWallet.getState().deposit(20_000_000);
});

describe('lottery runs through the frozen interactive runtime + ledger', () => {
  it('buys a ticket (debit) and settles the JACKPOT on the scheduled draw (credit)', async () => {
    const rt = runtimeWith(zeroPf); // draw = [1,2,3,4,5,6] + bonus 7
    const session = await rt.createSession({ gameId: 'lottery' });
    const { roundId, step } = await rt.startInteractive<LotteryState>({ gameId: 'lottery', sessionId: session.sessionId, stake: { amount: '2', currency: 'INR' }, mode: BetMode.Single, selections: [{ pick: { numbers: [1, 2, 3, 4, 5, 6], drawId: 'd1' } as TicketPick }], idempotencyKey: 'lot-1', clientSeed: 'demo' });
    expect(step.state).toBe(RuntimeState.AwaitingSystem); // ticket held until the draw
    expect(useDemoWallet.getState().balance).toBe(20_000_000 - 2); // ticket price debited

    const settled = await rt.submitAction<LotteryState>({ roundId, action: { type: 'draw', payload: { serverSeed: 'D', clientSeed: 'C', nonce: 1 } } });
    expect(settled.state).toBe(RuntimeState.Completed);
    expect(settled.gameState.tier).toBe(PrizeTier.Jackpot);
    const prize = 2 * DEFAULT_PRIZE_TABLE[PrizeTier.Jackpot];
    expect(useDemoWallet.getState().balance).toBe(20_000_000 - 2 + prize); // exact debit → prize credit
  });

  it('a non-winning ticket keeps only the stake (no credit)', async () => {
    const rt = runtimeWith(zeroPf); // draw = [1..6]+7
    const session = await rt.createSession({ gameId: 'lottery' });
    const { roundId } = await rt.startInteractive<LotteryState>({ gameId: 'lottery', sessionId: session.sessionId, stake: { amount: '2', currency: 'INR' }, mode: BetMode.Single, selections: [{ pick: { numbers: [10, 20, 30, 40, 45, 49] } as TicketPick }], idempotencyKey: 'lot-2', clientSeed: 'demo' });
    const settled = await rt.submitAction<LotteryState>({ roundId, action: { type: 'draw', payload: { serverSeed: 'D', clientSeed: 'C', nonce: 1 } } });
    expect(settled.gameState.tier).toBeNull();
    expect(useDemoWallet.getState().balance).toBe(20_000_000 - 2); // stake lost, no credit
  });

  it('financial invariant — 20 quick-pick tickets keep exact stake→prize accounting', async () => {
    const rt = runtimeWith(new DemoProvablyFairProvider());
    const session = await rt.createSession({ gameId: 'lottery' });
    for (let i = 0; i < 20; i += 1) {
      const before = useDemoWallet.getState().balance;
      const { roundId, step } = await rt.startInteractive<LotteryState>({ gameId: 'lottery', sessionId: session.sessionId, stake: { amount: '2', currency: 'INR' }, mode: BetMode.Single, selections: [{ pick: { quickPick: true } as TicketPick }], idempotencyKey: `lot-loop-${i}`, clientSeed: 'demo' });
      expect(step.gameState.quickPick).toBe(true);
      expect(step.gameState.numbers).toHaveLength(6);
      const settled = await rt.submitAction<LotteryState>({ roundId, action: { type: 'draw', payload: { serverSeed: `D${i}`, clientSeed: 'C', nonce: i + 1 } } });
      const prize = Number(settled.gameState.prizeMultiplier ?? 0) * 2;
      expect(useDemoWallet.getState().balance).toBe(before - 2 + prize);
    }
    expect(useDemoWallet.getState().balance).toBeGreaterThanOrEqual(0);
  });
});
