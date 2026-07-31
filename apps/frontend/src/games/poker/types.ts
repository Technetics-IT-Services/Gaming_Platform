/**
 * Texas Hold'em Poker — shared types (Game Expansion v2.0, Sprint 5).
 *
 * A new Runtime-compatible multiplayer game built on a reusable Poker Table Engine.
 * The table engine is a PURE coordinator (seats, dealing, betting, side pots,
 * showdown) that owns NO money; each seat's net result for a hand settles through the
 * FROZEN runtime via the single-shot engine (stake = chips contributed, settlement
 * payout = chips won). Chips are conserved, so a hand nets zero through the ledger.
 */
import type { Card } from '@/lib/deck';

/** Hand-ranking categories (higher beats lower). */
export enum HandCategory {
  HighCard = 1,
  Pair = 2,
  TwoPair = 3,
  ThreeOfAKind = 4,
  Straight = 5,
  Flush = 6,
  FullHouse = 7,
  FourOfAKind = 8,
  StraightFlush = 9,
  RoyalFlush = 10,
}

/** The best 5-card hand made from a player's 7 cards. */
export interface PokerHand {
  category: HandCategory;
  name: string;
  /** Tiebreak ranks, high → low (compared lexicographically within a category). */
  ranks: number[];
  /** The 5 cards forming the hand. */
  cards: Card[];
}

/** A player at the table. */
export interface PokerPlayer {
  playerId: string;
  seat: number; // 0-based seat index
  stack: number; // chips in front of the player
  sittingOut?: boolean;
  disconnected?: boolean;
}

/** Betting actions a player may take. */
export enum PokerActionType {
  Check = 'check',
  Call = 'call',
  Bet = 'bet',
  Raise = 'raise',
  Fold = 'fold',
  AllIn = 'all-in',
}

export interface PokerAction {
  seat: number;
  type: PokerActionType;
  /** For bet/raise: the total this player wants committed on the current street. */
  amount?: number;
}

/** The streets of a Texas Hold'em hand. */
export enum Street {
  PreFlop = 'pre-flop',
  Flop = 'flop',
  Turn = 'turn',
  River = 'river',
  Showdown = 'showdown',
  Complete = 'complete',
}

/** A (main or side) pot and the seats eligible to win it. */
export interface Pot {
  amount: number;
  /** Seats eligible to contest this pot (not folded, contributed to this layer). */
  eligible: number[];
  /** Populated at showdown: seats that won this pot (split → more than one). */
  winners?: number[];
}

/** Table configuration preset. */
export interface PokerConfig {
  maxSeats: number; // 2–9
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  /** House rake as a fraction of each pot (0 = no rake; default demo). */
  rake?: number;
  /** Reusable tournament extension points (hooks only; not implemented). */
  tournament?: TournamentHooks;
  minBet?: number;
  maxBet?: number;
  rewards?: { winXp: number; lossXp: number };
}

/** Per-seat outcome of a settled hand (drives the frozen per-seat settlement). */
export interface SeatResult {
  seat: number;
  playerId: string;
  hole: Card[];
  /** Chips this seat put into the pot(s) this hand. */
  contributed: number;
  /** Chips this seat won back from the pot(s). */
  won: number;
  folded: boolean;
  allIn: boolean;
  hand?: PokerHand;
}

/** The complete, verifiable result of one hand. */
export interface HandResult {
  handId: string;
  buttonSeat: number;
  board: Card[];
  seats: SeatResult[];
  pots: Pot[];
  /** The provably-fair shuffled deck (for replay/verification). */
  deck: Card[];
  rake: number;
  fairness: HandFairness;
}

/** The seeds a hand was dealt from (provably fair). */
export interface HandFairness {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}

/**
 * Reusable tournament extension points (STEP 7) — hooks ONLY. Real tournament
 * orchestration is intentionally NOT implemented; a table simply carries these so a
 * future tournament layer can drive blinds, balancing, elimination and leaderboards
 * without changing the table engine.
 */
export interface TournamentHooks {
  tournamentId?: string;
  /** Blind levels escalated over time; the table reads the current level. */
  blindSchedule?: BlindLevel[];
  /** Called when a player busts (stack → 0) so a tournament can eliminate them. */
  onEliminate?: (playerId: string, place: number) => void;
  /** Called after each hand so a tournament can rebalance/break tables. */
  onRebalance?: (seatsRemaining: number) => void;
  /** Called with each settled hand so a leaderboard can integrate chip counts. */
  onLeaderboard?: (standings: Array<{ playerId: string; stack: number }>) => void;
}

export interface BlindLevel {
  level: number;
  smallBlind: number;
  bigBlind: number;
  ante?: number;
  /** Duration in ms this level lasts (a tournament timer honours it). */
  durationMs?: number;
}

/** The per-seat settlement payload handed to the frozen single-shot engine. */
export interface SeatSettlement {
  handId: string;
  seat: number;
  playerId: string;
  contributed: number;
  won: number;
  handName?: string;
  hole?: Card[];
  board?: Card[];
}

/** A verifiable history record for one settled seat. */
export interface PokerRecord {
  handId: string;
  seat: number;
  hole: Card[];
  board: Card[];
  handName?: string;
  contributed: number;
  won: number;
  net: number;
  serverSeed?: string;
  serverSeedHash?: string;
  clientSeed: string;
  nonce: number;
}
