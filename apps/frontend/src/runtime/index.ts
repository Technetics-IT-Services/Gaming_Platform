'use client';

/**
 * Runtime public surface (Phase 2.2).
 *
 * `getGameRuntime()` returns the single, lazily-constructed, demo-active runtime
 * with its providers wired and the reference game (Crash) registered. A module
 * singleton (one configured instance) — not singleton abuse: the runtime is
 * stateless per call and holds only session bookkeeping.
 */
import { CRASH_CONFIG, CrashEngine } from './engines/crash-engine';
import { GameRuntime, type GameRegistration, type PlayerContext } from './game-runtime';
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

/** Reference game registration — descriptor + engine preset + bet limits. */
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
  config: { ...CRASH_CONFIG, minBet: 1, maxBet: 1_000_000 },
};

let instance: GameRuntime | null = null;

export function getGameRuntime(): GameRuntime {
  if (!instance) {
    instance = new GameRuntime(createProviderSet(), DEMO_PLAYER);
    instance.registerEngine(new CrashEngine());
    instance.registerGame(CRASH_GAME);
  }
  return instance;
}
