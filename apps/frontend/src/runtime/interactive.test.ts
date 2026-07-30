import type { IBetRequest, IGameResult, IGameSession, IWalletProvider } from '@gaming-platform/types';
import { BetMode, BetOutcome, RuntimeState, SettlementType } from '@gaming-platform/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDemoWallet } from '@/stores/demo-wallet';
import { RuntimeErrorCode } from './errors';
import { RuntimeEventName, type RuntimeEvent } from './event-bus';
import { GameRuntime, type GameRegistration, type PlayerContext } from './game-runtime';
import { createProviderSet } from './providers';
import { DemoSettlementProvider } from './providers/settlement';
import { DemoWalletProvider } from './providers/wallet';
import { MockCardEngine, MockSlotEngine, scriptedProvablyFair, type MockCardState } from './testing/mock-engines';

/**
 * Interactive runtime + flexible settlement (Phase 2.3C).
 *
 * Drives the generic state machine (start → step → settle) via the reference
 * MockCardEngine and the flexible settlement path via MockSlotEngine. No real game
 * logic is under test — only that the runtime orchestrates generically.
 */

const PLAYER: PlayerContext = { playerId: 'demo-player', currency: 'INR' };
const CAPS: GameRegistration['capabilities'] = {
  cashOut: false,
  autoBet: false,
  multiBet: false,
  provablyFair: true,
  realtime: false,
  multiplayer: false,
  liveDealer: false,
  tournament: false,
};

function makeRuntime(floats: number[], engine: 'card' | 'slot'): GameRuntime {
  const providers = { ...createProviderSet(), provablyFair: scriptedProvablyFair(floats) };
  const rt = new GameRuntime(providers, PLAYER);
  if (engine === 'card') {
    rt.registerEngine(new MockCardEngine());
    rt.registerGame({ gameId: 'mockcard', name: 'mockcard', engineKey: 'mockcard', category: 'card', capabilities: CAPS, config: { minBet: 1, maxBet: 1_000_000 } });
  } else {
    rt.registerEngine(new MockSlotEngine());
    rt.registerGame({ gameId: 'mockslot', name: 'mockslot', engineKey: 'mockslot', category: 'slots', capabilities: CAPS, config: { minBet: 1, maxBet: 1_000_000 } });
  }
  return rt;
}

const cardBet = (): IBetRequest => ({
  gameId: 'mockcard',
  sessionId: '', // filled after session
  stake: { amount: '100', currency: 'INR' },
  mode: BetMode.Single,
  selections: [{ pick: null }],
  idempotencyKey: `idem-${Math.random()}`,
});

beforeEach(() => {
  useDemoWallet.getState().reset();
  useDemoWallet.getState().deposit(1000);
});

async function startCard(rt: GameRuntime) {
  const session = await rt.createSession({ gameId: 'mockcard' });
  return rt.startInteractive<MockCardState>({ ...cardBet(), sessionId: session.sessionId });
}

describe('interactive — state machine', () => {
  it('start debits the stake and opens in AwaitingPlayer', async () => {
    const rt = makeRuntime([0.4], 'card'); // first card = 5
    const { roundId, step } = await startCard(rt);
    expect(step.state).toBe(RuntimeState.AwaitingPlayer);
    expect(step.gameState.total).toBe(5);
    expect(step.availableActions).toEqual(['draw', 'stand']);
    expect(useDemoWallet.getState().balance).toBe(900); // stake debited up front
    expect(rt.getStep(roundId)?.state).toBe(RuntimeState.AwaitingPlayer);
  });

  it('getStep returns null for an unknown round', async () => {
    const rt = makeRuntime([0.5], 'card');
    expect(rt.getStep('nope')).toBeNull();
  });
});

describe('interactive — player actions & settlement types', () => {
  it('stand below 17 loses (no payout)', async () => {
    const rt = makeRuntime([0.4], 'card'); // total 5
    const { roundId } = await startCard(rt);
    const step = await rt.submitAction<MockCardState>({ roundId, action: { type: 'stand' } });
    expect(step.state).toBe(RuntimeState.Completed);
    expect(step.settlement?.type).toBe(SettlementType.Loss);
    expect(useDemoWallet.getState().balance).toBe(900); // stake stays spent
  });

  it('draw then stand at 18 pushes (stake refunded)', async () => {
    const rt = makeRuntime([0.9, 0.7], 'card'); // start 10, draw 8 → 18
    const { roundId } = await startCard(rt);
    const drawn = await rt.submitAction<MockCardState>({ roundId, action: { type: 'draw' } });
    expect(drawn.state).toBe(RuntimeState.AwaitingPlayer);
    expect(drawn.gameState.total).toBe(18);
    const done = await rt.submitAction<MockCardState>({ roundId, action: { type: 'stand' } });
    expect(done.settlement?.type).toBe(SettlementType.Push);
    expect(useDemoWallet.getState().balance).toBe(1000); // stake returned, net 0
  });

  it('draw to 20 then stand wins 2×', async () => {
    const rt = makeRuntime([0.9, 0.9], 'card'); // start 10, draw 10 → 20
    const { roundId } = await startCard(rt);
    await rt.submitAction({ roundId, action: { type: 'draw' } });
    const done = await rt.submitAction<MockCardState>({ roundId, action: { type: 'stand' } });
    expect(done.settlement?.type).toBe(SettlementType.Win);
    expect(useDemoWallet.getState().balance).toBe(1100); // 900 + 200 payout
  });

  it('drawing past 21 busts and settles a loss immediately', async () => {
    const rt = makeRuntime([0.9, 0.9, 0.9], 'card'); // 10 → 20 → 30
    const { roundId } = await startCard(rt);
    await rt.submitAction({ roundId, action: { type: 'draw' } }); // 20, still awaiting
    const bust = await rt.submitAction<MockCardState>({ roundId, action: { type: 'draw' } }); // 30
    expect(bust.state).toBe(RuntimeState.Completed);
    expect(bust.gameState.total).toBe(30);
    expect(bust.settlement?.reason).toBe('bust');
    expect(useDemoWallet.getState().balance).toBe(900);
  });

  it('the engine — not the runtime — rejects an illegal action', async () => {
    const rt = makeRuntime([0.4], 'card');
    const { roundId } = await startCard(rt);
    await expect(rt.submitAction({ roundId, action: { type: 'teleport' } })).rejects.toMatchObject({
      code: RuntimeErrorCode.INVALID_BET,
    });
  });
});

describe('interactive — guards', () => {
  it('rejects an action on an unknown round', async () => {
    const rt = makeRuntime([0.5], 'card');
    await expect(rt.submitAction({ roundId: 'ghost', action: { type: 'stand' } })).rejects.toMatchObject({
      code: RuntimeErrorCode.ROUND_NOT_FOUND,
    });
  });

  it('rejects an action after the round has completed', async () => {
    const rt = makeRuntime([0.4], 'card');
    const { roundId } = await startCard(rt);
    await rt.submitAction({ roundId, action: { type: 'stand' } }); // completes (loss)
    await expect(rt.submitAction({ roundId, action: { type: 'stand' } })).rejects.toMatchObject({
      code: RuntimeErrorCode.ROUND_ALREADY_SETTLED,
    });
  });

  it('cancelInteractive refunds the stake and marks the round Cancelled', async () => {
    const rt = makeRuntime([0.9], 'card');
    const { roundId } = await startCard(rt);
    expect(useDemoWallet.getState().balance).toBe(900);
    await rt.cancelInteractive({ roundId });
    expect(useDemoWallet.getState().balance).toBe(1000); // refunded
    expect(rt.getStep(roundId)?.state).toBe(RuntimeState.Cancelled);
  });

  it('expires an interactive round left past the idle window', async () => {
    vi.useFakeTimers();
    try {
      const rt = makeRuntime([0.4], 'card');
      const session = await rt.createSession({ gameId: 'mockcard' });
      const { roundId } = await rt.startInteractive({ ...cardBet(), sessionId: session.sessionId });
      vi.setSystemTime(Date.now() + 16 * 60_000); // past the 15-minute idle window
      await expect(rt.submitAction({ roundId, action: { type: 'stand' } })).rejects.toMatchObject({
        code: RuntimeErrorCode.SESSION_EXPIRED,
      });
      expect(rt.getStep(roundId)?.state).toBe(RuntimeState.Expired);
    } finally {
      vi.useRealTimers();
    }
  });

  it('startInteractive rejects a game whose engine is single-shot (no start)', async () => {
    const rt = makeRuntime([0.5], 'slot'); // MockSlotEngine has createRound, no start
    const session = await rt.createSession({ gameId: 'mockslot' });
    await expect(
      rt.startInteractive({
        gameId: 'mockslot',
        sessionId: session.sessionId,
        stake: { amount: '100', currency: 'INR' },
        mode: BetMode.Single,
        selections: [{ pick: null }],
        idempotencyKey: 'k1',
      }),
    ).rejects.toMatchObject({ code: RuntimeErrorCode.ENGINE_FAILURE });
  });

  it('startInteractive rejects (and does not debit) when the balance is short', async () => {
    useDemoWallet.getState().reset();
    useDemoWallet.getState().deposit(10); // less than the 100 stake
    const rt = makeRuntime([0.4], 'card');
    const session = await rt.createSession({ gameId: 'mockcard' });
    await expect(rt.startInteractive({ ...cardBet(), sessionId: session.sessionId })).rejects.toBeTruthy();
    expect(useDemoWallet.getState().balance).toBe(10); // never debited
  });
});

describe('interactive — events', () => {
  it('emits the generic interactive events in order through a full round', async () => {
    const rt = makeRuntime([0.9, 0.9], 'card');
    const session = await rt.createSession({ gameId: 'mockcard' });
    const seen: RuntimeEventName[] = [];
    rt.onAny((e: RuntimeEvent) => seen.push(e.name));
    const { roundId } = await rt.startInteractive({ ...cardBet(), sessionId: session.sessionId });
    await rt.submitAction({ roundId, action: { type: 'draw' } });
    await rt.submitAction({ roundId, action: { type: 'stand' } });

    const idx = (n: RuntimeEventName) => seen.indexOf(n);
    expect(seen).toContain(RuntimeEventName.STEP_STARTED);
    expect(seen).toContain(RuntimeEventName.PLAYER_ACTION);
    expect(seen).toContain(RuntimeEventName.STEP_COMPLETED);
    expect(seen).toContain(RuntimeEventName.STATE_CHANGED);
    expect(seen).toContain(RuntimeEventName.SETTLEMENT_UPDATED);
    expect(idx(RuntimeEventName.STEP_STARTED)).toBeLessThan(idx(RuntimeEventName.PLAYER_ACTION));
    expect(idx(RuntimeEventName.SETTLEMENT_UPDATED)).toBeLessThan(idx(RuntimeEventName.ROUND_FINISHED));
  });
});

describe('flexible settlement — via placeBet (MockSlotEngine)', () => {
  const slotBet = (sessionId: string): IBetRequest => ({
    gameId: 'mockslot',
    sessionId,
    stake: { amount: '100', currency: 'INR' },
    mode: BetMode.Single,
    selections: [{ pick: null }],
    idempotencyKey: `idem-${Math.random()}`,
  });

  it('settles a jackpot with an absolute payout + bonus + metadata', async () => {
    const rt = makeRuntime([0.05], 'slot'); // r < 0.1 → jackpot
    const session = await rt.createSession({ gameId: 'mockslot' });
    const res = await rt.placeBet(slotBet(session.sessionId));
    expect(res.outcome).toBe(BetOutcome.Win);
    expect(res.payout).toBe('6000'); // stake*10 (1000) + bonus 5000
    expect(res.metadata).toMatchObject({ jackpot: true });
    expect(useDemoWallet.getState().balance).toBe(6900); // 900 + 6000
  });

  it('settles an ordinary multiplied win', async () => {
    const rt = makeRuntime([0.3], 'slot'); // 0.1..0.5 → win 3×
    const session = await rt.createSession({ gameId: 'mockslot' });
    const res = await rt.placeBet(slotBet(session.sessionId));
    expect(res.payout).toBe('300');
    expect(useDemoWallet.getState().balance).toBe(1200);
  });

  it('settles a loss with no payout', async () => {
    const rt = makeRuntime([0.9], 'slot'); // r >= 0.5 → loss
    const session = await rt.createSession({ gameId: 'mockslot' });
    const res = await rt.placeBet(slotBet(session.sessionId));
    expect(res.outcome).toBe(BetOutcome.Loss);
    expect(res.payout).toBe('0');
    expect(useDemoWallet.getState().balance).toBe(900);
  });
});

describe('flexible settlement — DemoSettlementProvider unit', () => {
  const session: IGameSession = {
    sessionId: 's',
    gameId: 'mockslot',
    playerId: 'demo-player',
    currency: 'INR',
    status: 'active' as IGameSession['status'],
    createdAt: new Date().toISOString(),
  };
  const bet: IBetRequest = {
    gameId: 'mockslot',
    sessionId: 's',
    stake: { amount: '100', currency: 'INR' },
    mode: BetMode.Single,
    selections: [{ pick: null }],
    idempotencyKey: 'k',
  };
  const resultWith = (settlement: IGameResult['settlement']): IGameResult => ({
    roundId: 'r1',
    gameId: 'mockslot',
    state: {},
    multiplier: 0,
    win: false,
    computedAt: new Date().toISOString(),
    settlement,
  });
  const settle = (settlement: IGameResult['settlement']) => {
    const wallet: IWalletProvider = new DemoWalletProvider();
    return new DemoSettlementProvider().settle({ session, result: resultWith(settlement), bet, wallet });
  };

  it('push → outcome Push, stake refunded, net 0', async () => {
    const res = await settle({ type: SettlementType.Push, payout: '0', refund: '100' });
    expect(res.outcome).toBe(BetOutcome.Push);
    expect(res.payout).toBe('100');
    expect(res.netProfit).toBe('0');
  });

  it('refund → outcome Refund', async () => {
    const res = await settle({ type: SettlementType.Refund, payout: '0', refund: '100' });
    expect(res.outcome).toBe(BetOutcome.Refund);
  });

  it('bonus → credited on top, outcome Win, metadata carried', async () => {
    const res = await settle({ type: SettlementType.Bonus, payout: '0', bonus: '500', metadata: { source: 'promo' } });
    expect(res.payout).toBe('500');
    expect(res.outcome).toBe(BetOutcome.Win);
    expect(res.metadata).toEqual({ source: 'promo' });
  });

  it('custom → outcome derived from the net credited', async () => {
    expect((await settle({ type: SettlementType.Custom, payout: '250' })).outcome).toBe(BetOutcome.Win);
    expect((await settle({ type: SettlementType.Custom, payout: '0' })).outcome).toBe(BetOutcome.Loss);
    expect((await settle({ type: SettlementType.Custom, payout: '0', refund: '100' })).outcome).toBe(BetOutcome.Push);
  });

  it('falls back to stake × multiplier when no settlement is provided (backward compatible)', async () => {
    const wallet: IWalletProvider = new DemoWalletProvider();
    const result: IGameResult = {
      roundId: 'r2',
      gameId: 'crash',
      state: {},
      multiplier: 2,
      win: true,
      computedAt: new Date().toISOString(),
    };
    const res = await new DemoSettlementProvider().settle({ session, result, bet, wallet });
    expect(res.payout).toBe('200'); // 100 × 2 — the legacy path
    expect(res.outcome).toBe(BetOutcome.Win);
  });
});
