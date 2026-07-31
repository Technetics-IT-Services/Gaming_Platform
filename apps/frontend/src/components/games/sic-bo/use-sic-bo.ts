'use client';

/**
 * useSicBo — React binding to the FROZEN GameRuntime (Sprint 3).
 *
 * Owns the betting board (chips placed per bet), the roll lifecycle (animated dice
 * reveal), winning-bet highlights, history and provably-fair data. Money moves ONLY
 * through `runtime.placeBet` with one selection per placed bet (frozen path →
 * wallet/ledger/settlement). RG limits are enforced by the platform.
 */
import { useCallback, useRef, useState } from 'react';

import type { IBetResult, IGameResult } from '@gaming-platform/types';
import { BetMode } from '@gaming-platform/types';

import { GameRuntime, type PlayerContext } from '@/runtime/game-runtime';
import { RuntimeEventName } from '@/runtime/event-bus';
import { createProviderSet } from '@/runtime/providers';

import { SIC_BO_ENGINE_KEY, SicBoEngine } from '@/games/sic-bo/engine';
import { oddsFor } from '@/games/sic-bo/paytable';
import { type Bet, type Dice, type PlacedBet, type SicBoRecord, type SicBoState } from '@/games/sic-bo/types';

const GAME_ID = 'sic-bo';

export function betKey(bet: Bet): string {
  return `${bet.type}:${Array.isArray(bet.value) ? bet.value.join('-') : bet.value ?? ''}`;
}

export function useSicBo(player: PlayerContext = { playerId: 'demo-player', currency: 'INR' }) {
  const rtRef = useRef<GameRuntime | null>(null);
  const sessionRef = useRef<string | null>(null);
  const lastResultRef = useRef<IGameResult<SicBoState> | null>(null);

  const [chip, setChip] = useState(10);
  const [placed, setPlaced] = useState<Map<string, PlacedBet>>(new Map());
  const [rolling, setRolling] = useState(false);
  const [dice, setDice] = useState<Dice | null>(null);
  const [lastState, setLastState] = useState<SicBoState | null>(null);
  const [history, setHistory] = useState<(SicBoRecord & { multiplier: number })[]>([]);
  const [error, setError] = useState<string | null>(null);

  const totalStake = [...placed.values()].reduce((s, p) => s + p.amount, 0);

  const place = useCallback((bet: Bet) => {
    setPlaced((m) => {
      const next = new Map(m);
      const key = betKey(bet);
      const existing = next.get(key);
      next.set(key, { ...bet, amount: (existing?.amount ?? 0) + chip });
      return next;
    });
  }, [chip]);
  const clear = useCallback(() => setPlaced(new Map()), []);
  const oddsOf = useCallback((bet: Bet) => oddsFor(bet), []);

  const ensure = useCallback(async () => {
    if (!rtRef.current) {
      const rt = new GameRuntime(createProviderSet(), player);
      rt.registerEngine(new SicBoEngine());
      rt.registerGame({ gameId: GAME_ID, name: 'Sic Bo', engineKey: SIC_BO_ENGINE_KEY, category: 'instant', capabilities: { cashOut: false, autoBet: true, multiBet: true, provablyFair: true, realtime: false, multiplayer: false, liveDealer: false, tournament: false }, config: { minBet: 1, maxBet: 1_000_000, rewards: { winXp: 30, lossXp: 10 } } });
      rtRef.current = rt;
    }
    if (!sessionRef.current) {
      const session = await rtRef.current.createSession({ gameId: GAME_ID });
      sessionRef.current = session.sessionId;
      rtRef.current.subscribe(session.sessionId, (e) => {
        if (e.name === RuntimeEventName.ROUND_STARTED) {
          const r = (e.payload as { result?: IGameResult<SicBoState> }).result;
          if (r) lastResultRef.current = r;
        }
      });
    }
    return { rt: rtRef.current, sessionId: sessionRef.current! };
  }, [player]);

  const roll = useCallback(async (): Promise<IBetResult | null> => {
    if (placed.size === 0) { setError('Place at least one bet.'); return null; }
    setError(null);
    setRolling(true);
    try {
      const { rt, sessionId } = await ensure();
      const bets = [...placed.values()];
      const res = await rt.placeBet<PlacedBet>({ gameId: GAME_ID, sessionId, stake: { amount: String(totalStake), currency: player.currency }, mode: BetMode.Single, selections: bets.map((b) => ({ pick: b })), idempotencyKey: `sicbo-${Date.now()}`, clientSeed: 'player' });
      const result = lastResultRef.current;
      const s = result?.state;
      if (s) {
        await new Promise((r) => setTimeout(r, 700)); // dice cup shake
        setDice(s.dice);
        setLastState(s);
        const f = result?.fairness;
        setHistory((h) => [{ dice: s.dice, bets, winningBets: s.results.filter((r) => r.won), totalStake: s.totalStake, totalPayout: s.totalPayout, multiplier: Number(res.multiplier), serverSeed: f?.serverSeed, serverSeedHash: f?.serverSeedHash, clientSeed: f?.clientSeed ?? 'player', nonce: f?.nonce ?? 0 }, ...h].slice(0, 50));
      }
      return res;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setRolling(false);
    }
  }, [ensure, placed, player.currency, totalStake]);

  return { chip, setChip, placed, totalStake, place, clear, oddsOf, roll, rolling, dice, lastState, history, error };
}
