/**
 * Reusable Multiplayer Poker Table Engine (Sprint 5, STEP 1 & 2).
 *
 * A PURE, additive coordinator for a Texas Hold'em table: 2–9 seats, join / leave /
 * reconnect, dealer-button rotation, and the full hand flow (blinds → deal → pre-flop →
 * flop → turn → river → showdown → pot distribution → next hand). It owns NO money —
 * it computes each seat's chips contributed and won for a hand; the FROZEN runtime moves
 * the money (see engine.ts). Reusable tournament extension points are exposed but not
 * implemented (STEP 7). Deterministic: the deck is derived from the provably-fair provider.
 */
import type { IFairnessProof, IProvablyFairProvider } from '@gaming-platform/types';

import { deal, shuffleDeck, type Card } from './cards';
import { buildSidePots, distributePots, StreetBetting } from './betting';
import { evaluate7 } from './hand-eval';
import {
  PokerActionType,
  Street,
  type HandResult,
  type PokerConfig,
  type PokerPlayer,
  type SeatResult,
} from './types';

export const POKER_DEFAULT: PokerConfig = {
  maxSeats: 9,
  smallBlind: 1,
  bigBlind: 2,
  minBuyIn: 40,
  maxBuyIn: 400,
  rake: 0,
};

interface HandState {
  handId: string;
  fairness: IFairnessProof;
  deck: Card[];
  seatsInHand: number[]; // clockwise (ascending seat index) participating this hand
  holes: Map<number, Card[]>;
  board: Card[]; // all 5 (flop+turn+river), revealed progressively
  street: Street;
  contributed: Map<number, number>;
  startStacks: Map<number, number>;
  handStacks: Map<number, number>; // live remaining stacks during the hand
  folded: Set<number>;
  allIn: Set<number>;
  betting: StreetBetting;
  result?: HandResult;
}

export class PokerTableEngine {
  readonly config: PokerConfig;
  private readonly players = new Map<number, PokerPlayer>();
  private buttonSeat = -1;
  private handCount = 0;
  private hand: HandState | null = null;

  constructor(config: Partial<PokerConfig> = {}) {
    this.config = { ...POKER_DEFAULT, ...config };
    if (this.config.maxSeats < 2 || this.config.maxSeats > 9) throw new Error('poker: table supports 2–9 seats');
  }

  /* ------------------------------ seat management ------------------------------ */

  /** Seat a player. `seat` optional → first free seat. */
  seatPlayer(input: { playerId: string; stack: number; seat?: number }): PokerPlayer {
    const seat = input.seat ?? this.firstFreeSeat();
    if (seat < 0 || seat >= this.config.maxSeats) throw new Error('poker: invalid seat');
    if (this.players.has(seat)) throw new Error(`poker: seat ${seat} is taken`);
    if (input.stack < this.config.minBuyIn || input.stack > this.config.maxBuyIn) {
      throw new Error(`poker: buy-in must be ${this.config.minBuyIn}–${this.config.maxBuyIn}`);
    }
    const player: PokerPlayer = { playerId: input.playerId, seat, stack: input.stack };
    this.players.set(seat, player);
    return player;
  }

  /** Remove a player from the table (between hands). */
  leave(seat: number): void {
    this.players.delete(seat);
  }

  /** Mark a seated player disconnected (they keep their seat + stack; auto-fold in-hand). */
  disconnect(seat: number): void {
    const p = this.players.get(seat);
    if (p) p.disconnected = true;
  }

  /** Re-seat a disconnected player at the same seat with the same stack. */
  reconnect(seat: number): PokerPlayer {
    const p = this.players.get(seat);
    if (!p) throw new Error(`poker: no player to reconnect at seat ${seat}`);
    p.disconnected = false;
    return p;
  }

  get seats(): PokerPlayer[] {
    return [...this.players.values()].sort((a, b) => a.seat - b.seat);
  }

  get button(): number {
    return this.buttonSeat;
  }

  get hands(): number {
    return this.handCount;
  }

  private firstFreeSeat(): number {
    for (let s = 0; s < this.config.maxSeats; s += 1) if (!this.players.has(s)) return s;
    return -1;
  }

  /* --------------------------------- hand flow --------------------------------- */

  /** Seats eligible to be dealt in: seated, chips > 0, not sitting out. */
  private dealInSeats(): number[] {
    return this.seats.filter((p) => p.stack > 0 && !p.sittingOut).map((p) => p.seat).sort((a, b) => a - b);
  }

  /** Clockwise order of `pool` starting at (or just after) `startSeat`. */
  private clockwise(pool: number[], startSeat: number): number[] {
    const sorted = [...pool].sort((a, b) => a - b);
    let idx = sorted.indexOf(startSeat);
    if (idx < 0) {
      idx = sorted.findIndex((s) => s > startSeat);
      if (idx < 0) idx = 0;
    }
    return [...sorted.slice(idx), ...sorted.slice(0, idx)];
  }

  private nextButton(pool: number[]): number {
    if (this.buttonSeat < 0) return pool[0]!;
    const after = pool.find((s) => s > this.buttonSeat);
    return after ?? pool[0]!;
  }

  /**
   * Start a new hand: rotate the button, shuffle provably-fair, deal, post blinds,
   * open the pre-flop betting round. Requires ≥ 2 deal-in players.
   */
  startHand(rng: IProvablyFairProvider, fairness: IFairnessProof): HandState {
    const pool = this.dealInSeats();
    if (pool.length < 2) throw new Error('poker: need at least 2 players with chips');
    if (this.hand && this.hand.street !== Street.Complete) throw new Error('poker: a hand is already in progress');

    this.buttonSeat = this.nextButton(pool);
    this.handCount += 1;

    const deck = shuffleDeck(rng, fairness);
    const { holes: dealt, board } = deal(deck, pool.length);
    const seatsFromButton = this.clockwise(pool, this.buttonSeat);
    const holes = new Map<number, Card[]>();
    seatsFromButton.forEach((seat, i) => holes.set(seat, dealt[i]!));

    // Blind positions.
    const headsUp = pool.length === 2;
    const sbSeat = headsUp ? seatsFromButton[0]! : seatsFromButton[1]!;
    const bbSeat = headsUp ? seatsFromButton[1]! : seatsFromButton[2]!;
    const blinds = new Map<number, number>([
      [sbSeat, this.config.smallBlind],
      [bbSeat, this.config.bigBlind],
    ]);

    const startStacks = new Map<number, number>();
    const handStacks = new Map<number, number>();
    for (const seat of pool) {
      const s = this.players.get(seat)!.stack;
      startStacks.set(seat, s);
      handStacks.set(seat, s);
    }

    // Pre-flop action starts left of the big blind (button/SB heads-up).
    const firstActor = headsUp ? seatsFromButton[0]! : seatsFromButton[3 % seatsFromButton.length]!;
    const preflopOrder = this.clockwise(pool, firstActor);
    const betting = new StreetBetting({ order: preflopOrder, stacks: handStacks, bigBlind: this.config.bigBlind, blinds });

    this.hand = {
      handId: `hand-${this.handCount}`,
      fairness,
      deck,
      seatsInHand: seatsFromButton,
      holes,
      board,
      street: Street.PreFlop,
      contributed: new Map(pool.map((s) => [s, 0])),
      startStacks,
      handStacks,
      folded: new Set(),
      allIn: new Set(),
      betting,
    };
    // Auto-complete if blinds already put everyone all-in.
    if (betting.closed) this.closeStreet();
    return this.hand;
  }

  private requireHand(): HandState {
    if (!this.hand) throw new Error('poker: no hand in progress');
    return this.hand;
  }

  /** Seat whose turn it is, or null (street resolving / hand over). */
  actor(): number | null {
    return this.hand && this.hand.street !== Street.Complete ? this.hand.betting.actor() : null;
  }

  legalActions(seat: number): PokerActionType[] {
    return this.hand ? this.hand.betting.legalActions(seat) : [];
  }

  toCall(seat: number): number {
    return this.hand ? this.hand.betting.toCall(seat) : 0;
  }

  minRaiseTo(): number {
    return this.hand ? this.hand.betting.minRaiseTo() : 0;
  }

  /** Apply a betting action for the seat to act; advances the street/hand as needed. */
  act(seat: number, type: PokerActionType, amount?: number): HandState {
    const hand = this.requireHand();
    hand.betting.apply(seat, type, amount);
    if (type === PokerActionType.Fold) hand.folded.add(seat);
    for (const s of hand.betting.allIn) hand.allIn.add(s);
    if (hand.betting.onlyOneLeft || hand.betting.closed) this.closeStreet();
    return hand;
  }

  /** Fold a (e.g. disconnected/timed-out) seat if it is their turn. */
  autoFold(seat: number): void {
    if (this.actor() === seat) this.act(seat, PokerActionType.Fold);
  }

  /** Merge the finished street's chips, then advance to the next street or showdown. */
  private closeStreet(): void {
    const hand = this.requireHand();
    for (const [seat, c] of hand.betting.contributions()) {
      hand.contributed.set(seat, (hand.contributed.get(seat) ?? 0) + c);
    }

    // Everyone folded but one → hand ends now (no showdown).
    if (hand.betting.onlyOneLeft) {
      this.finish();
      return;
    }
    if (hand.street === Street.River) {
      this.finish();
      return;
    }

    // Advance the street; if no further betting is possible (≤1 seat can act), run it out.
    let street: Street = nextStreet(hand.street);
    hand.street = street;
    while (street !== Street.River && street !== Street.Showdown && this.canActCount() <= 1) {
      street = nextStreet(street);
      hand.street = street;
    }

    if (this.canActCount() <= 1) {
      // All-but-one all-in: deal to the river and show down.
      hand.street = Street.River;
      this.finish();
      return;
    }

    // Open the next betting round: first active seat left of the button (SB seat, or
    // the big blind in heads-up — always the seat immediately clockwise of the button).
    const contenders = hand.seatsInHand.filter((s) => !hand.folded.has(s));
    const leftOfButton = hand.seatsInHand[1 % hand.seatsInHand.length]!;
    const firstActor = this.clockwise(contenders, leftOfButton).find((s) => !hand.allIn.has(s))!;
    const order = this.clockwise(contenders, firstActor);
    hand.betting = new StreetBetting({ order, stacks: hand.handStacks, bigBlind: this.config.bigBlind });
    if (hand.betting.closed) this.closeStreet();
  }

  /** Seats that can still voluntarily act (not folded, not all-in, chips remaining). */
  private canActCount(): number {
    const hand = this.requireHand();
    return hand.seatsInHand.filter((s) => !hand.folded.has(s) && !hand.allIn.has(s) && (hand.handStacks.get(s) ?? 0) > 0).length;
  }

  /* --------------------------------- showdown ---------------------------------- */

  private finish(): HandResult {
    const hand = this.requireHand();
    const seats = hand.seatsInHand;
    const contributedArr: number[] = [];
    const foldedArr: boolean[] = [];
    const maxSeat = Math.max(...seats);
    for (let s = 0; s <= maxSeat; s += 1) {
      contributedArr[s] = hand.contributed.get(s) ?? 0;
      foldedArr[s] = hand.folded.has(s) || !seats.includes(s);
    }

    const pots = buildSidePots(contributedArr, foldedArr);

    // Evaluate the (non-folded) hands at showdown. A single survivor needs no hand.
    const survivors = seats.filter((s) => !hand.folded.has(s));
    const revealBoard = survivors.length > 1; // showdown only when contested
    const evals: (ReturnType<typeof evaluate7> | null)[] = [];
    for (let s = 0; s <= maxSeat; s += 1) evals[s] = null;
    if (revealBoard) {
      for (const s of survivors) {
        evals[s] = evaluate7([...(hand.holes.get(s) ?? []), ...hand.board]);
      }
    } else if (survivors.length === 1) {
      evals[survivors[0]!] = null; // uncontested — wins by fold
    }

    // For an uncontested pot, distribute needs a "hand" for the survivor → give a sentinel.
    const distributable = evals.map((e, s) => (survivors.length === 1 && s === survivors[0] ? UNCONTESTED : e));
    const won = distributePots(pots, distributable);

    const rakeRate = this.config.rake ?? 0;
    let totalRake = 0;
    const seatResults: SeatResult[] = seats.map((seat) => {
      let winnings = won[seat] ?? 0;
      if (rakeRate > 0 && winnings > 0) {
        const r = Math.floor(winnings * rakeRate);
        totalRake += r;
        winnings -= r;
      }
      return {
        seat,
        playerId: this.players.get(seat)!.playerId,
        hole: hand.holes.get(seat) ?? [],
        contributed: hand.contributed.get(seat) ?? 0,
        won: winnings,
        folded: hand.folded.has(seat),
        allIn: hand.allIn.has(seat),
        hand: evals[seat] ?? undefined,
      };
    });

    // Write final stacks back to the players and fire tournament hooks.
    for (const sr of seatResults) {
      const player = this.players.get(sr.seat)!;
      player.stack = (hand.startStacks.get(sr.seat) ?? 0) - sr.contributed + sr.won;
      if (player.stack <= 0) this.config.tournament?.onEliminate?.(player.playerId, this.players.size);
    }
    this.config.tournament?.onRebalance?.(this.seats.filter((p) => p.stack > 0).length);
    this.config.tournament?.onLeaderboard?.(this.seats.map((p) => ({ playerId: p.playerId, stack: p.stack })));

    const result: HandResult = {
      handId: hand.handId,
      buttonSeat: this.buttonSeat,
      board: revealBoard ? hand.board : hand.board.slice(0, 0),
      seats: seatResults,
      pots,
      deck: hand.deck,
      rake: totalRake,
      fairness: { serverSeed: hand.fairness.serverSeed ?? '', serverSeedHash: hand.fairness.serverSeedHash ?? '', clientSeed: hand.fairness.clientSeed, nonce: hand.fairness.nonce },
    };
    hand.street = Street.Complete;
    hand.result = result;
    return result;
  }

  /** The finished hand's result (null until a hand completes). */
  get result(): HandResult | null {
    return this.hand?.result ?? null;
  }

  /** A UI/inspection snapshot of the live hand. */
  snapshot(): {
    handId: string;
    street: Street;
    board: Card[];
    button: number;
    actor: number | null;
    pot: number;
    currentBet: number;
    seats: Array<{ seat: number; playerId: string; stack: number; contributed: number; folded: boolean; allIn: boolean }>;
  } | null {
    const hand = this.hand;
    if (!hand) return null;
    const revealed = boardForStreet(hand.board, hand.street);
    const pot = [...hand.contributed.values()].reduce((a, b) => a + b, 0) + [...hand.betting.contributions().values()].reduce((a, b) => a + b, 0);
    return {
      handId: hand.handId,
      street: hand.street,
      board: revealed,
      button: this.buttonSeat,
      actor: this.actor(),
      pot,
      currentBet: hand.betting.bet,
      seats: hand.seatsInHand.map((s) => ({
        seat: s,
        playerId: this.players.get(s)!.playerId,
        stack: hand.handStacks.get(s) ?? 0,
        contributed: (hand.contributed.get(s) ?? 0) + (hand.betting.contributions().get(s) ?? 0),
        folded: hand.folded.has(s),
        allIn: hand.allIn.has(s),
      })),
    };
  }

  /** A player's hole cards (for their own view). */
  holeCards(seat: number): Card[] {
    return this.hand?.holes.get(seat) ?? [];
  }
}

/** A sentinel "hand" that beats nothing but exists so an uncontested pot distributes. */
const UNCONTESTED = { category: 0, name: 'Uncontested', ranks: [], cards: [] } as unknown as ReturnType<typeof evaluate7>;

function nextStreet(street: Street): Street {
  switch (street) {
    case Street.PreFlop:
      return Street.Flop;
    case Street.Flop:
      return Street.Turn;
    case Street.Turn:
      return Street.River;
    default:
      return Street.Showdown;
  }
}

function boardForStreet(board: Card[], street: Street): Card[] {
  switch (street) {
    case Street.PreFlop:
      return [];
    case Street.Flop:
      return board.slice(0, 3);
    case Street.Turn:
      return board.slice(0, 4);
    default:
      return board.slice(0, 5);
  }
}
