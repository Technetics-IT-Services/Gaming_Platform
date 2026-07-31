/**
 * Sic Bo — shared types (Game Expansion v2.0, Sprint 3).
 *
 * A new Runtime-compatible table game (single-shot `createRound`, multiple simultaneous
 * bets). It plugs into the FROZEN GameRuntime and moves money only through the frozen
 * flexible settlement → ledger. No platform/runtime/wallet/ledger change.
 */

export enum BetType {
  Small = 'small', // total 4–10, loses on any triple
  Big = 'big', // total 11–17, loses on any triple
  Odd = 'odd', // odd total, loses on any triple
  Even = 'even', // even total, loses on any triple
  Single = 'single', // a number 1–6 appears (tiered by count)
  Double = 'double', // a number appears ≥ 2 times
  Triple = 'triple', // a specific triple (all three = value)
  AnyTriple = 'any_triple', // any triple
  Combo2 = 'combo2', // two specific different numbers both appear
  Combo3 = 'combo3', // three specific different numbers all appear
  Total = 'total', // exact three-dice total 4–17
}

export type Dice = [number, number, number];

/** A bet definition (no amount). `value` shape depends on the type. */
export interface Bet {
  type: BetType;
  /** Single/Double/Triple: 1–6. Total: 4–17. Combo2: [a,b]. Combo3: [a,b,c]. */
  value?: number | number[];
}

/** A placed bet = a bet + a chip amount (integer minor units). */
export interface PlacedBet extends Bet {
  amount: number;
}

/** Per-bet resolution result for a round. */
export interface BetResult extends PlacedBet {
  won: boolean;
  /** Total return for this bet (stake + winnings), 0 on a loss. */
  payout: number;
  /** The "to 1" odds paid (presentation). */
  odds: number;
}

export interface SicBoState {
  dice: Dice;
  total: number;
  isTriple: boolean;
  results: BetResult[];
  totalStake: number;
  totalPayout: number;
}

/** A verifiable record of a round (history + provably-fair panel). */
export interface SicBoRecord {
  dice: Dice;
  bets: PlacedBet[];
  winningBets: BetResult[];
  totalStake: number;
  totalPayout: number;
  serverSeed?: string;
  serverSeedHash?: string;
  clientSeed: string;
  nonce: number;
}
