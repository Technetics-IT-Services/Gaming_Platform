/**
 * Plinko game — shared types (Game Expansion v2.0, Sprint 1).
 *
 * A new Runtime-compatible game. It plugs into the FROZEN GameRuntime via the
 * existing `RuntimeGameEngine` contract; it changes no platform, runtime, wallet,
 * ledger or settlement code. Money moves only through the frozen settlement path.
 */

export type PlinkoRisk = 'low' | 'medium' | 'high';
export const PLINKO_RISKS: readonly PlinkoRisk[] = ['low', 'medium', 'high'] as const;
export const PLINKO_ROWS: readonly number[] = [8, 10, 12, 14, 16] as const;

/** Engine config (the game descriptor's `config`). Rows/risk are the board shape. */
export interface PlinkoConfig {
  rows: number;
  risk: PlinkoRisk;
  minBet?: number;
  maxBet?: number;
  rewards?: { winXp: number; lossXp: number };
}

/** What the player picks per bet (overrides the config for that drop). */
export interface PlinkoPick {
  rows?: number;
  risk?: PlinkoRisk;
}

/** The engine's per-round state (drives animation + history + verification). */
export interface PlinkoState {
  rows: number;
  risk: PlinkoRisk;
  /** Per-row step: -1 (left) or +1 (right) — the ball's path. */
  dirs: number[];
  /** Landing bin index (0..rows). */
  bin: number;
  /** Landed multiplier (may be < 1 — a partial return). */
  mult: number;
  /** The full multiplier row for this board (for rendering the slots). */
  table: number[];
}

/** A verifiable record of one drop (history + provably-fair panel). */
export interface PlinkoDropRecord {
  rows: number;
  risk: PlinkoRisk;
  bin: number;
  mult: number;
  serverSeed?: string;
  serverSeedHash?: string;
  clientSeed: string;
  nonce: number;
  dirs: number[];
}
