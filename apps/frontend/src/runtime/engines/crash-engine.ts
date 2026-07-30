'use client';

import type {
  IBetRequest,
  IFairnessProof,
  IGameResult,
  IGameSession,
  IProvablyFairProvider,
} from '@gaming-platform/types';

import type { RuntimeGameEngine } from '../engine-registry';

/** Crash engine configuration (a pure preset). */
export interface CrashConfig {
  /** House edge as a percentage, e.g. 1 → 0.99 factor. */
  houseEdgePct: number;
  /** Multiplier cap. */
  maxMultiplier: number;
}

export const CRASH_CONFIG: CrashConfig = { houseEdgePct: 1, maxMultiplier: 120 };

/** The final state a crash round resolves to. */
export interface CrashState {
  /** The multiplier at which the rocket busts (fairness-derived). */
  crashPoint: number;
}

/**
 * Crash engine (Phase 2.2 reference migration).
 *
 * PURE: given the round's fairness it derives the bust multiplier and nothing
 * else — no wallet, no history, no timers, no animation. This replaces the old
 * in-component `mulberry32` with a provably-fair, reproducible outcome; the
 * distribution formula is preserved from the previous game so play feels
 * identical. The runtime animates toward `crashPoint` and settles via providers.
 */
export class CrashEngine implements RuntimeGameEngine<CrashConfig, number, CrashState> {
  readonly engineKey = 'crash';

  createRound(input: {
    session: IGameSession;
    bet: IBetRequest<number>;
    config: CrashConfig;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
  }): IGameResult<CrashState> {
    const { session, config, rng, fairness } = input;
    const serverSeed = fairness.serverSeed ?? '';
    const r = rng.nextFloat({ serverSeed, clientSeed: fairness.clientSeed, nonce: fairness.nonce });

    // Preserved distribution: crashPoint = clamp(1, floor(edge / (1 - r) * 100) / 100, max).
    const edge = 1 - config.houseEdgePct / 100;
    const raw = Math.floor((edge / Math.max(1e-9, 1 - r)) * 100) / 100;
    const crashPoint = Math.min(config.maxMultiplier, Math.max(1, raw));

    return {
      roundId: '', // assigned by the runtime
      gameId: session.gameId,
      state: { crashPoint },
      multiplier: 0, // resolved at cash-out / bust by the settlement provider
      win: false,
      fairness,
      computedAt: new Date().toISOString(),
    };
  }
}
