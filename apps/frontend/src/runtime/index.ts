'use client';

/**
 * Runtime public surface (Phase 2.2).
 *
 * `getGameRuntime()` returns the single, lazily-constructed, demo-active runtime
 * with its providers wired and the reference game (Crash) registered. A module
 * singleton (one configured instance) — not singleton abuse: the runtime is
 * stateless per call and holds only session bookkeeping.
 */
import { GAME_MODULES } from '@/games/registry';

import { GameRuntime, type PlayerContext } from './game-runtime';
import { createProviderSet } from './providers';

export * from './errors';
export * from './feature-flags';
export * from './event-bus';
export { GameRuntime } from './game-runtime';
export type { GameRegistration, PlayerContext } from './game-runtime';
export { CrashEngine, CRASH_CONFIG } from './engines/crash-engine';
export type { CrashConfig, CrashState } from './engines/crash-engine';
export type { ProviderSet } from './providers';

/** Demo player context (single-player). The demo wallet is not keyed by player. */
const DEMO_PLAYER: PlayerContext = { playerId: 'demo-player', currency: 'INR' };

let instance: GameRuntime | null = null;

/**
 * The single, lazily-constructed, demo-active runtime. Every hosted game is
 * registered from the declarative `GAME_MODULES` registry (Phase 2.3B) — so
 * adding a game is a registry change only, never a runtime change (STEP 8).
 */
export function getGameRuntime(): GameRuntime {
  if (!instance) {
    instance = new GameRuntime(createProviderSet(), DEMO_PLAYER);
    for (const { engine, descriptor } of GAME_MODULES) {
      instance.registerEngine(engine);
      instance.registerGame(descriptor);
    }
  }
  return instance;
}
