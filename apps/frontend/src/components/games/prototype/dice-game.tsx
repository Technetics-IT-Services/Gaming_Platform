'use client';

import { Badge, Button, cn } from '@gaming-platform/ui';
import type { IBetRequest } from '@gaming-platform/types';
import { BetMode } from '@gaming-platform/types';
import { motion } from 'framer-motion';
import { Dice5, Percent, RotateCcw, Sparkles, Target, TrendingUp, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { GameFx, type FxSignal } from '@/components/games/prototype/game-fx';
import { diceChance, diceMultiplier, type DicePick, type DiceState } from '@/games/dice-engine';
import { sound } from '@/lib/sound';
import { useGameRuntime } from '@/runtime/react/use-game-runtime';
import { useDemoWallet } from '@/stores/demo-wallet';
import { useGameStats } from '@/stores/game-stats';

type Direction = 'over' | 'under';

const MIN_TARGET = 2;
const MAX_TARGET = 98;
const ROLL_MS = 900;

/** Cosmetic wobble for the spinning number — animation only, NOT the game outcome
 * (the outcome comes from the runtime's provably-fair Dice engine). */
function wobbleRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function DiceGame() {
  // The Runtime owns bet/RNG/settlement/history; the UI only renders + collects
  // intent. Demo providers delegate to these same stores, so balance/stats/history
  // surfaces are unchanged.
  const { runtime, session } = useGameRuntime('dice');
  const balance = useDemoWallet((s) => s.balance);
  const stat = useGameStats((s) => s.games.dice);

  const [bet, setBet] = useState(100);
  const [target, setTarget] = useState(50);
  const [dir, setDir] = useState<Direction>('over');
  const [rolling, setRolling] = useState(false);
  const [display, setDisplay] = useState(0); // animated big number
  const [settled, setSettled] = useState<number | null>(null); // final result
  const [result, setResult] = useState<{ win: boolean; payout: number; roll: number } | null>(null);
  const [auto, setAuto] = useState(false);
  const [fx, setFx] = useState<FxSignal>({ key: 0, type: null });

  const raf = useRef(0);
  const bounceRef = useRef(0);
  const autoRef = useRef(0);
  const seedRef = useRef(1);
  const fxKeyRef = useRef(0);
  const autoOn = useRef(false);

  const cleanup = useCallback(() => {
    cancelAnimationFrame(raf.current);
    window.clearTimeout(bounceRef.current);
    window.clearTimeout(autoRef.current);
  }, []);
  useEffect(() => cleanup, [cleanup]);

  const chance = diceChance(target, dir);
  const mult = diceMultiplier(target, dir);
  const stake = Math.max(1, Math.floor(bet));
  const potential = Math.round(stake * mult);

  /** Present the outcome + settle through the Runtime (win → cashOut, loss → finish). */
  const settle = useCallback(
    (roll: number, win: boolean, m: number, s: number, roundId: string) => {
      if (win) {
        const payout = Math.round(s * m);
        setResult({ win: true, payout, roll });
        fxKeyRef.current += 1;
        setFx({ key: fxKeyRef.current, type: 'win', amount: payout - s });
        sound.play('reward');
        // Runtime settles the win: credit + bet-history + stats (label = the roll).
        void runtime.cashOut({ roundId, atMultiplier: m }).catch(() => {});
      } else {
        setResult({ win: false, payout: -s, roll });
        setFx({ key: fxKeyRef.current, type: 'lose' });
        sound.play('lose');
        void runtime.finishRound({ roundId, finalMultiplier: 0 }).catch(() => {});
      }
    },
    [runtime],
  );

  const animateTo = useCallback(
    (roll: number, win: boolean, m: number, s: number, roundId: string, duration: number) => {
      const start = performance.now();
      const from = 0;
      sound.play('diceRoll');
      window.clearTimeout(bounceRef.current);
      bounceRef.current = window.setTimeout(() => sound.play('diceBounce'), Math.max(0, duration - 180));
      const step = () => {
        const elapsed = performance.now() - start;
        const p = Math.min(1, elapsed / duration);
        // ease-out cubic, with a little jitter while spinning
        const eased = 1 - Math.pow(1 - p, 3);
        const jitter = p < 0.85 ? (wobbleRng(Math.floor(elapsed) ^ seedRef.current)() - 0.5) * (1 - p) * 24 : 0;
        const v = Math.max(0, Math.min(99.99, from + (roll - from) * eased + jitter));
        setDisplay(v);
        if (p < 1) {
          raf.current = requestAnimationFrame(step);
          return;
        }
        setDisplay(roll);
        setSettled(roll);
        setRolling(false);
        settle(roll, win, m, s, roundId);
      };
      raf.current = requestAnimationFrame(step);
    },
    [settle],
  );

  const roll = useCallback(
    (opts?: { instant?: boolean }) => {
      if (rolling) return;
      const s = Math.max(1, Math.floor(bet));
      if (!session) {
        toast.error('Starting session… try again in a moment.');
        return;
      }
      if (s > balance) {
        toast.error('Not enough demo coins — hit reload in the balance pill.');
        autoOn.current = false;
        setAuto(false);
        return;
      }
      const t = target;
      const d = dir;
      const betReq: IBetRequest<DicePick> = {
        gameId: 'dice',
        sessionId: session.sessionId,
        stake: { amount: String(s), currency: 'INR' },
        mode: BetMode.Single,
        selections: [{ pick: { target: t, dir: d } }],
        idempotencyKey: `dice:${session.sessionId}:${stat.seq}:${s}`,
        clientSeed: 'demo',
      };
      // Cosmetic wobble seed (animation only — the roll comes from the engine).
      seedRef.current = (Math.floor(performance.now()) & 0x7fffffff) >>> 0;
      setResult(null);
      setSettled(null);
      setRolling(true);

      // Runtime: validate → debit → engine (provably-fair roll). UI animates to it.
      void runtime
        .startRound<DiceState>(betReq)
        .then(({ result, roundId }) => {
          const value = result.state.roll;
          const win = result.win;
          const m = result.multiplier || diceMultiplier(t, d);
          if (opts?.instant) {
            sound.play('diceBounce');
            setDisplay(value);
            setSettled(value);
            setRolling(false);
            settle(value, win, m, s, roundId);
          } else {
            animateTo(value, win, m, s, roundId, ROLL_MS);
          }
        })
        .catch((e: unknown) => {
          setRolling(false);
          autoOn.current = false;
          setAuto(false);
          toast.error(e instanceof Error ? e.message : 'Could not place bet.');
        });
    },
    [rolling, bet, balance, session, stat.seq, target, dir, runtime, animateTo, settle],
  );

  // Auto-roll loop
  useEffect(() => {
    if (!auto || rolling) return;
    autoRef.current = window.setTimeout(() => {
      if (!autoOn.current) return;
      const s = Math.max(1, Math.floor(bet));
      if (s > balance) {
        autoOn.current = false;
        setAuto(false);
        toast.error('Auto-roll stopped — low balance.');
        return;
      }
      roll();
    }, 1200);
    return () => window.clearTimeout(autoRef.current);
  }, [auto, rolling, bet, balance, roll]);

  const toggleAuto = () => {
    const next = !auto;
    autoOn.current = next;
    setAuto(next);
    if (next && !rolling) roll();
  };

  const reset = () => {
    cleanup();
    autoOn.current = false;
    setAuto(false);
    setRolling(false);
    setDisplay(0);
    setSettled(null);
    setResult(null);
    setFx({ key: 0, type: null });
  };

  const disabled = rolling;
  const shown = settled ?? display;
  const markerPct = target; // 0..100 maps directly
  const winZoneStyle =
    dir === 'over'
      ? { left: `${target}%`, right: '0%' }
      : { left: '0%', right: `${100 - target}%` };
  const resultColor = result ? (result.win ? 'text-emerald' : 'text-destructive') : 'text-primary';

  return (
    <div className="grid gap-4 lg:gap-6 lg:grid-cols-[2.2fr_1fr] xl:grid-cols-[2.5fr_1fr]">
      {/* Stage */}
      <div className="card-premium relative aspect-[16/10] overflow-hidden p-0">
        <GameFx trigger={fx} />
        <div className="absolute inset-0 bg-gradient-to-b from-white to-primary/5" />
        <div className="bg-grid absolute inset-0 opacity-40" />

        {/* recent rolls */}
        <div className="absolute left-3 top-3 z-10 flex gap-1">
          {stat.history.slice(0, 6).map((r) => (
            <span
              key={r.id}
              className={cn(
                'rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums',
                r.win ? 'bg-emerald/15 text-emerald' : 'bg-destructive/15 text-destructive',
              )}
            >
              {r.label}
            </span>
          ))}
        </div>

        <Badge variant="neon" className="absolute right-3 top-3 z-10 gap-1">
          <Percent className="h-3 w-3" /> {chance.toFixed(2)}% chance
        </Badge>

        {/* center readout */}
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center px-6">
          <motion.div
            key={result ? `r${fxKeyRef.current}` : rolling ? 'roll' : 'idle'}
            animate={{ scale: rolling ? [1, 1.03, 1] : 1 }}
            transition={{ duration: 0.35, repeat: rolling ? Infinity : 0 }}
            className={cn(
              'font-display text-7xl font-bold tabular-nums sm:text-8xl',
              resultColor,
              (rolling || result) && 'text-glow',
            )}
          >
            {shown.toFixed(2)}
          </motion.div>

          {result ? (
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn('mt-2 font-display text-lg font-bold', result.win ? 'text-emerald' : 'text-destructive')}
            >
              {result.win
                ? `You won +${(result.payout - stake).toLocaleString('en-US')} · ${mult.toFixed(2)}×`
                : `Missed · rolled ${result.roll.toFixed(2)}`}
            </motion.p>
          ) : (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Target className="h-4 w-4 text-primary" />
              Roll {dir === 'over' ? 'over' : 'under'}{' '}
              <span className="font-mono font-bold text-foreground tabular-nums">{target.toFixed(2)}</span>
            </p>
          )}
        </div>

        {/* odds bar at bottom */}
        <div className="absolute inset-x-6 bottom-5 z-10">
          <div className="relative h-3 overflow-hidden rounded-full bg-black/[0.06] ring-1 ring-inset ring-black/10">
            <div
              className={cn(
                'absolute inset-y-0 rounded-full',
                dir === 'over'
                  ? 'bg-gradient-to-r from-emerald/40 to-emerald'
                  : 'bg-gradient-to-l from-emerald/40 to-emerald',
              )}
              style={winZoneStyle}
            />
            {/* target marker */}
            <div
              className="absolute -top-1 h-5 w-1 -translate-x-1/2 rounded-full bg-primary shadow-glow"
              style={{ left: `${markerPct}%` }}
            />
            {/* result marker */}
            {settled !== null ? (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className={cn(
                  'absolute -top-1.5 h-6 w-6 -translate-x-1/2 -translate-y-0 rounded-full border-2 border-white shadow-glow',
                  result?.win ? 'bg-emerald' : 'bg-destructive',
                )}
                style={{ left: `${Math.min(100, Math.max(0, shown))}%`, top: '-6px' }}
              />
            ) : null}
          </div>
          <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground tabular-nums">
            <span>0</span>
            <span>50</span>
            <span>100</span>
          </div>
        </div>
      </div>

      {/* Controls + stats */}
      <div className="space-y-4">
        <div className="card-premium space-y-3 p-4">
          {/* Bet amount */}
          <label className="block text-xs font-semibold text-muted-foreground">
            Bet amount
            <div className="mt-1 flex items-center rounded-xl border border-black/10 bg-white/70 px-2">
              <input
                type="number"
                min={1}
                value={bet}
                onChange={(e) => setBet(Math.max(1, Number(e.target.value)))}
                disabled={disabled}
                className="h-10 w-full bg-transparent font-mono text-sm outline-none tabular-nums"
              />
              <button
                onClick={() => setBet((b) => Math.max(1, Math.floor(b / 2)))}
                disabled={disabled}
                className="px-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                ½
              </button>
              <button
                onClick={() => setBet((b) => b * 2)}
                disabled={disabled}
                className="px-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                2×
              </button>
            </div>
          </label>
          <div>
            {[100, 500, 1000, 5000].map((v) => (
              <button
                key={v}
                onClick={() => setBet(v)}
                disabled={disabled}
                className="mr-1.5 rounded-lg bg-black/[0.04] px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-40"
              >
                {v.toLocaleString('en-US')}
              </button>
            ))}
          </div>

          {/* Over / Under toggle */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setDir('under')}
              disabled={disabled}
              className={cn(
                'rounded-xl border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50',
                dir === 'under'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-black/10 bg-white/60 text-muted-foreground hover:text-foreground',
              )}
            >
              Roll Under
            </button>
            <button
              onClick={() => setDir('over')}
              disabled={disabled}
              className={cn(
                'rounded-xl border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50',
                dir === 'over'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-black/10 bg-white/60 text-muted-foreground hover:text-foreground',
              )}
            >
              Roll Over
            </button>
          </div>

          {/* Target slider */}
          <label className="block text-xs font-semibold text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>Target</span>
              <span className="font-mono text-sm font-bold text-foreground tabular-nums">{target.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={MIN_TARGET}
              max={MAX_TARGET}
              step={0.01}
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
              disabled={disabled}
              className="mt-2 w-full accent-primary disabled:opacity-50"
            />
          </label>

          {/* Live readout */}
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-black/[0.03] p-2 text-center">
            <Readout label="Chance" value={`${chance.toFixed(2)}%`} />
            <Readout label="Multiplier" value={`${mult.toFixed(2)}×`} />
            <Readout label="Payout" value={potential.toLocaleString('en-US')} />
          </div>

          {/* Roll buttons */}
          <div className="flex gap-2">
            <Button
              variant="gradient"
              size="lg"
              className="sheen w-full"
              onClick={() => roll()}
              disabled={disabled}
            >
              <Dice5 className="h-5 w-5" /> {rolling ? 'Rolling…' : `Roll · ${stake.toLocaleString('en-US')}`}
            </Button>
            <Button
              variant="glass"
              size="lg"
              onClick={() => roll({ instant: true })}
              disabled={disabled}
              title="Quick roll (instant)"
            >
              <Zap className="h-5 w-5" />
            </Button>
            <Button
              variant="glass"
              size="lg"
              onClick={() => roll()}
              disabled={disabled || settled === null}
              title="Roll again"
            >
              <RotateCcw className="h-5 w-5" />
            </Button>
          </div>

          <div className="flex gap-2">
            <Button
              variant={auto ? 'gold' : 'glass'}
              size="sm"
              className={cn('w-full', auto && 'sheen')}
              onClick={toggleAuto}
            >
              <Sparkles className="h-4 w-4" /> {auto ? 'Stop auto-roll' : 'Auto-roll'}
            </Button>
            <Button variant="ghost" size="sm" onClick={reset} disabled={rolling} title="Reset stage">
              <RotateCcw className="h-4 w-4" /> Reset
            </Button>
          </div>
        </div>

        {/* stats */}
        <div className="card-premium grid grid-cols-2 gap-3 p-4 text-center">
          <Stat icon={<TrendingUp className="h-4 w-4 text-emerald" />} label="Highest" value={stat.highest.toFixed(2)} />
          <Stat icon={<Zap className="h-4 w-4 text-gold" />} label="Best streak" value={String(stat.bestStreak)} />
          <Stat label="Rounds" value={String(stat.rounds)} />
          <Stat label="Biggest win" value={`+${stat.biggestWin.toLocaleString('en-US')}`} />
        </div>

        {/* history */}
        <div className="card-premium p-4">
          <p className="mb-2 flex items-center gap-2 font-display text-sm font-bold">History</p>
          <div className="flex flex-wrap gap-1.5">
            {stat.history.slice(0, 14).map((r) => (
              <span
                key={r.id}
                className={cn(
                  'rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums',
                  r.win ? 'bg-emerald/15 text-emerald' : 'bg-destructive/15 text-destructive',
                )}
              >
                {r.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-bold tabular-nums">{value}</div>
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
