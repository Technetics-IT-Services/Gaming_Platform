/**
 * Hi-Lo — shared types (Game Expansion v2.0, Sprint 2).
 *
 * A new Runtime-compatible game using the FROZEN interactive engine contract
 * (`start`/`step` → flexible settlement). No platform, runtime, wallet, ledger or
 * settlement code is modified. Progressive multiplier with continue / cash-out.
 */

export type HiLoDirection = 'higher' | 'lower' | 'equal';

export interface HiLoConfig {
  /** Allow the (rare, high-multiplier) "equal" prediction. */
  allowEqual: boolean;
  /** House edge applied to every step's fair multiplier (RTP = 1 − edge). */
  houseEdge: number;
  minBet?: number;
  maxBet?: number;
  rewards?: { winXp: number; lossXp: number };
}

export const HILO_DEFAULT: HiLoConfig = { allowEqual: true, houseEdge: 0.035 };

/** A card is a deck id 0..51 → rank (2..14, Ace high) + suit (0..3). */
export interface HiLoCard {
  id: number;
  rank: number;
  suit: number;
}

/** Per-step multiplier offered for each legal prediction at the current card. */
export interface HiLoOdds {
  higher?: number;
  lower?: number;
  equal?: number;
}

export interface HiLoState {
  current: HiLoCard;
  /** Running multiplier (product of correct-step multipliers). */
  multiplier: number;
  /** Remaining deck ids (not yet drawn). */
  remaining: number[];
  /** Cards revealed so far, oldest → newest. */
  revealed: HiLoCard[];
  /** Draw counter (also the per-draw provably-fair sub-nonce). */
  draws: number;
  allowEqual: boolean;
  edge: number;
  /** The odds offered for the NEXT prediction from `current`. */
  odds: HiLoOdds;
  /** Set when the round ends (bust or cashout). */
  busted?: boolean;
  cashed?: boolean;
  lastPrediction?: HiLoDirection;
  lastCorrect?: boolean;
}

/** A verifiable record of a completed Hi-Lo round (history + PF panel). */
export interface HiLoRecord {
  cards: HiLoCard[];
  predictions: HiLoDirection[];
  multiplier: number;
  cashed: boolean;
  serverSeed?: string;
  serverSeedHash?: string;
  clientSeed: string;
  nonce: number;
}
