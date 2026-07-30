import type { IBetRequest, IGameResult, IGameSession } from '@gaming-platform/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { EngineRegistry, type RuntimeGameEngine } from './engine-registry';

/**
 * Engine registry (STEP 2).
 *
 * Keyed lookup of game engines. New games register an engine here; the runtime
 * resolves it by `engineKey`. Tests cover register/get/has, overwrite semantics,
 * and unknown-key safety.
 */

const stubEngine = (engineKey: string): RuntimeGameEngine => ({
  engineKey,
  createRound: (): IGameResult => ({
    roundId: '',
    gameId: 'x',
    state: {},
    multiplier: 0,
    win: false,
    computedAt: new Date().toISOString(),
  }),
});

let registry: EngineRegistry;
beforeEach(() => {
  registry = new EngineRegistry();
});

describe('engine-registry', () => {
  it('registers and retrieves an engine by key', () => {
    const engine = stubEngine('crash');
    registry.register(engine);
    expect(registry.get('crash')).toBe(engine);
    expect(registry.has('crash')).toBe(true);
  });

  it('returns undefined and false for an unregistered key', () => {
    expect(registry.get('dice')).toBeUndefined();
    expect(registry.has('dice')).toBe(false);
  });

  it('keeps engines isolated by key', () => {
    registry.register(stubEngine('crash'));
    registry.register(stubEngine('dice'));
    expect(registry.get('crash')?.engineKey).toBe('crash');
    expect(registry.get('dice')?.engineKey).toBe('dice');
  });

  it('re-registering the same key overwrites the previous engine', () => {
    const first = stubEngine('crash');
    const second = stubEngine('crash');
    registry.register(first);
    registry.register(second);
    expect(registry.get('crash')).toBe(second);
  });

  it('resolves a registered engine that produces a result', () => {
    registry.register(stubEngine('crash'));
    const engine = registry.get('crash');
    const result = engine?.createRound?.({
      session: {} as IGameSession,
      bet: {} as IBetRequest,
      config: {},
      rng: {} as never,
      fairness: { serverSeedHash: 'h', clientSeed: 'c', nonce: 1 },
    });
    expect(result?.win).toBe(false);
  });
});
