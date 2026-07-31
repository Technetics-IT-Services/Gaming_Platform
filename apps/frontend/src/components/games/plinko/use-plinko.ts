'use client';

/**
 * usePlinko — the React binding to the FROZEN GameRuntime (Sprint 1, STEP 4/6/7).
 *
 * Owns board selection (rows/risk), bet controls, the animated-drop lifecycle, the
 * history strip, the provably-fair panel data, and auto-play. It drives money ONLY
 * through `runtime.placeBet` (the frozen path → wallet/ledger/settlement); it never
 * settles or touches balances directly. Responsible-gaming limits are enforced by the
 * platform, not here — a blocked bet surfaces the runtime's error unchanged.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { IBetResult, IGameResult } from '@gaming-platform/types';
import { BetMode } from '@gaming-platform/types';

import { GameRuntime, type PlayerContext } from '@/runtime/game-runtime';
import { RuntimeEventName } from '@/runtime/event-bus';
import { createProviderSet } from '@/runtime/providers';

import { PlinkoAnimation, type Frame } from '@/games/plinko/animation';
import { PLINKO_DEFAULT, PLINKO_ENGINE_KEY, PlinkoEngine } from '@/games/plinko/engine';
import { plinkoTable } from '@/games/plinko/math';
import { AutoPlayController, type AutoPlayConfig } from '@/games/plinko/replay';
import { PLINKO_RISKS, PLINKO_ROWS, type PlinkoDropRecord, type PlinkoRisk, type PlinkoState } from '@/games/plinko/types';

const GAME_ID = 'plinko';

export interface PlinkoHistoryRow extends PlinkoDropRecord {
  stake: number;
  payout: number;
  outcome: string;
  at: number;
}

/** Build a self-contained runtime with the Plinko engine registered (frozen APIs only). */
function makeRuntime(player: PlayerContext): GameRuntime {
  const rt = new GameRuntime(createProviderSet(), player);
  rt.registerEngine(new PlinkoEngine());
  rt.registerGame({
    gameId: GAME_ID,
    name: 'Plinko',
    engineKey: PLINKO_ENGINE_KEY,
    category: 'instant',
    capabilities: { cashOut: false, autoBet: true, multiBet: false, provablyFair: true, realtime: false, multiplayer: false, liveDealer: false, tournament: false },
    config: { ...PLINKO_DEFAULT, minBet: 1, maxBet: 1_000_000, rewards: { winXp: 30, lossXp: 10 } },
  });
  return rt;
}

export function usePlinko(player: PlayerContext = { playerId: 'demo-player', currency: 'INR' }) {
  const runtimeRef = useRef<GameRuntime | null>(null);
  const sessionRef = useRef<string | null>(null);
  const nonceRef = useRef(0);
  /** The latest engine game-result, captured from the ROUND_STARTED event stream. */
  const lastGameResultRef = useRef<IGameResult<PlinkoState> | null>(null);

  const [rows, setRows] = useState<number>(PLINKO_DEFAULT.rows);
  const [risk, setRisk] = useState<PlinkoRisk>(PLINKO_DEFAULT.risk);
  const [stake, setStake] = useState(100);
  const [fast, setFast] = useState(false);
  const [sound, setSound] = useState(true);
  const [dropping, setDropping] = useState(false);
  const [ball, setBall] = useState<Frame | null>(null);
  const [lastResult, setLastResult] = useState<{ state: PlinkoState; result: IBetResult } | null>(null);
  const [history, setHistory] = useState<PlinkoHistoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const table = useMemo(() => plinkoTable(rows, risk), [rows, risk]);

  const ensureSession = useCallback(async () => {
    if (!runtimeRef.current) runtimeRef.current = makeRuntime(player);
    if (!sessionRef.current) {
      const session = await runtimeRef.current.createSession({ gameId: GAME_ID });
      sessionRef.current = session.sessionId;
      // Capture the engine's game result (path/state/fairness) from the event stream.
      runtimeRef.current.subscribe(session.sessionId, (event) => {
        if (event.name === RuntimeEventName.ROUND_STARTED) {
          const payload = event.payload as { result?: IGameResult<PlinkoState> };
          if (payload.result) lastGameResultRef.current = payload.result;
        }
      });
    }
    return { rt: runtimeRef.current, sessionId: sessionRef.current! };
  }, [player]);

  /** Animate the ball along a path, then resolve when it lands. */
  const animate = useCallback(
    (dirs: number[]) =>
      new Promise<void>((resolve) => {
        const anim = new PlinkoAnimation();
        anim.start(dirs, { fast });
        setDropping(true);
        const stepMs = fast ? 40 : 220;
        const iv = setInterval(() => {
          const frame = anim.tick();
          setBall(frame ?? null);
          if (anim.isDone()) {
            clearInterval(iv);
            setDropping(false);
            resolve();
          }
        }, stepMs);
      }),
    [fast],
  );

  /** Place one bet through the frozen runtime, then animate + record. */
  const drop = useCallback(async (): Promise<IBetResult | null> => {
    setError(null);
    try {
      const { rt, sessionId } = await ensureSession();
      nonceRef.current += 1;
      const res = await rt.placeBet({
        gameId: GAME_ID,
        sessionId,
        stake: { amount: String(stake), currency: player.currency },
        mode: BetMode.Single,
        selections: [{ pick: { rows, risk } }],
        idempotencyKey: `plinko-${Date.now()}-${nonceRef.current}`,
        clientSeed: 'player',
      });
      const gameResult = lastGameResultRef.current;
      const state = gameResult?.state;
      if (state) {
        await animate(state.dirs);
        setLastResult({ state, result: res });
        const f = gameResult?.fairness;
        setHistory((h) =>
          [
            {
              rows: state.rows,
              risk: state.risk,
              bin: state.bin,
              mult: state.mult,
              dirs: state.dirs,
              serverSeed: f?.serverSeed,
              serverSeedHash: f?.serverSeedHash,
              clientSeed: f?.clientSeed ?? 'player',
              nonce: f?.nonce ?? 0,
              stake,
              payout: Number(res.payout),
              outcome: res.outcome,
              at: Date.now(),
            },
            ...h,
          ].slice(0, 50),
        );
      }
      return res;
    } catch (e) {
      // Responsible-gaming / limit / balance errors from the frozen runtime surface here.
      setError((e as Error).message);
      setDropping(false);
      return null;
    }
  }, [animate, ensureSession, player.currency, risk, rows, stake]);

  /** Auto-play N rounds through the frozen runtime (pure controller decides stakes). */
  const autoPlay = useCallback(
    async (cfg: AutoPlayConfig) => {
      const controller = new AutoPlayController(cfg);
      let decision = controller.first();
      while (decision.proceed) {
        setStake(decision.stake);
        const res = await drop();
        if (!res) break; // blocked (limit) or error
        decision = controller.next(Number(res.netProfit));
      }
      return controller.cumulativeNet();
    },
    [drop],
  );

  // Reset the session on unmount so a remount starts a fresh runtime.
  useEffect(() => () => { sessionRef.current = null; runtimeRef.current = null; }, []);

  return {
    // board
    rows, setRows, risk, setRisk, table, rowsOptions: PLINKO_ROWS, riskOptions: PLINKO_RISKS,
    // controls
    stake, setStake, fast, setFast, sound, setSound,
    // lifecycle
    drop, autoPlay, dropping, ball, lastResult, history, error,
  };
}
