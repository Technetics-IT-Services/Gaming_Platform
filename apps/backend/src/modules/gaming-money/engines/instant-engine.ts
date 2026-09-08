import { SeededRng } from '@gaming-platform/game-sdk';

/**
 * Server-authoritative instant-games engine (Phase 2C.7 — single-shot).
 *
 * FAITHFUL PORTS of the existing frontend instant engines
 * (`apps/frontend/src/games/instant/{limbo,coin-flip,wheel}-engine.ts`) — identical multiplier
 * formula, identical coin threshold, identical wheel segment tables and landing-index logic — moved
 * server-side so the real-money outcome is authoritative (the client can never determine the
 * result/multiplier/payout).
 *
 * RNG SOURCE (documented, not byte-identical): the frontend's runtime provably-fair provider is the
 * DEMO `xmur3` mix (`apps/frontend/src/runtime/providers/provably-fair.ts`), explicitly a non-crypto
 * placeholder ("the real provider uses the backend HMAC-SHA256 engine"). The authoritative money path
 * uses the platform's real `ProvablyFairService` (HMAC-SHA256) → a per-round seed → `SeededRng` float.
 * The GAME MATH (the float→outcome mapping below) is identical to the frontend; only the float SOURCE
 * differs — the same situation documented for Plinko in Phase 2C.6. Determinism/verifiability hold:
 * re-derive the seed → replay the float → same outcome.
 */

export type InstantGameKey = 'limbo' | 'coin-flip' | 'wheel';
export const INSTANT_GAMES: readonly InstantGameKey[] = ['limbo', 'coin-flip', 'wheel'] as const;

/** Shared stake band for instant games (matches plinko/mines). */
export const INSTANT_LIMITS = { min: 1, max: 10000 } as const;

/* ------------------------------------- Limbo -------------------------------------- */

export interface LimboConfig {
  houseEdgePct: number;
  maxMultiplier: number;
}
export const LIMBO_CONFIG: LimboConfig = { houseEdgePct: 1, maxMultiplier: 1_000_000 };
export const LIMBO_MIN_TARGET = 1.01;

/** The generated multiplier for a fairness float — IDENTICAL to the frontend `limboMultiplier`. */
export function limboMultiplier(r: number, config: LimboConfig = LIMBO_CONFIG): number {
  const edge = 1 - config.houseEdgePct / 100;
  const raw = Math.floor((edge / Math.max(1e-9, 1 - r)) * 100) / 100;
  return Math.min(config.maxMultiplier, Math.max(1, raw));
}

/** Limbo outcome from a float: win if the generated multiplier ≥ the player's target; pays the target. */
export function limboOutcome(r: number, target: number, config: LimboConfig = LIMBO_CONFIG): InstantResult {
  const generated = limboMultiplier(r, config);
  const win = generated >= target;
  return { win, multiplier: win ? target : 0, result: { kind: 'limbo', generated, target } };
}

/* ------------------------------------ Coin Flip ----------------------------------- */

export type CoinSide = 'heads' | 'tails';
export const COIN_FLIP_PAYOUT = 1.98;

/** Coin outcome from a float — IDENTICAL threshold to the frontend (r < 0.5 → heads), pays 1.98×. */
export function coinOutcome(r: number, pick: CoinSide): InstantResult {
  const outcome: CoinSide = r < 0.5 ? 'heads' : 'tails';
  const win = outcome === pick;
  return { win, multiplier: win ? COIN_FLIP_PAYOUT : 0, result: { kind: 'coin-flip', outcome, pick } };
}

/* -------------------------------------- Wheel ------------------------------------- */

export type WheelRisk = 'low' | 'medium' | 'high';
export const WHEEL_RISKS: readonly WheelRisk[] = ['low', 'medium', 'high'] as const;

/** Segment multiplier arrays — IDENTICAL to the frontend (each mean ≈ 0.96, a ~4% house edge). */
export const WHEEL_SEGMENTS: Record<WheelRisk, number[]> = {
  low: [1.2, 1.2, 0, 1.2, 1.2, 1.2, 1.2, 0, 1.2, 1.2, 1.2, 0, 1.2, 1.2, 1.2, 1.2, 0, 1.2, 1.2, 1.2],
  medium: [3, 0, 1.8, 0, 3, 0, 1.8, 0, 3, 0, 1.8, 0, 3, 0, 1.8, 0, 0, 0, 0, 0],
  high: [10, 0, 0, 0, 0, 5, 0, 0, 0, 0, 4.2, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

/** Wheel outcome from a float — IDENTICAL landing-index logic; pays the landed segment (0 = lose). */
export function wheelOutcome(r: number, risk: WheelRisk): InstantResult {
  const segments = WHEEL_SEGMENTS[risk] ?? WHEEL_SEGMENTS.low;
  const index = Math.min(segments.length - 1, Math.floor(r * segments.length));
  const multiplier = segments[index]!;
  const win = multiplier >= 1;
  return { win, multiplier: win ? multiplier : 0, result: { kind: 'wheel', risk, index, segment: multiplier } };
}

/* ----------------------------------- Dispatcher ----------------------------------- */

export interface InstantResult {
  win: boolean;
  /** Payout multiplier (0 on a loss). payout = stake × multiplier. */
  multiplier: number;
  /** Authoritative result payload persisted on the round. */
  result: Record<string, unknown>;
}

/** A normalized, validated instant selection + a short betType label for the round. */
export interface InstantSelection {
  gameKey: InstantGameKey;
  /** Player's choice: `{ target }` (limbo) | `{ side }` (coin-flip) | `{ risk }` (wheel). */
  target?: number;
  side?: CoinSide;
  risk?: WheelRisk;
  betType: string;
}

/**
 * Validate + normalize a raw client selection. Throws `Error` on invalid input (the bridge maps this
 * to a 400 BEFORE any reservation). The client sends ONLY its choice — never result/multiplier/payout.
 */
export function parseInstantSelection(gameKey: string, raw: Record<string, unknown>): InstantSelection {
  if (!INSTANT_GAMES.includes(gameKey as InstantGameKey)) {
    throw new Error(`instant: unsupported game "${gameKey}" (allowed: ${INSTANT_GAMES.join(', ')})`);
  }
  const key = gameKey as InstantGameKey;
  if (key === 'limbo') {
    const target = Number(raw.target);
    if (!Number.isFinite(target)) throw new Error('limbo: target must be a number');
    if (target < LIMBO_MIN_TARGET) throw new Error(`limbo: target must be ≥ ${LIMBO_MIN_TARGET}`);
    if (target > LIMBO_CONFIG.maxMultiplier) throw new Error(`limbo: target must be ≤ ${LIMBO_CONFIG.maxMultiplier}`);
    const norm = Math.floor(target * 100) / 100;
    return { gameKey: key, target: norm, betType: `limbo:${norm.toFixed(2)}` };
  }
  if (key === 'coin-flip') {
    const side = String(raw.side) as CoinSide;
    if (side !== 'heads' && side !== 'tails') throw new Error("coin-flip: side must be 'heads' or 'tails'");
    return { gameKey: key, side, betType: `coin-flip:${side}` };
  }
  // wheel
  const risk = String(raw.risk) as WheelRisk;
  if (!WHEEL_RISKS.includes(risk)) throw new Error(`wheel: risk must be one of ${WHEEL_RISKS.join(', ')}`);
  return { gameKey: key, risk, betType: `wheel:${risk}` };
}

/**
 * Authoritatively play one instant round. `seed` is the round's provably-fair seed (derived
 * server-side). Deterministic + verifiable: re-derive the seed → replay the float → same outcome.
 */
export function playInstant(selection: InstantSelection, seed: string): InstantResult {
  const r = new SeededRng(seed).next();
  switch (selection.gameKey) {
    case 'limbo':
      return limboOutcome(r, selection.target!);
    case 'coin-flip':
      return coinOutcome(r, selection.side!);
    case 'wheel':
      return wheelOutcome(r, selection.risk!);
    default:
      throw new Error(`instant: unsupported game "${selection.gameKey}"`);
  }
}

/** Public config for a game (for the `GET config` endpoint). */
export function instantConfig(gameKey: InstantGameKey) {
  const base = { game: gameKey, limits: INSTANT_LIMITS };
  if (gameKey === 'limbo') return { ...base, minTarget: LIMBO_MIN_TARGET, maxMultiplier: LIMBO_CONFIG.maxMultiplier, houseEdgePct: LIMBO_CONFIG.houseEdgePct };
  if (gameKey === 'coin-flip') return { ...base, sides: ['heads', 'tails'] as CoinSide[], payout: COIN_FLIP_PAYOUT };
  return { ...base, risks: WHEEL_RISKS, segments: WHEEL_SEGMENTS };
}
