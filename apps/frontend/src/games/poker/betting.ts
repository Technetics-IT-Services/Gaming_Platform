/**
 * Texas Hold'em — betting engine (Sprint 5, STEP 3).
 *
 * A single-street betting round (`StreetBetting`) supporting check / call / bet / raise
 * / re-raise / fold / all-in with correct minimum-raise enforcement, plus the pure pot
 * mathematics — `buildSidePots` (side pots from unequal all-in stacks) and
 * `distributePots` (split pots with deterministic odd-chip handling). Chips are always
 * conserved: Σ contributed === Σ pot amounts === Σ won. Pure — no RNG, no IO.
 */
import { compareHands } from './hand-eval';
import { PokerActionType, type PokerHand, type Pot } from './types';

/** A single street's betting round over a fixed action order. */
export class StreetBetting {
  readonly order: number[];
  readonly stacks: Map<number, number>;
  readonly committed = new Map<number, number>();
  readonly folded = new Set<number>();
  readonly allIn = new Set<number>();
  private readonly acted = new Set<number>();
  private currentBet = 0;
  private lastRaiseSize: number;
  private pointer = 0;

  constructor(input: { order: number[]; stacks: Map<number, number>; bigBlind: number; blinds?: Map<number, number> }) {
    this.order = [...input.order];
    this.stacks = input.stacks;
    this.lastRaiseSize = input.bigBlind;
    for (const s of this.order) this.committed.set(s, 0);
    // Post forced blinds (pre-flop): they count as committed but the poster still acts.
    if (input.blinds) {
      for (const [seat, amt] of input.blinds) {
        const post = Math.min(amt, this.stacks.get(seat) ?? 0);
        this.committed.set(seat, post);
        this.stacks.set(seat, (this.stacks.get(seat) ?? 0) - post);
        if ((this.stacks.get(seat) ?? 0) === 0) this.allIn.add(seat);
        this.currentBet = Math.max(this.currentBet, post);
      }
    }
  }

  private isActive(seat: number): boolean {
    return !this.folded.has(seat) && !this.allIn.has(seat);
  }

  /** Seats that can still contest (not folded). */
  private contenders(): number[] {
    return this.order.filter((s) => !this.folded.has(s));
  }

  /** The seat whose turn it is, or null when the street is closed. */
  actor(): number | null {
    if (this.contenders().length <= 1) return null; // everyone else folded
    const n = this.order.length;
    for (let i = 0; i < n; i += 1) {
      const seat = this.order[(this.pointer + i) % n]!;
      if (!this.isActive(seat)) continue;
      if (!this.acted.has(seat) || (this.committed.get(seat) ?? 0) < this.currentBet) {
        return seat;
      }
    }
    return null;
  }

  get closed(): boolean {
    return this.actor() === null;
  }

  get bet(): number {
    return this.currentBet;
  }

  toCall(seat: number): number {
    return Math.max(0, this.currentBet - (this.committed.get(seat) ?? 0));
  }

  /** Legal action types for the seat to act (empty if it is not their turn). */
  legalActions(seat: number): PokerActionType[] {
    if (this.actor() !== seat) return [];
    const stack = this.stacks.get(seat) ?? 0;
    const toCall = this.toCall(seat);
    const out: PokerActionType[] = [];
    if (toCall === 0) {
      out.push(PokerActionType.Check);
      if (stack > 0) out.push(this.currentBet === 0 ? PokerActionType.Bet : PokerActionType.Raise);
    } else {
      out.push(PokerActionType.Fold);
      if (stack > 0) out.push(PokerActionType.Call);
      if (stack > toCall) out.push(PokerActionType.Raise);
    }
    if (stack > 0) out.push(PokerActionType.AllIn);
    return out;
  }

  /** The minimum legal total a seat may raise TO this street. */
  minRaiseTo(): number {
    return this.currentBet + this.lastRaiseSize;
  }

  /**
   * Apply an action for the seat to act. `amount` (bet/raise) is the TOTAL this seat
   * wants committed on this street. Throws on an illegal action.
   */
  apply(seat: number, type: PokerActionType, amount?: number): void {
    if (this.actor() !== seat) throw new Error(`poker: not seat ${seat}'s turn`);
    const stack = this.stacks.get(seat) ?? 0;
    const committed = this.committed.get(seat) ?? 0;
    const toCall = this.currentBet - committed;

    switch (type) {
      case PokerActionType.Fold:
        this.folded.add(seat);
        break;

      case PokerActionType.Check:
        if (toCall !== 0) throw new Error('poker: cannot check facing a bet');
        break;

      case PokerActionType.Call: {
        const pay = Math.min(toCall, stack);
        this.commit(seat, pay);
        break;
      }

      case PokerActionType.Bet:
      case PokerActionType.Raise: {
        if (amount === undefined) throw new Error('poker: bet/raise needs an amount');
        const target = amount; // total committed this street
        const raiseSize = target - this.currentBet;
        if (target <= this.currentBet) throw new Error('poker: raise must exceed the current bet');
        const need = target - committed;
        if (need > stack) throw new Error('poker: not enough chips — use all-in');
        if (raiseSize < this.lastRaiseSize && need < stack) throw new Error(`poker: min raise is to ${this.minRaiseTo()}`);
        this.commit(seat, need);
        this.raiseTo(target, raiseSize);
        break;
      }

      case PokerActionType.AllIn: {
        const target = committed + stack;
        const raiseSize = target - this.currentBet;
        this.commit(seat, stack);
        if (target > this.currentBet) this.raiseTo(target, Math.max(raiseSize, this.lastRaiseSize)); // a short all-in still reopens to callers below it
        break;
      }

      default:
        throw new Error(`poker: unknown action ${type}`);
    }

    this.acted.add(seat);
    // Advance the pointer to just after this seat.
    this.pointer = (this.order.indexOf(seat) + 1) % this.order.length;
  }

  private commit(seat: number, chips: number): void {
    const c = Math.min(chips, this.stacks.get(seat) ?? 0);
    this.stacks.set(seat, (this.stacks.get(seat) ?? 0) - c);
    this.committed.set(seat, (this.committed.get(seat) ?? 0) + c);
    if ((this.stacks.get(seat) ?? 0) === 0) this.allIn.add(seat);
  }

  /** Register an aggressive action: raise the bar and re-open action to the others. */
  private raiseTo(target: number, raiseSize: number): void {
    if (target > this.currentBet) {
      this.currentBet = target;
      if (raiseSize >= this.lastRaiseSize) this.lastRaiseSize = raiseSize;
      // Everyone still active must act again.
      for (const s of this.order) if (this.isActive(s)) this.acted.delete(s);
    }
  }

  /** This street's committed chips per seat (to merge into hand totals). */
  contributions(): Map<number, number> {
    return new Map(this.committed);
  }

  /** Only one contender remains (all others folded) → hand ends without showdown. */
  get onlyOneLeft(): boolean {
    return this.contenders().length <= 1;
  }
}

/**
 * Build the main + side pots from each seat's TOTAL contribution over the hand.
 * Folded seats' chips still form the pots but they cannot win. Returns pots ordered
 * main → side; Σ pot amounts === Σ contributed.
 */
export function buildSidePots(contributed: number[], folded: boolean[]): Pot[] {
  const seats = contributed.map((_, i) => i).filter((i) => contributed[i]! > 0);
  const levels = [...new Set(seats.map((i) => contributed[i]!))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    const layer = level - prev;
    let amount = 0;
    const eligible: number[] = [];
    for (const s of seats) {
      if (contributed[s]! >= level) {
        amount += layer;
        if (!folded[s]) eligible.push(s);
      }
    }
    if (amount > 0) pots.push({ amount, eligible });
    prev = level;
  }
  return mergePots(pots);
}

/** Merge adjacent pots that share the exact same eligibility set. */
function mergePots(pots: Pot[]): Pot[] {
  const out: Pot[] = [];
  for (const p of pots) {
    const last = out[out.length - 1];
    if (last && last.eligible.join(',') === p.eligible.join(',')) last.amount += p.amount;
    else out.push({ ...p });
  }
  return out;
}

/**
 * Distribute every pot to the best eligible hand(s), splitting ties evenly. Odd chips
 * go to the lowest-indexed winning seat (deterministic, near the button). Returns chips
 * won per seat (indexed like `hands`). Σ won === Σ pot amounts.
 */
export function distributePots(pots: Pot[], hands: (PokerHand | null)[]): number[] {
  const won = hands.map(() => 0);
  for (const pot of pots) {
    const live = pot.eligible.filter((s) => hands[s]);
    if (live.length === 0) continue; // no contender (shouldn't happen) — skip
    let best = live[0]!;
    const winners: number[] = [];
    for (const s of live) {
      const cmp = compareHands(hands[s]!, hands[best]!);
      if (cmp > 0) best = s;
    }
    for (const s of live) if (compareHands(hands[s]!, hands[best]!) === 0) winners.push(s);
    winners.sort((a, b) => a - b);
    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;
    pot.winners = winners;
    for (const s of winners) {
      won[s]! += share + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
    }
  }
  return won;
}
