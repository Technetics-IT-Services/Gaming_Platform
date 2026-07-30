'use client';

import { Button, cn } from '@gaming-platform/ui';
import type { IBetRequest } from '@gaming-platform/types';
import { BetMode } from '@gaming-platform/types';
import { motion } from 'framer-motion';
import { Rocket, RotateCcw, TrendingUp, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { GameFx, type FxSignal } from '@/components/games/prototype/game-fx';
import { sound } from '@/lib/sound';
import type { CrashState } from '@/runtime';
import { useGameRuntime } from '@/runtime/react/use-game-runtime';
import { useDemoWallet } from '@/stores/demo-wallet';
import { useGameStats } from '@/stores/game-stats';

type Phase = 'idle' | 'countdown' | 'running' | 'crashed';
interface Pt {
  t: number;
  m: number;
}

const GROWTH = 0.00019; // multiplier growth per ms

export function CrashGame() {
  // The Runtime (Phase 2.2) owns bet/RNG/settlement/history; the UI only renders
  // and collects intent. Demo providers delegate to these same stores, so balance
  // + stats + history surfaces are unchanged.
  const { runtime, session } = useGameRuntime('crash');
  const balance = useDemoWallet((s) => s.balance);
  const stat = useGameStats((s) => s.games.crash);

  const [phase, setPhase] = useState<Phase>('idle');
  const [bet, setBet] = useState(100);
  const [autoCashout, setAutoCashout] = useState<number | ''>(2);
  const [mult, setMult] = useState(1);
  const [countdown, setCountdown] = useState(3);
  const [cashedAt, setCashedAt] = useState<number | null>(null);
  const [result, setResult] = useState<{ win: boolean; payout: number } | null>(null);
  const [points, setPoints] = useState<Pt[]>([{ t: 0, m: 1 }]);
  const [fx, setFx] = useState<FxSignal>({ key: 0, type: null });
  const [shake, setShake] = useState(false);

  const raf = useRef(0);
  const startRef = useRef(0);
  const bustRef = useRef(0);
  const cashedRef = useRef<number | null>(null);
  const roundIdRef = useRef<string | null>(null);
  const settledRef = useRef(false);
  const winPayoutRef = useRef(0);
  const lastSampleRef = useRef(0);
  const fxKeyRef = useRef(0);

  const cleanup = () => cancelAnimationFrame(raf.current);
  useEffect(() => cleanup, []);

  /** Cash out the live round through the Runtime (the win is settled + credited here). */
  const doCashOut = useCallback(
    (atMult: number) => {
      if (settledRef.current || cashedRef.current !== null || !roundIdRef.current) return;
      cashedRef.current = atMult;
      settledRef.current = true;
      setCashedAt(atMult);
      sound.play('cashout');
      void runtime
        .cashOut({ roundId: roundIdRef.current, atMultiplier: atMult })
        .then((res) => {
          winPayoutRef.current = Number(res.payout);
        })
        .catch(() => {
          winPayoutRef.current = Math.round(bet * atMult);
        });
    },
    [runtime, bet],
  );

  const tick = useCallback(() => {
    const elapsed = performance.now() - startRef.current;
    const m = Math.exp(GROWTH * elapsed);
    const bust = bustRef.current;

    // auto cash-out
    if (cashedRef.current === null && typeof autoCashout === 'number' && autoCashout > 1 && m >= autoCashout && autoCashout < bust) {
      doCashOut(autoCashout);
      toast.success(`Auto cashed out at ${autoCashout.toFixed(2)}×`);
    }

    if (m >= bust) {
      setMult(bust);
      setPhase('crashed');
      setShake(true);
      window.setTimeout(() => setShake(false), 500);
      sound.play('explosion');
      if (cashedRef.current !== null) {
        // Win was settled + credited at cash-out; just present the result.
        const payout = winPayoutRef.current || Math.round(bet * cashedRef.current);
        setResult({ win: true, payout });
        fxKeyRef.current += 1;
        setFx({ key: fxKeyRef.current, type: 'win', amount: payout - bet });
        sound.play('reward');
      } else {
        // Loss — settle through the Runtime (records history + stats).
        setResult({ win: false, payout: -bet });
        if (roundIdRef.current) {
          void runtime.finishRound({ roundId: roundIdRef.current, finalMultiplier: bust }).catch(() => {});
        }
      }
      cleanup();
      return;
    }

    setMult(m);
    if (elapsed - lastSampleRef.current > 40) {
      lastSampleRef.current = elapsed;
      setPoints((p) => [...p, { t: elapsed, m }].slice(-260));
    }
    raf.current = requestAnimationFrame(tick);
  }, [autoCashout, doCashOut, runtime, bet]);

  const beginRun = useCallback(() => {
    setPhase('running');
    startRef.current = performance.now();
    lastSampleRef.current = 0;
    setPoints([{ t: 0, m: 1 }]);
    sound.play('rocket');
    raf.current = requestAnimationFrame(tick);
  }, [tick]);

  const launch = useCallback(() => {
    if (phase === 'running' || phase === 'countdown') return;
    if (!session) {
      toast.error('Starting session… try again in a moment.');
      return;
    }
    const stake = Math.max(1, Math.floor(bet));
    if (stake > balance) {
      toast.error('Not enough demo coins — hit reload in the balance pill.');
      return;
    }
    const betReq: IBetRequest<number> = {
      gameId: 'crash',
      sessionId: session.sessionId,
      stake: { amount: String(stake), currency: 'INR' },
      mode: BetMode.Single,
      selections: [{ pick: typeof autoCashout === 'number' ? autoCashout : 0 }],
      idempotencyKey: `crash:${session.sessionId}:${stat.seq}:${stake}`,
      clientSeed: 'demo',
    };
    cashedRef.current = null;
    settledRef.current = false;
    winPayoutRef.current = 0;
    setCashedAt(null);
    setResult(null);
    setMult(1);
    // Runtime: validate → debit → engine (provably-fair bust). UI animates to it.
    void runtime
      .startRound<CrashState>(betReq)
      .then(({ result, roundId }) => {
        roundIdRef.current = roundId;
        bustRef.current = result.state.crashPoint;
        setPhase('countdown');
        setCountdown(3);
      })
      .catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : 'Could not place bet.');
      });
  }, [phase, bet, balance, session, runtime, autoCashout, stat.seq]);

  // countdown driver
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown <= 0) {
      beginRun();
      return;
    }
    sound.play('countdown');
    const id = window.setTimeout(() => setCountdown((c) => c - 1), 700);
    return () => window.clearTimeout(id);
  }, [phase, countdown, beginRun]);

  const cashOut = () => {
    if (phase !== 'running' || cashedRef.current !== null) return;
    doCashOut(mult);
    toast.success(`Cashed out at ${mult.toFixed(2)}×`);
  };

  // graph geometry
  const tMax = Math.max(4000, ...points.map((p) => p.t)) * 1.05;
  const mMax = Math.max(2, mult * 1.15);
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(p.t / tMax) * 100} ${100 - ((p.m - 1) / (mMax - 1)) * 96}`)
    .join(' ');
  const tip = points[points.length - 1] ?? { t: 0, m: 1 };
  const tipX = (tip.t / tMax) * 100;
  const tipY = 100 - ((tip.m - 1) / (mMax - 1)) * 96;

  const running = phase === 'running';
  const color = phase === 'crashed' && !result?.win ? 'text-destructive' : cashedAt ? 'text-emerald' : 'text-primary';

  return (
    <div className="grid gap-4 lg:gap-6 lg:grid-cols-[2.2fr_1fr] xl:grid-cols-[2.5fr_1fr]">
      {/* Stage */}
      <div
        className={cn(
          'card-premium relative aspect-[16/10] overflow-hidden p-0 transition-transform',
          shake && 'animate-[shake_0.4s_ease]',
        )}
      >
        <GameFx trigger={fx} />
        {/* graph bg */}
        <div className="absolute inset-0 bg-gradient-to-b from-white to-primary/5" />
        <div className="bg-grid absolute inset-0 opacity-40" />

        {/* SVG multiplier graph */}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <defs>
            <linearGradient id="crashLine" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="hsl(263 85% 60%)" />
              <stop offset="100%" stopColor="hsl(326 82% 60%)" />
            </linearGradient>
            <linearGradient id="crashFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(263 85% 60% / 0.28)" />
              <stop offset="100%" stopColor="hsl(263 85% 60% / 0)" />
            </linearGradient>
          </defs>
          {points.length > 1 ? (
            <>
              <path d={`${path} L ${tipX} 100 L 0 100 Z`} fill="url(#crashFill)" />
              <path d={path} fill="none" stroke="url(#crashLine)" strokeWidth={running ? 1.4 : 1} strokeLinecap="round" />
            </>
          ) : null}
        </svg>

        {/* rocket at the tip */}
        {(running || phase === 'crashed') && points.length > 1 ? (
          <div
            className="absolute z-10"
            style={{ left: `${tipX}%`, top: `${tipY}%`, transform: 'translate(-50%,-50%)' }}
          >
            {phase === 'crashed' && !result?.win ? (
              <motion.div initial={{ scale: 0 }} animate={{ scale: [0, 1.6, 0] }} transition={{ duration: 0.5 }}>
                <Zap className="h-10 w-10 text-destructive drop-shadow" />
              </motion.div>
            ) : (
              <Rocket className={cn('h-8 w-8 -rotate-12 text-primary drop-shadow-[0_0_10px_hsl(263_85%_60%)]', running && 'animate-pulse')} />
            )}
          </div>
        ) : null}

        {/* center readout */}
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center">
          {phase === 'countdown' ? (
            <motion.div key={countdown} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="font-display text-7xl font-bold text-primary">
              {countdown === 0 ? 'GO!' : countdown}
            </motion.div>
          ) : phase === 'idle' ? (
            <div className="text-center">
              <Rocket className="mx-auto mb-2 h-10 w-10 animate-float text-primary" />
              <p className="font-display text-lg font-bold">Place your bet & launch</p>
              <p className="text-sm text-muted-foreground">Cash out before the rocket busts</p>
            </div>
          ) : (
            <motion.div
              animate={{ scale: running ? [1, 1.04, 1] : 1 }}
              transition={{ duration: 0.6, repeat: running ? Infinity : 0 }}
              className={cn('font-display text-6xl font-bold tabular-nums sm:text-7xl', color, running && 'text-glow')}
            >
              {mult.toFixed(2)}×
            </motion.div>
          )}
          {phase === 'crashed' ? (
            <p className={cn('mt-2 font-display text-lg font-bold', result?.win ? 'text-emerald' : 'text-destructive')}>
              {result?.win ? `You won +${(result.payout - bet).toLocaleString('en-US')}` : `Busted at ${mult.toFixed(2)}×`}
            </p>
          ) : null}
        </div>

        {/* recent multipliers */}
        <div className="absolute left-3 top-3 z-10 flex gap-1">
          {stat.history.slice(0, 6).map((r) => (
            <span
              key={r.id}
              className={cn('rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold', r.value >= 2 ? 'bg-emerald/15 text-emerald' : 'bg-destructive/15 text-destructive')}
            >
              {r.label}
            </span>
          ))}
        </div>
      </div>

      {/* Controls + stats */}
      <div className="space-y-4">
        <div className="card-premium space-y-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-muted-foreground">
              Bet amount
              <div className="mt-1 flex items-center rounded-xl border border-black/10 bg-white/70 px-2">
                <input
                  type="number"
                  min={1}
                  value={bet}
                  onChange={(e) => setBet(Math.max(1, Number(e.target.value)))}
                  disabled={running || phase === 'countdown'}
                  className="h-10 w-full bg-transparent font-mono text-sm outline-none"
                />
                <button onClick={() => setBet((b) => Math.max(1, Math.floor(b / 2)))} className="px-1 text-xs text-muted-foreground hover:text-foreground">½</button>
                <button onClick={() => setBet((b) => b * 2)} className="px-1 text-xs text-muted-foreground hover:text-foreground">2×</button>
              </div>
            </label>
            <label className="text-xs font-semibold text-muted-foreground">
              Auto cash-out
              <div className="mt-1 flex items-center rounded-xl border border-black/10 bg-white/70 px-2">
                <input
                  type="number"
                  min={1.01}
                  step={0.1}
                  value={autoCashout}
                  onChange={(e) => setAutoCashout(e.target.value === '' ? '' : Math.max(1.01, Number(e.target.value)))}
                  disabled={running || phase === 'countdown'}
                  className="h-10 w-full bg-transparent font-mono text-sm outline-none"
                  placeholder="off"
                />
                <span className="text-xs text-muted-foreground">×</span>
              </div>
            </label>
          </div>

          {running && cashedRef.current === null ? (
            <Button variant="gold" size="lg" className="w-full sheen text-base" onClick={cashOut}>
              Cash Out {mult.toFixed(2)}× · +{Math.round(bet * mult).toLocaleString('en-US')}
            </Button>
          ) : phase === 'idle' || phase === 'crashed' ? (
            <div className="flex gap-2">
              <Button variant="gradient" size="lg" className="w-full sheen" onClick={() => launch()}>
                <Rocket className="h-5 w-5" /> Launch · {bet.toLocaleString('en-US')}
              </Button>
              {phase === 'crashed' ? (
                <Button variant="glass" size="lg" onClick={() => launch()} title="Play again">
                  <RotateCcw className="h-5 w-5" />
                </Button>
              ) : null}
            </div>
          ) : (
            <Button variant="glass" size="lg" className="w-full" disabled>
              {phase === 'countdown' ? 'Launching…' : cashedAt ? `Locked ${cashedAt.toFixed(2)}×` : 'In flight…'}
            </Button>
          )}
          {[100, 500, 1000, 5000].map((v) => (
            <button
              key={v}
              onClick={() => setBet(v)}
              disabled={running || phase === 'countdown'}
              className="mr-1.5 rounded-lg bg-black/[0.04] px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
            >
              {v.toLocaleString('en-US')}
            </button>
          ))}
        </div>

        {/* stats */}
        <div className="card-premium grid grid-cols-2 gap-3 p-4 text-center">
          <Stat icon={<TrendingUp className="h-4 w-4 text-emerald" />} label="Highest" value={`${stat.highest.toFixed(2)}×`} />
          <Stat icon={<Zap className="h-4 w-4 text-gold" />} label="Best streak" value={String(stat.bestStreak)} />
          <Stat label="Rounds" value={String(stat.rounds)} />
          <Stat label="Biggest win" value={`+${stat.biggestWin.toLocaleString('en-US')}`} />
        </div>

        <div className="card-premium p-4">
          <p className="mb-2 flex items-center gap-2 font-display text-sm font-bold">History</p>
          <div className="flex flex-wrap gap-1.5">
            {stat.history.slice(0, 14).map((r) => (
              <span key={r.id} className={cn('rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold', r.value >= 2 ? 'bg-emerald/15 text-emerald' : 'bg-destructive/15 text-destructive')}>
                {r.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-black/[0.03] p-2">
      <div className="flex items-center justify-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 font-display text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}
