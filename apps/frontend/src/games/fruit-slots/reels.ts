/**
 * Fruit Slots — reel strips + paylines (Sprint 2).
 *
 * Weighted reel strips define the symbol frequencies (and thus the hit rate); the 20
 * fixed paylines define the winning patterns over the 5×3 window. Data only — no
 * randomness here (the provably-fair stream picks the stops).
 */
import { PAYLINES, ROWS, Symbol } from './types';

/** Symbol counts per reel strip (same composition on all 5 reels). */
const STRIP_WEIGHTS: [Symbol, number][] = [
  [Symbol.Cherry, 8],
  [Symbol.Lemon, 7],
  [Symbol.Orange, 6],
  [Symbol.Plum, 5],
  [Symbol.Bell, 4],
  [Symbol.Seven, 3],
  [Symbol.Wild, 2],
  [Symbol.Scatter, 1],
];

function buildStrip(): Symbol[] {
  const strip: Symbol[] = [];
  for (const [sym, n] of STRIP_WEIGHTS) for (let i = 0; i < n; i += 1) strip.push(sym);
  return strip;
}

/** Five reel strips (length 36 each). */
export function buildReels(): Symbol[][] {
  return Array.from({ length: 5 }, () => buildStrip());
}

export const STRIP_LENGTH = buildStrip().length; // 36

/** The 3 visible symbols of a reel given its stop index (wraps the strip). */
export function windowFor(strip: Symbol[], stop: number): Symbol[] {
  const L = strip.length;
  return Array.from({ length: ROWS }, (_, r) => strip[(stop + r) % L]!);
}

/**
 * 20 fixed paylines over a 3-row window. Each entry is the row index (0=top, 2=bottom)
 * on each of the 5 reels — the classic 20-line NetEnt-style set.
 */
export const LINES: number[][] = [
  [1, 1, 1, 1, 1], // 1  middle
  [0, 0, 0, 0, 0], // 2  top
  [2, 2, 2, 2, 2], // 3  bottom
  [0, 1, 2, 1, 0], // 4  V
  [2, 1, 0, 1, 2], // 5  ^
  [0, 0, 1, 2, 2], // 6
  [2, 2, 1, 0, 0], // 7
  [1, 0, 0, 0, 1], // 8
  [1, 2, 2, 2, 1], // 9
  [1, 0, 1, 2, 1], // 10
  [1, 2, 1, 0, 1], // 11
  [0, 1, 1, 1, 0], // 12
  [2, 1, 1, 1, 2], // 13
  [0, 0, 1, 0, 0], // 14
  [2, 2, 1, 2, 2], // 15
  [1, 1, 0, 1, 1], // 16
  [1, 1, 2, 1, 1], // 17
  [0, 1, 0, 1, 0], // 18
  [2, 1, 2, 1, 2], // 19
  [0, 2, 0, 2, 0], // 20
];

if (LINES.length !== PAYLINES) throw new Error('fruit-slots: payline count mismatch');
