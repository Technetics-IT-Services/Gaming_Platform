'use client';

/**
 * usePoker — React binding to the reusable Poker Table Engine + the FROZEN runtime
 * (Sprint 5).
 *
 * A single-player demo table: the hero (seat 0) plays Texas Hold'em against bot seats.
 * The pure `PokerTableEngine` runs the multiplayer hand (deal, betting, side pots,
 * showdown); when the hand ends, the hero's net result settles through the frozen
 * `GameRuntime` (stake = chips contributed, settlement payout = chips won) → wallet /
 * ledger. Money never moves outside the frozen runtime; bots are simulated chips only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { IFairnessProof } from '@gaming-platform/types';
import { BetMode } from '@gaming-platform/types';

import { GameRuntime, type PlayerContext } from '@/runtime/game-runtime';
import { createProviderSet } from '@/runtime/providers';
import { DemoProvablyFairProvider } from '@/runtime/providers/provably-fair';

import { PokerHandEngine, POKER_ENGINE_KEY, POKER_DEFAULT } from '@/games/poker/engine';
import { PokerTableEngine } from '@/games/poker/table-engine';
import type { Card } from '@/games/poker/cards';
import { PokerActionType, Street, type PokerRecord, type SeatSettlement } from '@/games/poker/types';

const GAME_ID = 'poker';
const HERO = 0;
const SEATS = 4;
const BUY_IN = 200;

export interface SeatView {
  seat: number;
  playerId: string;
  stack: number;
  contributed: number;
  folded: boolean;
  allIn: boolean;
  isHero: boolean;
  isActor: boolean;
  isButton: boolean;
  hole: Card[]; // hero only; bots hidden until showdown
  hand?: string;
}

export function usePoker(player: PlayerContext = { playerId: 'demo-player', currency: 'INR' }) {
  const rtRef = useRef<GameRuntime | null>(null);
  const sessionRef = useRef<string | null>(null);
  const tableRef = useRef<PokerTableEngine | null>(null);
  const pfRef = useRef(new DemoProvablyFairProvider());
  const nonceRef = useRef(0);
  const fairnessRef = useRef<IFairnessProof | null>(null);

  const [tick, setTick] = useState(0); // re-render trigger after engine mutations
  const [phase, setPhase] = useState<'idle' | 'playing' | 'complete'>('idle');
  const [history, setHistory] = useState<PokerRecord[]>([]);
  const [lastProof, setLastProof] = useState<PokerRecord | null>(null);
  const [message, setMessage] = useState<string>('Press “New Hand” to deal.');
  const rerender = useCallback(() => setTick((t) => t + 1), []);

  const ensure = useCallback(async () => {
    if (!rtRef.current) {
      const rt = new GameRuntime({ ...createProviderSet(), provablyFair: pfRef.current }, player);
      rt.registerEngine(new PokerHandEngine());
      rt.registerGame({ gameId: GAME_ID, name: "Texas Hold'em", engineKey: POKER_ENGINE_KEY, category: 'card', capabilities: { cashOut: false, autoBet: false, multiBet: false, provablyFair: true, realtime: true, multiplayer: true, liveDealer: false, tournament: true }, config: { ...POKER_DEFAULT, minBet: 1, maxBet: 1_000_000, rewards: { winXp: 50, lossXp: 8 } } as never });
      rtRef.current = rt;
    }
    if (!tableRef.current) {
      const table = new PokerTableEngine({ smallBlind: 1, bigBlind: 2, minBuyIn: 40, maxBuyIn: 400 });
      for (let s = 0; s < SEATS; s += 1) table.seatPlayer({ playerId: s === HERO ? 'You' : `Bot ${s}`, seat: s, stack: BUY_IN });
      tableRef.current = table;
    }
    if (!sessionRef.current) {
      const session = await rtRef.current.createSession({ gameId: GAME_ID });
      sessionRef.current = session.sessionId;
    }
    return { rt: rtRef.current, sessionId: sessionRef.current!, table: tableRef.current! };
  }, [player]);

  /** Settle the hero's net result for the finished hand through the frozen runtime. */
  const settleHero = useCallback(async () => {
    const table = tableRef.current!;
    const res = table.result;
    if (!res) return;
    const hero = res.seats.find((s) => s.seat === HERO);
    const f = fairnessRef.current;
    const record: PokerRecord = {
      handId: res.handId, seat: HERO, hole: hero?.hole ?? [], board: res.board,
      handName: hero?.hand?.name, contributed: hero?.contributed ?? 0, won: hero?.won ?? 0,
      net: (hero?.won ?? 0) - (hero?.contributed ?? 0),
      serverSeed: f?.serverSeed, serverSeedHash: f?.serverSeedHash, clientSeed: f?.clientSeed ?? 'player', nonce: f?.nonce ?? 0,
    };
    if (hero && hero.contributed > 0) {
      const { rt, sessionId } = await ensure();
      const pick: SeatSettlement = { handId: res.handId, seat: HERO, playerId: player.playerId, contributed: hero.contributed, won: hero.won, handName: hero.hand?.name, hole: hero.hole, board: res.board };
      try {
        await rt.placeBet<SeatSettlement>({ gameId: GAME_ID, sessionId, stake: { amount: String(hero.contributed), currency: player.currency }, mode: BetMode.Single, selections: [{ pick }], idempotencyKey: `poker-${res.handId}-${HERO}`, clientSeed: 'player' });
      } catch {
        /* wallet balance too low for the demo mirror — table chips still authoritative */
      }
    }
    setHistory((h) => [record, ...h].slice(0, 50));
    setLastProof(record);
    setMessage(record.net > 0 ? `You won +${record.net}${record.handName ? ` with ${record.handName}` : ''}.` : record.net < 0 ? `You lost ${-record.net}.` : 'Hand pushed.');
  }, [ensure, player.currency, player.playerId]);

  /** Simple bot policy: check when free, otherwise call (calling stations). */
  const driveBots = useCallback(async () => {
    const table = tableRef.current!;
    let guard = 0;
    while (table.actor() !== null && table.actor() !== HERO && guard < 100) {
      const seat = table.actor()!;
      const legal = table.legalActions(seat);
      table.act(seat, legal.includes(PokerActionType.Check) ? PokerActionType.Check : PokerActionType.Call);
      guard += 1;
    }
    rerender();
    if (table.actor() === null) {
      setPhase('complete');
      await settleHero();
    }
  }, [rerender, settleHero]);

  const newHand = useCallback(async () => {
    const { table } = await ensure();
    // Rebuy any busted seats so the demo table always has players.
    for (const p of table.seats) if (p.stack < 2) table.leave(p.seat);
    for (let s = 0; s < SEATS; s += 1) if (!table.seats.find((p) => p.seat === s)) table.seatPlayer({ playerId: s === HERO ? 'You' : `Bot ${s}`, seat: s, stack: BUY_IN });

    const commit = pfRef.current.commit();
    nonceRef.current += 1;
    const fairness: IFairnessProof = { serverSeed: commit.serverSeed, serverSeedHash: commit.serverSeedHash, clientSeed: 'player', nonce: nonceRef.current };
    fairnessRef.current = fairness;
    table.startHand(pfRef.current, fairness);
    setPhase('playing');
    setMessage('Your move.');
    await driveBots();
  }, [driveBots, ensure]);

  const act = useCallback(async (type: PokerActionType, amount?: number) => {
    const table = tableRef.current;
    if (!table || table.actor() !== HERO) return;
    table.act(HERO, type, amount);
    rerender();
    await driveBots();
  }, [driveBots, rerender]);

  useEffect(() => { void ensure(); }, [ensure]);

  const table = tableRef.current;
  const snap = table?.snapshot() ?? null;
  const heroHole = table?.holeCards(HERO) ?? [];
  const result = table?.result ?? null;
  const heroTurn = snap?.actor === HERO && phase === 'playing';

  const seats: SeatView[] = useMemo(() => {
    if (!snap) return [];
    return snap.seats.map((s) => {
      const rSeat = result?.seats.find((r) => r.seat === s.seat);
      const showHole = s.seat === HERO || (phase === 'complete' && !s.folded && (result?.board.length ?? 0) > 0);
      return {
        ...s,
        isHero: s.seat === HERO,
        isActor: snap.actor === s.seat,
        isButton: snap.button === s.seat,
        hole: showHole ? (s.seat === HERO ? heroHole : rSeat?.hole ?? []) : [],
        hand: phase === 'complete' ? rSeat?.hand?.name : undefined,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, result, phase, heroHole, tick]);

  return {
    phase,
    seats,
    board: snap?.board ?? [],
    pot: snap?.pot ?? 0,
    button: snap?.button ?? -1,
    street: (snap?.street ?? Street.PreFlop) as Street,
    heroTurn,
    legal: heroTurn ? table!.legalActions(HERO) : [],
    toCall: heroTurn ? table!.toCall(HERO) : 0,
    minRaiseTo: heroTurn ? table!.minRaiseTo() : 0,
    currentBet: snap?.currentBet ?? 0,
    message,
    history,
    lastProof,
    newHand,
    act,
    heroSeat: HERO,
  };
}
