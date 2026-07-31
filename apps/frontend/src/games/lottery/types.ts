/**
 * Number Lottery — shared types (Game Expansion v2.0, Sprint 4).
 *
 * A new Runtime-compatible game built on a reusable Scheduled Draw Engine. It plugs
 * into the FROZEN GameRuntime via the existing interactive `start`/`step` contract
 * (start = buy ticket → debit; the scheduled draw fires step → settle) and moves money
 * only through the frozen flexible settlement → ledger. No platform/runtime change.
 */

/** Prize tiers for the default Pick-6 / 1–49 + bonus game. */
export enum PrizeTier {
  Jackpot = '6', // 6 matches
  FivePlusBonus = '5+bonus', // 5 matches + bonus
  Five = '5',
  Four = '4',
  Three = '3',
  Two = '2',
}

/** Prize table: tier → payout multiple of the ticket price. */
export type PrizeTable = Record<PrizeTier, number>;

export interface LotteryConfig {
  /** Numbers a ticket picks. */
  pick: number;
  /** Number range 1..range. */
  range: number;
  /** Main numbers drawn. */
  drawMain: number;
  /** Whether a bonus ball is drawn. */
  bonus: boolean;
  prizeTable: PrizeTable;
  minBet?: number;
  maxBet?: number;
  rewards?: { winXp: number; lossXp: number };
}

/** The player's ticket selection (the interactive `pick`). */
export interface TicketPick {
  /** Manual numbers, or omitted for a quick pick. */
  numbers?: number[];
  quickPick?: boolean;
  drawId?: string;
}

export interface DrawResult {
  main: number[]; // sorted
  bonus: number;
}

export interface LotteryState {
  numbers: number[]; // the ticket's chosen numbers (sorted)
  quickPick: boolean;
  drawId?: string;
  /** Populated once the scheduled draw fires. */
  draw?: DrawResult;
  matches?: number;
  bonusMatch?: boolean;
  tier?: PrizeTier | null;
  prizeMultiplier?: number;
}

/** A verifiable record of a settled ticket (history + provably-fair panel). */
export interface LotteryRecord {
  numbers: number[];
  quickPick: boolean;
  drawId?: string;
  draw?: DrawResult;
  tier: PrizeTier | null;
  prize: number;
  serverSeed?: string;
  serverSeedHash?: string;
  clientSeed: string;
  nonce: number;
}
