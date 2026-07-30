'use client';

/**
 * Game registry (Phase 2.3B).
 *
 * The single, declarative list of games the runtime hosts. Each entry pairs a
 * pure engine (game rules) with a descriptor (capabilities + limits + rewards).
 * The runtime composition root (`runtime/index.ts`) iterates this list and
 * registers every entry — so **adding a future game is a change HERE only**, never
 * a change to the frozen runtime core (STEP 6 / STEP 8).
 *
 * Engines are pure `RuntimeGameEngine`s: input + provably-fair RNG → result. They
 * hold no wallet, history, session, or IO — the runtime owns all of that.
 */
import type { RuntimeGameEngine } from '@/runtime/engine-registry';
import { CRASH_CONFIG, CrashEngine } from '@/runtime/engines/crash-engine';
import type { GameRegistration } from '@/runtime/game-runtime';

import { AndarBaharEngine } from './cards/andar-bahar-engine';
import { BaccaratEngine } from './cards/baccarat-engine';
import { BlackjackEngine } from './cards/blackjack-engine';
import { CasinoWarEngine } from './cards/casino-war-engine';
import { DragonTigerEngine } from './cards/dragon-tiger-engine';
import { Lucky7Engine } from './cards/lucky-7-engine';
import { TeenPattiEngine } from './cards/teen-patti-engine';
import { DiceEngine, DICE_CONFIG } from './dice-engine';
import { RouletteEngine } from './roulette-engine';
import { PlinkoEngine, PLINKO_CONFIG } from './plinko-engine';

/** Single-shot reveal games (deal → animate → settle) share these capabilities. */
const REVEAL_CAPS: GameModule['descriptor']['capabilities'] = {
  cashOut: false,
  autoBet: false,
  multiBet: false,
  provablyFair: true,
  realtime: false,
  multiplayer: false,
  liveDealer: false,
  tournament: false,
};

/** A registrable game = its engine + its descriptor. */
export interface GameModule {
  descriptor: GameRegistration;
  engine: RuntimeGameEngine;
}

/**
 * Optional per-game XP rewards, read by the runtime's history bridge. Only games
 * that awarded XP before migration declare it, so behaviour is preserved exactly
 * (crash/dice/roulette awarded none; plinko/slots awarded the legacy 40/12).
 */
const LEGACY_XP = { winXp: 40, lossXp: 12 } as const;

export const GAME_MODULES: GameModule[] = [
  {
    engine: new CrashEngine(),
    descriptor: {
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
    },
  },
  {
    engine: new DiceEngine(),
    descriptor: {
      gameId: 'dice',
      name: 'Dice',
      engineKey: 'dice',
      category: 'dice',
      capabilities: {
        cashOut: false,
        autoBet: true,
        multiBet: false,
        provablyFair: true,
        realtime: false,
        multiplayer: false,
        liveDealer: false,
        tournament: false,
      },
      // Dice awarded no XP before migration → no `rewards` key.
      config: { ...DICE_CONFIG, minBet: 1, maxBet: 1_000_000 },
    },
  },
  {
    engine: new RouletteEngine(),
    descriptor: {
      gameId: 'roulette',
      name: 'Roulette',
      engineKey: 'roulette',
      category: 'roulette',
      capabilities: {
        cashOut: false,
        autoBet: false,
        multiBet: true,
        provablyFair: true,
        realtime: false,
        multiplayer: false,
        liveDealer: false,
        tournament: false,
      },
      // Roulette awarded no XP before migration → no `rewards` key.
      config: { minBet: 1, maxBet: 1_000_000 },
    },
  },
  {
    engine: new PlinkoEngine(),
    descriptor: {
      gameId: 'plinko',
      // Lowercase to preserve the exact legacy bet-ledger label (was `game: 'plinko'`).
      name: 'plinko',
      engineKey: 'plinko',
      category: 'arcade',
      capabilities: {
        cashOut: false,
        autoBet: true,
        multiBet: false,
        provablyFair: true,
        realtime: false,
        multiplayer: false,
        liveDealer: false,
        tournament: false,
      },
      config: { ...PLINKO_CONFIG, minBet: 1, maxBet: 1_000_000, rewards: LEGACY_XP },
    },
  },
  {
    engine: new DragonTigerEngine(),
    descriptor: {
      gameId: 'dragon-tiger',
      // Lowercase to preserve the exact legacy bet-ledger + stats key (was `game: SLUG`).
      name: 'dragon-tiger',
      engineKey: 'dragon-tiger',
      category: 'card',
      capabilities: REVEAL_CAPS,
      config: { minBet: 1, maxBet: 1_000_000, rewards: LEGACY_XP },
    },
  },
  {
    engine: new AndarBaharEngine(),
    descriptor: {
      gameId: 'andar-bahar',
      name: 'andar-bahar',
      engineKey: 'andar-bahar',
      category: 'card',
      capabilities: REVEAL_CAPS,
      config: { minBet: 1, maxBet: 1_000_000, rewards: LEGACY_XP },
    },
  },
  {
    engine: new Lucky7Engine(),
    descriptor: {
      gameId: 'lucky-7',
      name: 'lucky-7',
      engineKey: 'lucky-7',
      category: 'card',
      capabilities: REVEAL_CAPS,
      config: { minBet: 1, maxBet: 1_000_000, rewards: LEGACY_XP },
    },
  },
  {
    engine: new BaccaratEngine(),
    descriptor: {
      gameId: 'baccarat',
      name: 'baccarat',
      engineKey: 'baccarat',
      category: 'card',
      capabilities: REVEAL_CAPS,
      config: { minBet: 1, maxBet: 1_000_000, rewards: LEGACY_XP },
    },
  },
  {
    engine: new TeenPattiEngine(),
    descriptor: {
      gameId: 'teen-patti',
      name: 'teen-patti',
      engineKey: 'teen-patti',
      category: 'card',
      capabilities: REVEAL_CAPS,
      config: { minBet: 1, maxBet: 1_000_000, rewards: LEGACY_XP },
    },
  },
  {
    engine: new BlackjackEngine(),
    descriptor: {
      gameId: 'blackjack',
      name: 'blackjack',
      engineKey: 'blackjack',
      category: 'card',
      capabilities: { ...REVEAL_CAPS },
      config: { minBet: 1, maxBet: 1_000_000, rewards: LEGACY_XP },
    },
  },
  {
    engine: new CasinoWarEngine(),
    descriptor: {
      gameId: 'casino-war',
      name: 'casino-war',
      engineKey: 'casino-war',
      category: 'card',
      capabilities: { ...REVEAL_CAPS },
      config: { minBet: 1, maxBet: 1_000_000, rewards: LEGACY_XP },
    },
  },
];
