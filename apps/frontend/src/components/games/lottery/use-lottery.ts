'use client';

/**
 * useLottery — React binding to the FROZEN interactive GameRuntime + the reusable
 * Scheduled Draw Engine (Sprint 4).
 *
 * Buying a ticket runs `startInteractive` (debit the ticket price); when the scheduled
 * draw fires, the draw numbers are derived provably-fair and each held ticket is settled
 * via `submitAction` (frozen path → wallet/ledger/settlement). Money never moves outside
 * the frozen runtime; RG limits are enforced by the platform.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { IGameResult, IStepResult } from '@gaming-platform/types';
import { BetMode } from '@gaming-platform/types';

import { GameRuntime, type PlayerContext } from '@/runtime/game-runtime';
import { RuntimeEventName } from '@/runtime/event-bus';
import { createProviderSet } from '@/runtime/providers';
import { DemoProvablyFairProvider } from '@/runtime/providers/provably-fair';

import { ScheduledDrawEngine } from '@/games/lottery/draw-engine';
import { LOTTERY_DEFAULT, LOTTERY_ENGINE_KEY, NumberLotteryEngine } from '@/games/lottery/engine';
import { type DrawResult, type LotteryRecord, type LotteryState, type PrizeTier, type TicketPick } from '@/games/lottery/types';

const GAME_ID = 'lottery';
const TICKET_PRICE = 2;

interface HeldTicket {
  roundId: string;
  numbers: number[];
  quickPick: boolean;
}

export function useLottery(player: PlayerContext = { playerId: 'demo-player', currency: 'INR' }) {
  const rtRef = useRef<GameRuntime | null>(null);
  const sessionRef = useRef<string | null>(null);
  const drawEngineRef = useRef<ScheduledDrawEngine | null>(null);
  const drawPfRef = useRef(new DemoProvablyFairProvider());
  const lastResultRef = useRef<IGameResult<LotteryState> | null>(null);
  const drawNonceRef = useRef(1);

  const [selected, setSelected] = useState<number[]>([]);
  const [tickets, setTickets] = useState<HeldTicket[]>([]);
  const [drawAt, setDrawAt] = useState<number>(() => Date.now() + 30_000);
  const [now, setNow] = useState<number>(() => Date.now());
  const [winning, setWinning] = useState<DrawResult | null>(null);
  const [history, setHistory] = useState<(LotteryRecord & { multiplier: number })[]>([]);
  const [error, setError] = useState<string | null>(null);

  const range = LOTTERY_DEFAULT.range;
  const pick = LOTTERY_DEFAULT.pick;
  const countdownMs = Math.max(0, drawAt - now);

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(iv);
  }, []);

  const toggle = useCallback((n: number) => {
    setSelected((s) => (s.includes(n) ? s.filter((x) => x !== n) : s.length < pick ? [...s, n].sort((a, b) => a - b) : s));
  }, [pick]);
  const clearPick = useCallback(() => setSelected([]), []);

  const ensure = useCallback(async () => {
    if (!rtRef.current) {
      const rt = new GameRuntime(createProviderSet(), player);
      rt.registerEngine(new NumberLotteryEngine());
      rt.registerGame({ gameId: GAME_ID, name: 'Number Lottery', engineKey: LOTTERY_ENGINE_KEY, category: 'instant', capabilities: { cashOut: false, autoBet: true, multiBet: false, provablyFair: true, realtime: false, multiplayer: true, liveDealer: false, tournament: false }, config: { ...LOTTERY_DEFAULT, minBet: 1, maxBet: 1_000_000, rewards: { winXp: 40, lossXp: 5 } } as never });
      rtRef.current = rt;
      drawEngineRef.current = new ScheduledDrawEngine({ drawMain: LOTTERY_DEFAULT.drawMain, range, bonus: LOTTERY_DEFAULT.bonus });
      drawEngineRef.current.schedule('current', drawAt, { closeBeforeMs: 2_000 });
    }
    if (!sessionRef.current) {
      const session = await rtRef.current.createSession({ gameId: GAME_ID });
      sessionRef.current = session.sessionId;
      rtRef.current.subscribe(session.sessionId, (e) => {
        if (e.name === RuntimeEventName.STEP_STARTED || e.name === RuntimeEventName.ROUND_STARTED) {
          const r = (e.payload as { result?: IGameResult<LotteryState> }).result;
          if (r) lastResultRef.current = r;
        }
      });
    }
    return { rt: rtRef.current, sessionId: sessionRef.current! };
  }, [drawAt, player, range]);

  /** Buy one ticket (manual selection or quick pick). */
  const buyTicket = useCallback(async (quick: boolean) => {
    if (!quick && selected.length !== pick) { setError(`Pick exactly ${pick} numbers.`); return; }
    setError(null);
    try {
      const { rt, sessionId } = await ensure();
      const ticketPick: TicketPick = quick ? { quickPick: true, drawId: 'current' } : { numbers: selected, drawId: 'current' };
      const { roundId, step } = await rt.startInteractive<LotteryState>({ gameId: GAME_ID, sessionId, stake: { amount: String(TICKET_PRICE), currency: player.currency }, mode: BetMode.Single, selections: [{ pick: ticketPick }], idempotencyKey: `lot-${Date.now()}-${tickets.length}`, clientSeed: 'player' });
      drawEngineRef.current!.addTicket('current', { ticketId: roundId, roundId });
      setTickets((t) => [...t, { roundId, numbers: step.gameState.numbers, quickPick: step.gameState.quickPick }]);
      if (!quick) clearPick();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [clearPick, ensure, pick, player.currency, selected, tickets.length]);

  /** Fire the scheduled draw: derive winning numbers, settle every held ticket. */
  const runDraw = useCallback(async () => {
    if (!rtRef.current || tickets.length === 0) return;
    setError(null);
    const drawFairness = { serverSeed: `draw-${drawNonceRef.current}`, serverSeedHash: '', clientSeed: 'draw-client', nonce: drawNonceRef.current };
    drawNonceRef.current += 1;
    const engine = drawEngineRef.current!;
    // Force execution now (demo): pretend the draw time has arrived.
    const exec = engine.execute(drawPfRef.current, 'current', drawFairness, drawAt + 1);
    setWinning(exec.result);

    for (const tkt of tickets) {
      const settled: IStepResult<LotteryState> = await rtRef.current.submitAction<LotteryState>({ roundId: tkt.roundId, action: { type: 'draw', payload: drawFairness } });
      const s = settled.gameState;
      const f = lastResultRef.current?.fairness;
      setHistory((h) => [{ numbers: s.numbers, quickPick: s.quickPick, drawId: s.drawId, draw: s.draw, tier: (s.tier ?? null) as PrizeTier | null, prize: Math.round(TICKET_PRICE * (s.prizeMultiplier ?? 0)), multiplier: s.prizeMultiplier ?? 0, serverSeed: f?.serverSeed, serverSeedHash: f?.serverSeedHash, clientSeed: f?.clientSeed ?? 'player', nonce: f?.nonce ?? 0 }, ...h].slice(0, 50));
    }
    // Schedule the next draw.
    setTickets([]);
    const next = Date.now() + 30_000;
    setDrawAt(next);
    engine.schedule('current', next, { closeBeforeMs: 2_000 });
  }, [drawAt, tickets]);

  return { range, pick, ticketPrice: TICKET_PRICE, selected, toggle, clearPick, buyTicket, tickets, countdownMs, winning, runDraw, history, error };
}
