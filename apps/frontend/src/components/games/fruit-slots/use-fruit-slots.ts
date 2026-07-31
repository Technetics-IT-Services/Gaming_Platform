'use client';

/**
 * useFruitSlots — React binding to the FROZEN GameRuntime (Sprint 2).
 *
 * Owns the bet, spin lifecycle (with turbo / quick-stop / auto-spin), the visible
 * matrix + winning lines, history and provably-fair data. Money moves ONLY through
 * `runtime.placeBet` (frozen path → wallet/ledger/settlement). RG limits are enforced
 * by the platform; a blocked bet surfaces the runtime error.
 */
import { useCallback, useRef, useState } from 'react';

import type { IBetResult, IGameResult } from '@gaming-platform/types';
import { BetMode } from '@gaming-platform/types';

import { GameRuntime, type PlayerContext } from '@/runtime/game-runtime';
import { RuntimeEventName } from '@/runtime/event-bus';
import { createProviderSet } from '@/runtime/providers';

import { FRUIT_SLOTS_ENGINE_KEY, FruitSlotsEngine, defaultSlotConfig } from '@/games/fruit-slots/engine';
import { type SlotRecord, type SpinResult } from '@/games/fruit-slots/types';

const GAME_ID = 'fruit-slots';

export function useFruitSlots(player: PlayerContext = { playerId: 'demo-player', currency: 'INR' }) {
  const rtRef = useRef<GameRuntime | null>(null);
  const sessionRef = useRef<string | null>(null);
  const lastResultRef = useRef<IGameResult<SpinResult> | null>(null);
  const autoRef = useRef(false);

  const [totalBet, setTotalBet] = useState(20);
  const [turbo, setTurbo] = useState(false);
  const [sound, setSound] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [spin, setSpin] = useState<SpinResult | null>(null);
  const [lastWin, setLastWin] = useState(0);
  const [history, setHistory] = useState<(SlotRecord & { multiplier: number })[]>([]);
  const [error, setError] = useState<string | null>(null);

  const ensure = useCallback(async () => {
    if (!rtRef.current) {
      const rt = new GameRuntime(createProviderSet(), player);
      rt.registerEngine(new FruitSlotsEngine());
      rt.registerGame({ gameId: GAME_ID, name: 'Fruit Slots', engineKey: FRUIT_SLOTS_ENGINE_KEY, category: 'instant', capabilities: { cashOut: false, autoBet: true, multiBet: false, provablyFair: true, realtime: false, multiplayer: false, liveDealer: false, tournament: false }, config: { ...defaultSlotConfig(), minBet: 20, maxBet: 1_000_000, rewards: { winXp: 30, lossXp: 10 } } as never });
      rtRef.current = rt;
    }
    if (!sessionRef.current) {
      const session = await rtRef.current.createSession({ gameId: GAME_ID });
      sessionRef.current = session.sessionId;
      rtRef.current.subscribe(session.sessionId, (e) => {
        if (e.name === RuntimeEventName.ROUND_STARTED) {
          const r = (e.payload as { result?: IGameResult<SpinResult> }).result;
          if (r) lastResultRef.current = r;
        }
      });
    }
    return { rt: rtRef.current, sessionId: sessionRef.current! };
  }, [player]);

  const doSpin = useCallback(async (): Promise<IBetResult | null> => {
    setError(null);
    setSpinning(true);
    try {
      const { rt, sessionId } = await ensure();
      const res = await rt.placeBet({ gameId: GAME_ID, sessionId, stake: { amount: String(totalBet), currency: player.currency }, mode: BetMode.Single, selections: [{ pick: {} }], idempotencyKey: `slot-${Date.now()}`, clientSeed: 'player' });
      const result = lastResultRef.current;
      const s = result?.state;
      if (s) {
        // Turbo compresses the reel-stop delay; quick-stop is instant.
        await new Promise((r) => setTimeout(r, turbo ? 120 : 600));
        setSpin(s);
        setLastWin(Number(res.payout));
        const f = result?.fairness;
        setHistory((h) => [{ stops: s.stops, matrix: s.matrix, lineWins: s.lineWins, freeSpins: s.freeSpinsAwarded, totalUnits: s.totalUnits, win: Number(res.payout), multiplier: Number(res.multiplier), serverSeed: f?.serverSeed, serverSeedHash: f?.serverSeedHash, clientSeed: f?.clientSeed ?? 'player', nonce: f?.nonce ?? 0 }, ...h].slice(0, 50));
      }
      return res;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setSpinning(false);
    }
  }, [ensure, player.currency, totalBet, turbo]);

  const autoSpin = useCallback(async (rounds: number) => {
    autoRef.current = true;
    for (let i = 0; i < rounds && autoRef.current; i += 1) {
      const res = await doSpin();
      if (!res) break;
    }
    autoRef.current = false;
  }, [doSpin]);
  const stopAuto = useCallback(() => { autoRef.current = false; }, []);

  return { totalBet, setTotalBet, turbo, setTurbo, sound, setSound, spinning, spin, lastWin, history, error, doSpin, autoSpin, stopAuto };
}
