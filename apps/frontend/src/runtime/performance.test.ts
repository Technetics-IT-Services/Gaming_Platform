import type { IBetRequest, IGameSession } from '@gaming-platform/types';
import { BetMode, SessionStatus } from '@gaming-platform/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { useDemoWallet } from '@/stores/demo-wallet';
import { BetEngine, type BetValidationContext } from './bet-engine';
import { EngineRegistry, type RuntimeGameEngine } from './engine-registry';
import { EventBus, RuntimeEventName } from './event-bus';
import { DemoProvablyFairProvider } from './providers/provably-fair';
import { SessionManager } from './session-manager';

/**
 * Performance sanity (STEP 10).
 *
 * NOT micro-benchmarks — these guard against accidental O(n²) regressions and
 * runaway allocation in the hot paths (session creation, bet validation, event
 * dispatch, provider lookup, repeated rounds). Budgets are deliberately generous
 * so CI stays stable across machines; a real regression blows past them by orders
 * of magnitude. Timings are logged for visibility.
 */

const session: IGameSession = {
  sessionId: 'sess_1',
  gameId: 'crash',
  playerId: 'demo-player',
  currency: 'INR',
  status: SessionStatus.Active,
  createdAt: new Date().toISOString(),
};

const bet: IBetRequest = {
  gameId: 'crash',
  sessionId: 'sess_1',
  stake: { amount: '10', currency: 'INR' },
  mode: BetMode.Single,
  selections: [{ pick: 2 }],
  idempotencyKey: 'idem-1',
};

const ctx: BetValidationContext = { session, balance: 1000, limits: { minBet: 1, maxBet: 1000 } };

/** Time a synchronous op and log throughput. */
function measure(label: string, ops: number, fn: () => void): number {
  const start = performance.now();
  fn();
  const ms = performance.now() - start;
  // eslint-disable-next-line no-console
  console.log(`[perf] ${label}: ${ops} ops in ${ms.toFixed(1)}ms (${Math.round(ops / (ms || 1))} ops/ms)`);
  return ms;
}

beforeEach(() => {
  useDemoWallet.getState().reset();
});

describe('performance — session creation', () => {
  it('creates 5,000 sessions well under budget', () => {
    const mgr = new SessionManager();
    const ms = measure('session.create', 5000, () => {
      for (let i = 0; i < 5000; i += 1) {
        mgr.createSession({ gameId: 'crash', playerId: 'p', currency: 'INR' });
      }
    });
    expect(ms).toBeLessThan(1000);
  });
});

describe('performance — bet validation', () => {
  it('validates 50,000 bets well under budget', () => {
    const engine = new BetEngine();
    const ms = measure('bet.validate', 50_000, () => {
      for (let i = 0; i < 50_000; i += 1) engine.validate(bet, ctx);
    });
    expect(ms).toBeLessThan(1000);
  });
});

describe('performance — event dispatch', () => {
  it('dispatches 100,000 events to a listener under budget', () => {
    const bus = new EventBus();
    let n = 0;
    bus.on(RuntimeEventName.ROUND_UPDATED, () => {
      n += 1;
    });
    const ms = measure('bus.emit', 100_000, () => {
      for (let i = 0; i < 100_000; i += 1) bus.emit(RuntimeEventName.ROUND_UPDATED, i);
    });
    expect(n).toBe(100_000);
    expect(ms).toBeLessThan(1000);
  });

  it('subscribe/unsubscribe churn of 50,000 does not degrade (no leak)', () => {
    const bus = new EventBus();
    const ms = measure('bus.on/off', 50_000, () => {
      for (let i = 0; i < 50_000; i += 1) {
        const off = bus.on(RuntimeEventName.BET_CREATED, () => undefined);
        off();
      }
    });
    // After the churn a single emit must reach zero stale listeners.
    let hit = 0;
    bus.on(RuntimeEventName.BET_CREATED, () => {
      hit += 1;
    });
    bus.emit(RuntimeEventName.BET_CREATED, {});
    expect(hit).toBe(1);
    expect(ms).toBeLessThan(1000);
  });
});

describe('performance — provider lookup', () => {
  it('resolves 100,000 engine lookups under budget (O(1) map)', () => {
    const registry = new EngineRegistry();
    const engine: RuntimeGameEngine = {
      engineKey: 'crash',
      createRound: () => ({ roundId: '', gameId: 'crash', state: {}, multiplier: 0, win: false, computedAt: '' }),
    };
    registry.register(engine);
    const ms = measure('registry.get', 100_000, () => {
      for (let i = 0; i < 100_000; i += 1) registry.get('crash');
    });
    expect(ms).toBeLessThan(200);
  });

  it('derives 100,000 provably-fair floats under budget', () => {
    const pf = new DemoProvablyFairProvider();
    const ms = measure('pf.nextFloat', 100_000, () => {
      for (let i = 0; i < 100_000; i += 1) pf.nextFloat({ serverSeed: 'srv', clientSeed: 'cli', nonce: i });
    });
    expect(ms).toBeLessThan(500);
  });
});

describe('performance — memory / repeated rounds', () => {
  it('creates 10,000 rounds and prunes them back to a bounded set', () => {
    const mgr = new SessionManager();
    const s = mgr.createSession({ gameId: 'crash', playerId: 'p', currency: 'INR' });
    const ids: string[] = [];
    measure('rounds.create+settle', 10_000, () => {
      for (let i = 0; i < 10_000; i += 1) {
        const r = mgr.createRound({
          session: s,
          bet,
          fairness: { serverSeedHash: 'h', clientSeed: 'c', nonce: i },
        });
        mgr.settle(r.roundId);
        ids.push(r.roundId);
      }
    });
    // Prune everything settled → the internal map is released (no unbounded growth).
    mgr.prune(-1);
    for (const id of ids) expect(mgr.getRound(id)).toBeNull();
  });
});
