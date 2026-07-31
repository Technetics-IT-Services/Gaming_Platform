'use client';

/**
 * useHiLo — React binding to the FROZEN interactive GameRuntime (Sprint 2).
 *
 * Owns the bet, the running round (start → predict → cash-out / bust), the running
 * multiplier + offered odds, history and provably-fair data. Money moves ONLY through
 * `startInteractive` / `submitAction` (frozen path → wallet/ledger/settlement). RG
 * limits are enforced by the platform — a blocked bet surfaces the runtime error.
 */
import { useCallback, useRef, useState } from 'react';

import type { IGameResult, IStepResult } from '@gaming-platform/types';
import { BetMode, RuntimeState } from '@gaming-platform/types';

import { GameRuntime, type PlayerContext } from '@/runtime/game-runtime';
import { RuntimeEventName } from '@/runtime/event-bus';
import { createProviderSet } from '@/runtime/providers';

import { HILO_ENGINE_KEY, HiLoEngine } from '@/games/hilo/engine';
import { HILO_DEFAULT, type HiLoDirection, type HiLoRecord, type HiLoState } from '@/games/hilo/types';

const GAME_ID = 'hilo';

export function useHiLo(player: PlayerContext = { playerId: 'demo-player', currency: 'INR' }) {
  const rtRef = useRef<GameRuntime | null>(null);
  const sessionRef = useRef<string | null>(null);
  const roundRef = useRef<string | null>(null);
  const lastResultRef = useRef<IGameResult<HiLoState> | null>(null);

  const [stake, setStake] = useState(100);
  const [fast, setFast] = useState(false);
  const [sound, setSound] = useState(true);
  const [state, setState] = useState<HiLoState | null>(null);
  const [inRound, setInRound] = useState(false);
  const [history, setHistory] = useState<(HiLoRecord & { payout: number; won: boolean })[]>([]);
  const [error, setError] = useState<string | null>(null);

  const ensure = useCallback(async () => {
    if (!rtRef.current) {
      const rt = new GameRuntime(createProviderSet(), player);
      rt.registerEngine(new HiLoEngine());
      rt.registerGame({ gameId: GAME_ID, name: 'Hi-Lo', engineKey: HILO_ENGINE_KEY, category: 'instant', capabilities: { cashOut: true, autoBet: true, multiBet: false, provablyFair: true, realtime: false, multiplayer: false, liveDealer: false, tournament: false }, config: { ...HILO_DEFAULT, minBet: 1, maxBet: 1_000_000, rewards: { winXp: 30, lossXp: 10 } } as never });
      rtRef.current = rt;
    }
    if (!sessionRef.current) {
      const session = await rtRef.current.createSession({ gameId: GAME_ID });
      sessionRef.current = session.sessionId;
      rtRef.current.subscribe(session.sessionId, (e) => {
        if (e.name === RuntimeEventName.ROUND_STARTED || e.name === RuntimeEventName.STEP_STARTED) {
          const r = (e.payload as { result?: IGameResult<HiLoState> }).result;
          if (r) lastResultRef.current = r;
        }
      });
    }
    return { rt: rtRef.current, sessionId: sessionRef.current! };
  }, [player]);

  const deal = useCallback(async () => {
    setError(null);
    try {
      const { rt, sessionId } = await ensure();
      const { roundId, step } = await rt.startInteractive<HiLoState>({ gameId: GAME_ID, sessionId, stake: { amount: String(stake), currency: player.currency }, mode: BetMode.Single, selections: [{ pick: {} }], idempotencyKey: `hilo-${Date.now()}`, clientSeed: 'player' });
      roundRef.current = roundId;
      setState(step.gameState);
      setInRound(step.state === RuntimeState.AwaitingPlayer);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [ensure, player.currency, stake]);

  const finish = useCallback((step: IStepResult<HiLoState>) => {
    setState(step.gameState);
    if (step.state === RuntimeState.Completed) {
      setInRound(false);
      roundRef.current = null;
      const f = lastResultRef.current?.fairness;
      const s = step.gameState;
      const won = !s.busted;
      setHistory((h) => [{ cards: s.revealed, predictions: [], multiplier: s.multiplier, cashed: !!s.cashed, serverSeed: f?.serverSeed, serverSeedHash: f?.serverSeedHash, clientSeed: f?.clientSeed ?? 'player', nonce: f?.nonce ?? 0, payout: won ? Math.round(stake * s.multiplier) : 0, won }, ...h].slice(0, 50));
    }
  }, [stake]);

  const predict = useCallback(async (direction: HiLoDirection) => {
    if (!rtRef.current || !roundRef.current) return;
    setError(null);
    try {
      finish(await rtRef.current.submitAction<HiLoState>({ roundId: roundRef.current, action: { type: direction } }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [finish]);

  const cashout = useCallback(async () => {
    if (!rtRef.current || !roundRef.current) return;
    try {
      finish(await rtRef.current.submitAction<HiLoState>({ roundId: roundRef.current, action: { type: 'cashout' } }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [finish]);

  return { stake, setStake, fast, setFast, sound, setSound, state, inRound, history, error, deal, predict, cashout };
}
