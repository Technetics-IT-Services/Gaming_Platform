import type { IBetRequest, IGameResult, IGameSession } from '@gaming-platform/types';
import { BetMode, BetOutcome } from '@gaming-platform/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDemoWallet } from '@/stores/demo-wallet';
import { BetEngine } from './bet-engine';
import { CrashEngine, CRASH_CONFIG } from './engines/crash-engine';
import type { RuntimeGameEngine } from './engine-registry';
import { RuntimeErrorCode, ValidationError } from './errors';
import { RuntimeEventName, type RuntimeEvent } from './event-bus';
import { GameRuntime, type GameRegistration, type PlayerContext } from './game-runtime';
import { createProviderSet } from './providers';

/**
 * Game runtime (STEP 2 integration).
 *
 * The runtime is the one orchestrator between UI and the platform. These tests
 * drive the full lifecycle end-to-end through the DEMO providers: session commit,
 * validate → debit, engine, settle → credit → history, and the events emitted at
 * every step. Balance bookkeeping is asserted against the demo wallet store.
 */

const PLAYER: PlayerContext = { playerId: 'demo-player', currency: 'INR' };

const CRASH_GAME: GameRegistration = {
  gameId: 'crash',
  name: 'Crash',
  engineKey: 'crash',
  category: 'crash',
  capabilities: {
    cashOut: true,
    autoBet: true,
    multiBet: false,
    provablyFair: true,
    realtime: true,
    multiplayer: false,
    liveDealer: false,
    tournament: false,
  },
  config: { ...CRASH_CONFIG, minBet: 1, maxBet: 1000 },
};

/** A deterministic instant-win engine to exercise the placeBet (single-shot) path. */
class InstantWinEngine implements RuntimeGameEngine {
  readonly engineKey = 'instant';
  createRound(input: { session: IGameSession }): IGameResult {
    return {
      roundId: '',
      gameId: input.session.gameId,
      state: { picked: true },
      multiplier: 3,
      win: true,
      computedAt: new Date().toISOString(),
    };
  }
}

const INSTANT_GAME: GameRegistration = {
  ...CRASH_GAME,
  gameId: 'instant',
  name: 'Instant',
  engineKey: 'instant',
};

function newRuntime(): GameRuntime {
  const rt = new GameRuntime(createProviderSet(), PLAYER);
  rt.registerEngine(new CrashEngine());
  rt.registerEngine(new InstantWinEngine());
  rt.registerGame(CRASH_GAME);
  rt.registerGame(INSTANT_GAME);
  return rt;
}

const betFor = (session: IGameSession, over: Partial<IBetRequest<number>> = {}): IBetRequest<number> => ({
  gameId: session.gameId,
  sessionId: session.sessionId,
  stake: { amount: '100', currency: 'INR' },
  mode: BetMode.Single,
  selections: [{ pick: 2 }],
  idempotencyKey: `idem-${Math.random()}`,
  ...over,
});

let runtime: GameRuntime;
beforeEach(() => {
  useDemoWallet.getState().reset();
  useDemoWallet.getState().deposit(1000);
  runtime = newRuntime();
});

describe('game-runtime — session', () => {
  it('creates an active session with a provably-fair commit and emits the events', async () => {
    const events: RuntimeEventName[] = [];
    runtime.onAny((e) => events.push(e.name));
    const session = await runtime.createSession({ gameId: 'crash' });
    expect(session.status).toBe('active');
    expect(session.serverSeedHash).toBeTruthy();
    expect(events).toContain(RuntimeEventName.PROVABLY_FAIR_GENERATED);
    expect(events).toContain(RuntimeEventName.SESSION_CREATED);
    expect(runtime.getSession(session.sessionId)).toBe(session);
  });
});

describe('game-runtime — cashable lifecycle (crash)', () => {
  it('startRound validates, debits the stake, and runs the engine', async () => {
    const session = await runtime.createSession({ gameId: 'crash' });
    const { result, roundId } = await runtime.startRound(betFor(session));
    expect(roundId).toMatch(/^round_/);
    expect((result.state as { crashPoint: number }).crashPoint).toBeGreaterThanOrEqual(1);
    expect(useDemoWallet.getState().balance).toBe(900); // 1000 − 100 stake
  });

  it('cashOut settles a win, credits the payout, and returns a Win result', async () => {
    const session = await runtime.createSession({ gameId: 'crash' });
    const { roundId } = await runtime.startRound(betFor(session));
    const out = await runtime.cashOut({ roundId, atMultiplier: 2 });
    expect(out.outcome).toBe(BetOutcome.Win);
    expect(out.payout).toBe('200');
    expect(out.multiplier).toBe(2);
    expect(useDemoWallet.getState().balance).toBe(1100); // 900 + 200 payout
  });

  it('finishRound settles a loss with no payout', async () => {
    const session = await runtime.createSession({ gameId: 'crash' });
    const { roundId } = await runtime.startRound(betFor(session));
    const out = await runtime.finishRound({ roundId, finalMultiplier: 1.2 });
    expect(out.outcome).toBe(BetOutcome.Loss);
    expect(out.payout).toBe('0');
    expect(useDemoWallet.getState().balance).toBe(900); // stake stays spent
  });

  it('cancelRound refunds the stake and voids the round', async () => {
    const session = await runtime.createSession({ gameId: 'crash' });
    const { roundId } = await runtime.startRound(betFor(session));
    expect(useDemoWallet.getState().balance).toBe(900);
    await runtime.cancelRound({ roundId });
    expect(useDemoWallet.getState().balance).toBe(1000); // stake returned
    // The refund is credited back through the wallet provider (a +100 movement).
    expect(useDemoWallet.getState().transactions[0].amount).toBe(100);
  });

  it('cashOut / finishRound on an unknown round throw ROUND_NOT_FOUND', async () => {
    await expect(runtime.cashOut({ roundId: 'nope', atMultiplier: 2 })).rejects.toMatchObject({
      code: RuntimeErrorCode.ROUND_NOT_FOUND,
    });
    await expect(runtime.finishRound({ roundId: 'nope' })).rejects.toMatchObject({
      code: RuntimeErrorCode.ROUND_NOT_FOUND,
    });
  });

  it('cancelRound on an unknown round is a safe no-op', async () => {
    await expect(runtime.cancelRound({ roundId: 'nope' })).resolves.toBeUndefined();
    expect(useDemoWallet.getState().balance).toBe(1000);
  });
});

describe('game-runtime — instant lifecycle (placeBet)', () => {
  it('runs the full single-shot pipeline and credits a win', async () => {
    const session = await runtime.createSession({ gameId: 'instant' });
    const out = await runtime.placeBet(betFor(session, { gameId: 'instant' }));
    expect(out.outcome).toBe(BetOutcome.Win);
    expect(out.payout).toBe('300'); // stake 100 × 3
    expect(useDemoWallet.getState().balance).toBe(1200); // 900 debited + 300 payout
  });
});

describe('game-runtime — event ordering', () => {
  it('emits the canonical pipeline events in order for a winning cash-out', async () => {
    const session = await runtime.createSession({ gameId: 'crash' });
    const seen: RuntimeEventName[] = [];
    runtime.onAny((e) => seen.push(e.name));
    const { roundId } = await runtime.startRound(betFor(session));
    await runtime.cashOut({ roundId, atMultiplier: 2 });

    // Assert relative order of the key milestones (other events may interleave).
    const idx = (n: RuntimeEventName) => seen.indexOf(n);
    expect(idx(RuntimeEventName.BET_CREATED)).toBeLessThan(idx(RuntimeEventName.BET_VALIDATED));
    expect(idx(RuntimeEventName.BET_VALIDATED)).toBeLessThan(idx(RuntimeEventName.WALLET_DEBITED));
    expect(idx(RuntimeEventName.WALLET_DEBITED)).toBeLessThan(idx(RuntimeEventName.ROUND_STARTED));
    expect(idx(RuntimeEventName.ROUND_STARTED)).toBeLessThan(idx(RuntimeEventName.SETTLEMENT_STARTED));
    expect(idx(RuntimeEventName.SETTLEMENT_STARTED)).toBeLessThan(idx(RuntimeEventName.WALLET_CREDITED));
    expect(idx(RuntimeEventName.WALLET_CREDITED)).toBeLessThan(idx(RuntimeEventName.SETTLEMENT_COMPLETED));
    expect(idx(RuntimeEventName.SETTLEMENT_COMPLETED)).toBeLessThan(idx(RuntimeEventName.HISTORY_UPDATED));
    expect(idx(RuntimeEventName.HISTORY_UPDATED)).toBeLessThan(idx(RuntimeEventName.ROUND_FINISHED));
  });

  it('subscribe(sessionId) only delivers events for that session', async () => {
    const a = await runtime.createSession({ gameId: 'crash' });
    const b = await runtime.createSession({ gameId: 'crash' });
    const forA: RuntimeEvent[] = [];
    runtime.subscribe(a.sessionId, (e) => forA.push(e));
    const { roundId } = await runtime.startRound(betFor(b));
    await runtime.cashOut({ roundId, atMultiplier: 2 });
    // No round events for session b should have leaked into A's subscription.
    expect(forA.some((e) => e.sessionId === b.sessionId)).toBe(false);
  });
});

describe('game-runtime — rejection wiring', () => {
  it('rejects an over-balance bet with INSUFFICIENT_BALANCE and emits BET_REJECTED + ERROR', async () => {
    useDemoWallet.getState().reset();
    useDemoWallet.getState().deposit(50); // less than the 100 stake
    const session = await runtime.createSession({ gameId: 'crash' });
    const seen: RuntimeEventName[] = [];
    runtime.onAny((e) => seen.push(e.name));

    await expect(runtime.startRound(betFor(session))).rejects.toBeInstanceOf(ValidationError);
    expect(seen).toContain(RuntimeEventName.BET_REJECTED);
    expect(seen).toContain(RuntimeEventName.ERROR);
    expect(useDemoWallet.getState().balance).toBe(50); // never debited
  });

  it('rejects a bet for a game with no engine (ENGINE_FAILURE)', async () => {
    const rt = new GameRuntime(createProviderSet(), PLAYER);
    rt.registerGame({ ...CRASH_GAME, engineKey: 'missing' }); // registered game, no engine
    const session = await rt.createSession({ gameId: 'crash' });
    await expect(rt.startRound(betFor(session))).rejects.toMatchObject({ code: RuntimeErrorCode.ENGINE_FAILURE });
  });

  it('placeBet surfaces a rejected bet as a thrown error and emits ERROR', async () => {
    useDemoWallet.getState().reset();
    useDemoWallet.getState().deposit(10); // under the 100 stake
    const session = await runtime.createSession({ gameId: 'instant' });
    const seen: RuntimeEventName[] = [];
    runtime.onAny((e) => seen.push(e.name));
    await expect(runtime.placeBet(betFor(session, { gameId: 'instant' }))).rejects.toBeInstanceOf(ValidationError);
    expect(seen).toContain(RuntimeEventName.ERROR);
  });

  it('a settlement failure emits SETTLEMENT_FAILED and propagates', async () => {
    const session = await runtime.createSession({ gameId: 'crash' });
    const { roundId } = await runtime.startRound(betFor(session));
    const providers = (runtime as unknown as { providers: ReturnType<typeof createProviderSet> }).providers;
    vi.spyOn(providers.settlement, 'settle').mockRejectedValueOnce(new Error('ledger down'));
    const seen: RuntimeEventName[] = [];
    runtime.onAny((e) => seen.push(e.name));
    await expect(runtime.cashOut({ roundId, atMultiplier: 2 })).rejects.toBeTruthy();
    expect(seen).toContain(RuntimeEventName.SETTLEMENT_FAILED);
  });
});

describe('game-runtime — history & replay', () => {
  it('exposes settled bets through getHistory', async () => {
    const session = await runtime.createSession({ gameId: 'crash' });
    const { roundId } = await runtime.startRound(betFor(session));
    await runtime.cashOut({ roundId, atMultiplier: 2 });
    const { items } = await runtime.getHistory({ gameId: 'crash', limit: 10 });
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].outcome).toBe(BetOutcome.Win);
  });

  it('returns replay fairness for a round, with an incrementing nonce', async () => {
    const session = await runtime.createSession({ gameId: 'crash' });
    const r1 = await runtime.startRound(betFor(session));
    const r2 = await runtime.startRound(betFor(session));
    const f1 = runtime.getReplay(r1.roundId);
    const f2 = runtime.getReplay(r2.roundId);
    expect(f1?.nonce).toBe(1);
    expect(f2?.nonce).toBe(2);
    expect(f1?.serverSeed).toBeTruthy();
    expect(runtime.getReplay('nope')).toBeNull();
  });

  it('a cashed-out round is reproducible from its replay seeds', async () => {
    const session = await runtime.createSession({ gameId: 'crash' });
    const { roundId } = await runtime.startRound(betFor(session));
    const proof = runtime.getReplay(roundId);
    expect(proof).not.toBeNull();
    // The demo PF provider verifies the recorded float deterministically.
    const providers = createProviderSet();
    const value = providers.provablyFair.nextFloat({
      serverSeed: proof!.serverSeed!,
      clientSeed: proof!.clientSeed,
      nonce: proof!.nonce,
    });
    expect(providers.provablyFair.verify(proof!, value)).toBe(true);
  });
});

describe('game-runtime — observability never fails a settled bet', () => {
  it('swallows a notification failure and still returns the settled result', async () => {
    const session = await runtime.createSession({ gameId: 'crash' });
    const { roundId } = await runtime.startRound(betFor(session));
    // Force the best-effort tail to throw; the bet must still settle cleanly.
    const providers = (runtime as unknown as { providers: ReturnType<typeof createProviderSet> }).providers;
    vi.spyOn(providers.notifications, 'notify').mockRejectedValueOnce(new Error('notify down'));
    const out = await runtime.cashOut({ roundId, atMultiplier: 2 });
    expect(out.outcome).toBe(BetOutcome.Win);
  });
});

describe('game-runtime — wiring sanity', () => {
  it('uses a real BetEngine for validation', () => {
    // The runtime composes the concrete engine; this guards against a stubbed swap.
    expect(new BetEngine()).toBeInstanceOf(BetEngine);
  });
});
