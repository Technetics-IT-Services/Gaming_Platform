/**
 * Fruit Slots — shared types (Sprint 2).
 *
 * A classic 5-reel × 3-row, 20-payline fruit slot on the FROZEN GameRuntime (single-
 * shot `createRound` → flexible settlement). No platform/runtime/ledger changes.
 */

export enum Symbol {
  Cherry = 'cherry',
  Lemon = 'lemon',
  Orange = 'orange',
  Plum = 'plum',
  Bell = 'bell',
  Seven = 'seven',
  Wild = 'wild',
  Scatter = 'scatter',
}

export const REELS = 5;
export const ROWS = 3;
export const PAYLINES = 20;

/** Paytable: multiplier (× line bet) for 3 / 4 / 5 of a kind, per symbol. */
export type Paytable = Partial<Record<Symbol, { 3: number; 4: number; 5: number }>>;

/** Scatter pays × TOTAL bet for 3 / 4 / 5 anywhere, and awards free spins. */
export interface ScatterConfig {
  pays: { 3: number; 4: number; 5: number };
  freeSpins: { 3: number; 4: number; 5: number };
  /** Win multiplier applied during the free-spin round. */
  freeSpinMultiplier: number;
}

export interface SlotConfig {
  reels: Symbol[][];
  paytable: Paytable;
  scatter: ScatterConfig;
  minBet?: number;
  maxBet?: number;
  rewards?: { winXp: number; lossXp: number };
}

export interface LineWin {
  line: number;
  symbol: Symbol;
  count: number;
  /** Multiplier × line bet. */
  mult: number;
}

export interface SpinResult {
  /** Reel stop indices (provably-fair). */
  stops: number[];
  /** The 3×5 visible symbol matrix (row-major: matrix[row][reel]). */
  matrix: Symbol[][];
  lineWins: LineWin[];
  scatterCount: number;
  scatterMult: number;
  freeSpinsAwarded: number;
  /** Total win in line-bet units (base game). */
  baseUnits: number;
  /** Total win from the resolved free-spin round, in line-bet units. */
  freeUnits: number;
  /** baseUnits + freeUnits. */
  totalUnits: number;
}

export interface SlotRecord {
  stops: number[];
  matrix: Symbol[][];
  lineWins: LineWin[];
  freeSpins: number;
  totalUnits: number;
  win: number;
  serverSeed?: string;
  serverSeedHash?: string;
  clientSeed: string;
  nonce: number;
}
