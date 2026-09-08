import { SeededRng } from '@gaming-platform/game-sdk';

/**
 * Server-authoritative Mines engine (Phase 2C.6).
 *
 * A FAITHFUL PORT of the existing frontend grid-reveal ("Mines") math
 * (`apps/frontend/src/games/instant/grid-reveal-engine.ts`): identical multiplier progression
 * (`0.99 · Π (tiles-i)/(tiles-mines-i)`, 1% house edge, rounded to 2dp) and identical fair mine
 * placement (a fairness-seeded shuffle of tile indices). Moved server-side so the board, multiplier
 * and payout are authoritative — the client never sees the mine positions until the round ends. The
 * board is DETERMINISTIC from the round seed, so interactive state needs only {seed, tiles, mines,
 * revealed[]} and can be reconstructed on every action (restart-safe; no in-memory engine state).
 */

export const MINES_TILES = 25; // 5×5
export const MINES_MIN = 1;
export const MINES_MAX = 24;

/** Fair multiplier after `k` safe reveals (1% house edge). Identical to the frontend engine. */
export function gridMultiplier(tiles: number, mines: number, k: number): number {
  let m = 0.99;
  for (let i = 0; i < k; i += 1) m *= (tiles - i) / (tiles - mines - i);
  return Math.round(m * 100) / 100;
}

/** The authoritative mine positions for a round — a seeded shuffle of tile indices (sorted for display). */
export function mineBoard(tiles: number, mines: number, seed: string): number[] {
  const indices = Array.from({ length: tiles }, (_, i) => i);
  return new SeededRng(seed)
    .shuffle(indices)
    .slice(0, mines)
    .sort((a, b) => a - b);
}

export interface MinesRevealOutcome {
  /** True when the revealed tile was a mine (round lost). */
  hit: boolean;
  /** All revealed safe tiles after this action. */
  revealed: number[];
  /** Current multiplier for the safe reveals so far. */
  multiplier: number;
  /** True when every safe tile has been revealed (round auto-completes at max). */
  cleared: boolean;
  /** The full mine board — only returned once the round is over. */
  board?: number[];
}

/**
 * Apply a reveal to a round. Deterministic: given (seed, tiles, mines, priorReveals, index) the
 * outcome is fixed. `priorReveals` is the list of already-revealed safe tiles.
 */
export function revealTile(
  seed: string,
  tiles: number,
  mines: number,
  priorReveals: number[],
  index: number,
): MinesRevealOutcome {
  if (!Number.isInteger(index) || index < 0 || index >= tiles) throw new Error('Invalid tile');
  if (priorReveals.includes(index)) throw new Error('Tile already revealed');
  const board = mineBoard(tiles, mines, seed);
  if (board.includes(index)) {
    return { hit: true, revealed: priorReveals, multiplier: 0, cleared: false, board };
  }
  const revealed = [...priorReveals, index];
  const cleared = revealed.length >= tiles - mines;
  const multiplier = gridMultiplier(tiles, mines, revealed.length);
  return { hit: false, revealed, multiplier, cleared, board: cleared ? board : undefined };
}

/** The current cash-out multiplier for a set of safe reveals (0 if none revealed yet). */
export function cashoutMultiplier(tiles: number, mines: number, revealCount: number): number {
  return revealCount <= 0 ? 0 : gridMultiplier(tiles, mines, revealCount);
}
