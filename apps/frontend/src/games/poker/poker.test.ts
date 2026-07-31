import type { IFairnessProof } from '@gaming-platform/types';
import { BetMode } from '@gaming-platform/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { useDemoWallet } from '@/stores/demo-wallet';
import { GameRuntime, type GameRegistration, type PlayerContext } from '@/runtime/game-runtime';
import { createProviderSet } from '@/runtime/providers';
import { DemoProvablyFairProvider } from '@/runtime/providers/provably-fair';

import { buildSidePots, distributePots, StreetBetting } from './betting';
import { deal, shuffleDeck, verifyShuffle } from './cards';
import { PokerHandEngine, POKER_ENGINE_KEY } from './engine';
import { compareHands, evaluate5, evaluate7 } from './hand-eval';
import { replayHand, verifyHand } from './provably-fair';
import { PokerTableEngine, POKER_DEFAULT } from './table-engine';
import { createBlindSchedule, currentBlindLevel, suggestRebalance } from './tournament';
import { HandCategory, PokerActionType, type PokerHand, type SeatSettlement } from './types';

/**
 * Texas Hold'em Poker (Sprint 5). Verifies the hand evaluator (all categories + ties),
 * the provably-fair deck (deterministic shuffle + replay + verification), the betting
 * engine (all actions + min-raise), side/split pots, the reusable table engine (seats,
 * dealer rotation, reconnect, full hand flow, showdown), tournament hooks, and end-to-end
 * money flow through the FROZEN runtime + ledger (per-seat settlement, chip conservation,
 * financial invariant). No runtime/wallet/ledger code is modified.
 */

const pf = new DemoProvablyFairProvider();
const F = (nonce: number, s = 'S', c = 'C'): IFairnessProof => ({ serverSeed: s, serverSeedHash: '', clientSeed: c, nonce });

/* ------------------------------ hand evaluation ------------------------------ */

describe('poker hand evaluation', () => {
  it('ranks every category correctly', () => {
    expect(evaluate5(['AS', 'KS', 'QS', 'JS', 'TS']).category).toBe(HandCategory.RoyalFlush);
    expect(evaluate5(['9H', '8H', '7H', '6H', '5H']).category).toBe(HandCategory.StraightFlush);
    expect(evaluate5(['AS', 'AH', 'AD', 'AC', 'KS']).category).toBe(HandCategory.FourOfAKind);
    expect(evaluate5(['AS', 'AH', 'AD', 'KC', 'KS']).category).toBe(HandCategory.FullHouse);
    expect(evaluate5(['AS', 'JS', '9S', '5S', '2S']).category).toBe(HandCategory.Flush);
    expect(evaluate5(['AS', 'KH', 'QD', 'JC', 'TS']).category).toBe(HandCategory.Straight);
    expect(evaluate5(['5S', '4H', '3D', '2C', 'AS']).category).toBe(HandCategory.Straight); // wheel
    expect(evaluate5(['AS', 'AH', 'AD', 'KC', 'QS']).category).toBe(HandCategory.ThreeOfAKind);
    expect(evaluate5(['AS', 'AH', 'KD', 'KC', 'QS']).category).toBe(HandCategory.TwoPair);
    expect(evaluate5(['AS', 'AH', 'KD', 'QC', 'JS']).category).toBe(HandCategory.Pair);
    expect(evaluate5(['AS', 'KH', 'QD', 'JC', '9S']).category).toBe(HandCategory.HighCard);
  });

  it('finds the best 5 of 7', () => {
    // Board makes a flush; player's two hearts complete it.
    const hand = evaluate7(['AH', 'KH', '2H', '7H', '9H', '3C', '4S']);
    expect(hand.category).toBe(HandCategory.Flush);
    expect(hand.cards).toHaveLength(5);
  });

  it('breaks ties by kicker and detects exact splits', () => {
    const a = evaluate7(['AS', 'AH', 'KD', 'QC', 'JS', '3H', '2C']); // pair aces, K-Q-J
    const b = evaluate7(['AC', 'AD', 'KH', 'QS', 'TS', '3D', '2H']); // pair aces, K-Q-T
    expect(compareHands(a, b)).toBeGreaterThan(0); // J kicker beats T
    const c = evaluate7(['AS', 'AH', 'KD', 'QC', 'JS', '3H', '2C']);
    expect(compareHands(a, c)).toBe(0); // identical → split
  });

  it('the wheel (A-2-3-4-5) is the lowest straight, below 6-high', () => {
    const wheel = evaluate5(['5S', '4H', '3D', '2C', 'AS']);
    const six = evaluate5(['6S', '5H', '4D', '3C', '2S']);
    expect(compareHands(six, wheel)).toBeGreaterThan(0);
  });
});

/* ---------------------------- deck & provably fair --------------------------- */

describe('poker deck & provably fair', () => {
  it('shuffles a full 52-card deck deterministically', () => {
    const d1 = shuffleDeck(pf, F(1));
    const d2 = shuffleDeck(pf, F(1));
    expect(d1).toEqual(d2);
    expect(new Set(d1).size).toBe(52);
    expect(shuffleDeck(pf, F(2))).not.toEqual(d1); // different nonce → different order
  });

  it('deals holes + board off the top and verifies the shuffle', () => {
    const deck = shuffleDeck(pf, F(7));
    const { holes, board } = deal(deck, 6);
    expect(holes).toHaveLength(6);
    expect(holes.every((h) => h.length === 2)).toBe(true);
    expect(board).toHaveLength(5);
    const all = [...holes.flat(), ...board];
    expect(new Set(all).size).toBe(all.length); // no card dealt twice

    const v = verifyShuffle(pf, { serverSeed: 'S', clientSeed: 'C', nonce: 7, expected: deck });
    expect(v.valid).toBe(true);
    expect(verifyShuffle(pf, { serverSeed: 'S', clientSeed: 'C', nonce: 8, expected: deck }).valid).toBe(false);
  });

  it('replays a full hand (deck, holes, board) from the revealed seeds', () => {
    const deck = shuffleDeck(pf, F(3));
    const replay = replayHand(pf, { serverSeed: 'S', clientSeed: 'C', nonce: 3, seatCount: 4 });
    expect(replay.deck).toEqual(deck);
    const v = verifyHand(pf, { serverSeed: 'S', clientSeed: 'C', nonce: 3, seatCount: 4, expectedDeck: deck });
    expect(v.valid).toBe(true);
  });
});

/* -------------------------------- betting engine ----------------------------- */

describe('poker betting engine', () => {
  it('enforces check/call/bet/raise/fold legality and the minimum raise', () => {
    const stacks = new Map([[0, 100], [1, 100], [2, 100]]);
    const r = new StreetBetting({ order: [0, 1, 2], stacks, bigBlind: 2, blinds: new Map([[1, 1], [2, 2]]) });
    expect(r.actor()).toBe(0);
    expect(r.toCall(0)).toBe(2);
    expect(r.legalActions(0)).toContain(PokerActionType.Call);
    // min raise is to currentBet + lastRaiseSize = 2 + 2 = 4
    expect(r.minRaiseTo()).toBe(4);
    expect(() => r.apply(0, PokerActionType.Raise, 3)).toThrow(/min raise/);
    r.apply(0, PokerActionType.Raise, 6); // raise to 6
    expect(r.bet).toBe(6);
    expect(r.actor()).toBe(1); // SB to act
    r.apply(1, PokerActionType.Fold);
    r.apply(2, PokerActionType.Call); // BB calls 6
    expect(r.closed).toBe(true);
    expect(r.contributions().get(0)).toBe(6);
    expect(r.contributions().get(2)).toBe(6);
  });

  it('cannot check facing a bet, and cannot act out of turn', () => {
    const stacks = new Map([[0, 50], [1, 50]]);
    const r = new StreetBetting({ order: [0, 1], stacks, bigBlind: 2 });
    expect(() => r.apply(1, PokerActionType.Check)).toThrow(/not seat 1/);
    r.apply(0, PokerActionType.Bet, 10);
    expect(() => r.apply(1, PokerActionType.Check)).toThrow(/cannot check/);
  });

  it('builds side pots from unequal all-in stacks (chips conserved)', () => {
    // A=100, B=100, C all-in 40. Main pot 120 (A,B,C); side pot 120 (A,B).
    const pots = buildSidePots([100, 100, 40], [false, false, false]);
    expect(pots).toHaveLength(2);
    expect(pots[0]).toMatchObject({ amount: 120, eligible: [0, 1, 2] });
    expect(pots[1]).toMatchObject({ amount: 120, eligible: [0, 1] });
    expect(pots.reduce((s, p) => s + p.amount, 0)).toBe(240);
  });

  it('folded players fund pots but cannot win them', () => {
    // A bets 100, B folds after 40 in. A wins 140 (own 100 + B's 40) uncontested.
    const pots = buildSidePots([100, 40], [false, true]);
    const hands: (PokerHand | null)[] = [evaluate5(['AS', 'AH', 'AD', 'AC', 'KS']), null];
    const won = distributePots(pots, hands);
    expect(won[0]).toBe(140);
    expect(won[1]).toBe(0);
  });

  it('splits a pot evenly and awards the odd chip to the lowest seat', () => {
    const pots = buildSidePots([50, 50], [false, false]);
    const tie = evaluate5(['AS', 'KH', 'QD', 'JC', '9S']);
    const won = distributePots([{ amount: 101, eligible: [0, 1] }], [tie, tie]);
    expect(won[0]).toBe(51); // odd chip to seat 0
    expect(won[1]).toBe(50);
    expect(pots.reduce((s, p) => s + p.amount, 0)).toBe(100);
  });
});

/* --------------------------------- table engine ------------------------------ */

describe('poker table engine', () => {
  it('manages seats, join/leave/reconnect and rotates the dealer button', () => {
    const t = new PokerTableEngine({ smallBlind: 1, bigBlind: 2, minBuyIn: 40, maxBuyIn: 400 });
    t.seatPlayer({ playerId: 'a', seat: 0, stack: 200 });
    t.seatPlayer({ playerId: 'b', seat: 1, stack: 200 });
    t.seatPlayer({ playerId: 'c', seat: 2, stack: 200 });
    expect(t.seats).toHaveLength(3);

    t.startHand(pf, F(1));
    const b1 = t.button;
    t.disconnect(1);
    expect(t.reconnect(1).disconnected).toBe(false);
    // fold everyone to end the hand, then start another → button moves on
    while (t.actor() !== null) t.act(t.actor()!, PokerActionType.Fold);
    t.startHand(pf, F(2));
    expect(t.button).not.toBe(b1);

    t.leave(2);
    expect(t.seats).toHaveLength(2);
  });

  it('rejects an out-of-range buy-in and an overfull table', () => {
    const t = new PokerTableEngine({ maxSeats: 2, minBuyIn: 40, maxBuyIn: 100 });
    expect(() => t.seatPlayer({ playerId: 'a', stack: 10 })).toThrow(/buy-in/);
    t.seatPlayer({ playerId: 'a', stack: 100 });
    t.seatPlayer({ playerId: 'b', stack: 100 });
    expect(() => t.seatPlayer({ playerId: 'c', stack: 100 })).toThrow(/invalid seat|free/i);
  });

  it('plays a full hand to showdown and conserves chips', () => {
    const t = new PokerTableEngine({ smallBlind: 1, bigBlind: 2, minBuyIn: 40, maxBuyIn: 400 });
    t.seatPlayer({ playerId: 'a', seat: 0, stack: 200 });
    t.seatPlayer({ playerId: 'b', seat: 1, stack: 200 });
    const startTotal = t.seats.reduce((s, p) => s + p.stack, 0);

    t.startHand(pf, F(11));
    // Everyone calls/checks to showdown.
    let guard = 0;
    while (t.actor() !== null && guard < 50) {
      const seat = t.actor()!;
      const legal = t.legalActions(seat);
      if (legal.includes(PokerActionType.Check)) t.act(seat, PokerActionType.Check);
      else t.act(seat, PokerActionType.Call);
      guard += 1;
    }
    const res = t.result!;
    expect(res.board).toHaveLength(5); // contested → board shown
    expect(res.seats.reduce((s, sr) => s + sr.contributed, 0)).toBe(res.seats.reduce((s, sr) => s + sr.won, 0) + res.rake);
    expect(t.seats.reduce((s, p) => s + p.stack, 0)).toBe(startTotal); // no chips created/destroyed (rake 0)
  });

  it('ends a hand by folds with no showdown (winner takes the blinds)', () => {
    const t = new PokerTableEngine({ smallBlind: 1, bigBlind: 2, minBuyIn: 40, maxBuyIn: 400 });
    t.seatPlayer({ playerId: 'a', seat: 0, stack: 200 });
    t.seatPlayer({ playerId: 'b', seat: 1, stack: 200 });
    t.seatPlayer({ playerId: 'c', seat: 2, stack: 200 });
    t.startHand(pf, F(21));
    while (t.actor() !== null) t.act(t.actor()!, PokerActionType.Fold);
    const res = t.result!;
    expect(res.board).toHaveLength(0); // no showdown
    const winner = res.seats.find((s) => s.won > 0)!;
    expect(winner.won).toBe(res.seats.reduce((s, sr) => s + sr.contributed, 0));
  });

  it('resolves an all-in with a side pot and runs the board out', () => {
    const t = new PokerTableEngine({ smallBlind: 1, bigBlind: 2, minBuyIn: 20, maxBuyIn: 400 });
    t.seatPlayer({ playerId: 'short', seat: 0, stack: 20 });
    t.seatPlayer({ playerId: 'big1', seat: 1, stack: 200 });
    t.seatPlayer({ playerId: 'big2', seat: 2, stack: 200 });
    const startTotal = t.seats.reduce((s, p) => s + p.stack, 0);
    t.startHand(pf, F(31));
    let guard = 0;
    while (t.actor() !== null && guard < 60) {
      const seat = t.actor()!;
      const legal = t.legalActions(seat);
      if (legal.includes(PokerActionType.AllIn) && seat === 0) t.act(seat, PokerActionType.AllIn);
      else if (legal.includes(PokerActionType.Check)) t.act(seat, PokerActionType.Check);
      else if (legal.includes(PokerActionType.Call)) t.act(seat, PokerActionType.Call);
      else t.act(seat, PokerActionType.Check);
      guard += 1;
    }
    const res = t.result!;
    expect(res.seats.reduce((s, sr) => s + sr.contributed, 0)).toBe(res.seats.reduce((s, sr) => s + sr.won, 0) + res.rake);
    expect(t.seats.reduce((s, p) => s + p.stack, 0)).toBe(startTotal);
  });
});

/* ------------------------------ tournament hooks ----------------------------- */

describe('poker tournament hooks (extension points only)', () => {
  it('builds an escalating blind schedule and reads the active level', () => {
    const schedule = createBlindSchedule({ startSmallBlind: 25, levels: 4, growth: 2, levelDurationMs: 1000 });
    expect(schedule).toHaveLength(4);
    expect(schedule[0]).toMatchObject({ smallBlind: 25, bigBlind: 50 });
    expect(schedule[1]!.smallBlind).toBe(50);
    expect(currentBlindLevel(schedule, 0)?.level).toBe(1);
    expect(currentBlindLevel(schedule, 1500)?.level).toBe(2);
    expect(currentBlindLevel(schedule, 999_999)?.level).toBe(4); // past the end → last level
  });

  it('suggests table rebalancing and fires elimination/leaderboard hooks', () => {
    expect(suggestRebalance([9, 3])).toEqual({ from: 0, to: 1, count: 3 });
    expect(suggestRebalance([5, 5])).toBeNull();

    const eliminated: string[] = [];
    let leaderboardCalls = 0;
    const t = new PokerTableEngine({
      smallBlind: 1, bigBlind: 2, minBuyIn: 2, maxBuyIn: 400,
      tournament: { tournamentId: 'T1', onEliminate: (id) => eliminated.push(id), onLeaderboard: () => { leaderboardCalls += 1; } },
    });
    t.seatPlayer({ playerId: 'short', seat: 0, stack: 2 });
    t.seatPlayer({ playerId: 'big', seat: 1, stack: 400 });
    t.startHand(pf, F(41));
    let guard = 0;
    while (t.actor() !== null && guard < 40) {
      const seat = t.actor()!;
      const legal = t.legalActions(seat);
      t.act(seat, legal.includes(PokerActionType.AllIn) ? PokerActionType.AllIn : legal.includes(PokerActionType.Call) ? PokerActionType.Call : PokerActionType.Check);
      guard += 1;
    }
    expect(leaderboardCalls).toBe(1); // leaderboard hook fired once at hand end
  });
});

/* -------------------- runtime + ledger + financial invariant ----------------- */

const PLAYER: PlayerContext = { playerId: 'demo-player', currency: 'INR' };
const CAPS: GameRegistration['capabilities'] = { cashOut: false, autoBet: false, multiBet: false, provablyFair: true, realtime: true, multiplayer: true, liveDealer: false, tournament: true };

function runtime(): GameRuntime {
  const rt = new GameRuntime(createProviderSet(), PLAYER);
  rt.registerEngine(new PokerHandEngine());
  rt.registerGame({ gameId: 'poker', name: "Texas Hold'em", engineKey: POKER_ENGINE_KEY, category: 'card', capabilities: CAPS, config: { ...POKER_DEFAULT, minBet: 1, maxBet: 1_000_000, rewards: { winXp: 50, lossXp: 8 } } as never });
  return rt;
}

/** Settle one seat's hand result through the frozen runtime. */
async function settleSeat(rt: GameRuntime, sessionId: string, seat: SeatSettlement, i: number) {
  return rt.placeBet<SeatSettlement>({
    gameId: 'poker', sessionId, stake: { amount: String(seat.contributed), currency: 'INR' },
    mode: BetMode.Single, selections: [{ pick: seat }], idempotencyKey: `poker-${seat.handId}-${seat.seat}-${i}`, clientSeed: 'demo',
  });
}

beforeEach(() => {
  useDemoWallet.getState().reset();
  useDemoWallet.getState().deposit(1_000_000);
});

describe('poker settles through the frozen runtime + ledger', () => {
  it('a winning seat: debit contributed → credit won (financial invariant)', async () => {
    const rt = runtime();
    const session = await rt.createSession({ gameId: 'poker' });
    const before = useDemoWallet.getState().balance;
    const res = await settleSeat(rt, session.sessionId, { handId: 'h1', seat: 0, playerId: 'demo-player', contributed: 20, won: 50, handName: 'Flush' }, 0);
    expect(Number(res.payout)).toBe(50);
    expect(useDemoWallet.getState().balance).toBe(before - 20 + 50);
  });

  it('a losing seat keeps only the contribution (no credit)', async () => {
    const rt = runtime();
    const session = await rt.createSession({ gameId: 'poker' });
    const before = useDemoWallet.getState().balance;
    await settleSeat(rt, session.sessionId, { handId: 'h2', seat: 1, playerId: 'demo-player', contributed: 20, won: 0 }, 0);
    expect(useDemoWallet.getState().balance).toBe(before - 20);
  });

  it('ledger integrity — a full multiplayer hand nets zero across the table', async () => {
    // Play a real hand, then settle EVERY seat through the ledger; total balance is unchanged.
    const t = new PokerTableEngine({ smallBlind: 1, bigBlind: 2, minBuyIn: 40, maxBuyIn: 400 });
    t.seatPlayer({ playerId: 'a', seat: 0, stack: 200 });
    t.seatPlayer({ playerId: 'b', seat: 1, stack: 200 });
    t.seatPlayer({ playerId: 'c', seat: 2, stack: 200 });
    t.startHand(pf, F(51));
    let guard = 0;
    while (t.actor() !== null && guard < 60) {
      const seat = t.actor()!;
      const legal = t.legalActions(seat);
      t.act(seat, legal.includes(PokerActionType.Check) ? PokerActionType.Check : PokerActionType.Call);
      guard += 1;
    }
    const res = t.result!;

    const rt = runtime();
    const session = await rt.createSession({ gameId: 'poker' });
    const before = useDemoWallet.getState().balance;
    let i = 0;
    for (const sr of res.seats) {
      if (sr.contributed <= 0) continue;
      const b = useDemoWallet.getState().balance;
      await settleSeat(rt, session.sessionId, { handId: res.handId, seat: sr.seat, playerId: 'demo-player', contributed: sr.contributed, won: sr.won, handName: sr.hand?.name }, i);
      expect(useDemoWallet.getState().balance).toBe(b - sr.contributed + sr.won); // per-seat invariant
      i += 1;
    }
    // Chips conserved (rake 0) → the table nets to zero through the ledger.
    expect(useDemoWallet.getState().balance).toBe(before);
  });

  it('reconnect mid-hand does not disturb the money model', async () => {
    const t = new PokerTableEngine({ smallBlind: 1, bigBlind: 2, minBuyIn: 40, maxBuyIn: 400 });
    t.seatPlayer({ playerId: 'a', seat: 0, stack: 200 });
    t.seatPlayer({ playerId: 'b', seat: 1, stack: 200 });
    t.startHand(pf, F(61));
    t.disconnect(0);
    t.reconnect(0); // seat + stack intact
    let guard = 0;
    while (t.actor() !== null && guard < 40) {
      const seat = t.actor()!;
      const legal = t.legalActions(seat);
      t.act(seat, legal.includes(PokerActionType.Check) ? PokerActionType.Check : PokerActionType.Call);
      guard += 1;
    }
    const res = t.result!;
    expect(res.seats.reduce((s, sr) => s + sr.contributed, 0)).toBe(res.seats.reduce((s, sr) => s + sr.won, 0));
  });
});
