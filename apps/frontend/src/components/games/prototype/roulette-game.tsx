'use client';

import { Button, cn } from '@gaming-platform/ui';
import type { IBetRequest } from '@gaming-platform/types';
import { BetMode } from '@gaming-platform/types';
import { motion } from 'framer-motion';
import { CircleDot, Flame, RotateCcw, Snowflake, Trophy, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { GameFx, type FxSignal } from '@/components/games/prototype/game-fx';
import { OUTSIDE, colorOf, labelOf, type RoulettePick, type RouletteState } from '@/games/roulette-engine';
import { sound } from '@/lib/sound';
import { useGameRuntime } from '@/runtime/react/use-game-runtime';
import { useDemoWallet } from '@/stores/demo-wallet';
import { useGameStats } from '@/stores/game-stats';

/** European single-zero wheel order (0 at 12 o'clock, clockwise). */
const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18,
  29, 7, 28, 12, 35, 3, 26,
] as const;
const POCKETS = WHEEL_ORDER.length; // 37
const SLICE = 360 / POCKETS;

type Color = 'red' | 'black' | 'green';
function chipClass(c: Color): string {
  return c === 'green' ? 'bg-emerald text-white' : c === 'red' ? 'bg-destructive text-white' : 'bg-foreground text-white';
}

/** A player's selection — outside bet (2×) or a straight number (36×). The wheel
 * rules (colour, label, outside predicates) live in the shared roulette engine. */
type BetSelection = RoulettePick;

const QUICK_CHIPS = [100, 500, 1000, 5000];
const SPIN_MS = 3100;

export function RouletteGame() {
  // The Runtime owns bet/RNG/settlement/history; the UI only renders + collects
  // intent. Demo providers delegate to these same stores, so balance/stats/history
  // surfaces are unchanged.
  const { runtime, session } = useGameRuntime('roulette');
  const balance = useDemoWallet((s) => s.balance);
  const stat = useGameStats((s) => s.games.roulette);

  const [bet, setBet] = useState(100);
  const [selection, setSelection] = useState<BetSelection>({ kind: 'outside', key: 'red' });
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0); // wheel rotation (deg)
  const [ballRot, setBallRot] = useState(0); // ball rotation (deg)
  const [ballSettled, setBallSettled] = useState(true);
  const [winning, setWinning] = useState<number | null>(null);
  const [result, setResult] = useState<{ win: boolean; payout: number; number: number } | null>(null);
  const [fx, setFx] = useState<FxSignal>({ key: 0, type: null });

  const rafRef = useRef(0);
  const timeoutRef = useRef<number[]>([]);
  const startRef = useRef(0);
  const fromRotRef = useRef(0);
  const toRotRef = useRef(0);
  const fxKeyRef = useRef(0);

  const cleanup = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    timeoutRef.current.forEach((id) => window.clearTimeout(id));
    timeoutRef.current = [];
  }, []);
  useEffect(() => cleanup, [cleanup]);

  /** Present the outcome + settle through the Runtime (win → cashOut, loss → finish). */
  const settle = useCallback(
    (n: number, won: boolean, mult: number, stake: number, roundId: string) => {
      if (won) {
        const gross = Math.round(stake * mult);
        const net = gross - stake;
        setResult({ win: true, payout: net, number: n });
        fxKeyRef.current += 1;
        setFx({ key: fxKeyRef.current, type: 'win', amount: net });
        sound.play('reward');
        // Runtime settles the win: credit + bet-history + stats (label = the pocket).
        void runtime.cashOut({ roundId, atMultiplier: mult }).catch(() => {});
      } else {
        setResult({ win: false, payout: -stake, number: n });
        sound.play('lose');
        void runtime.finishRound({ roundId, finalMultiplier: 0 }).catch(() => {});
      }
    },
    [runtime],
  );

  const tick = useCallback(() => {
    const elapsed = performance.now() - startRef.current;
    const t = Math.min(1, elapsed / SPIN_MS);
    // easeOutQuint: fast start, long settle.
    const eased = 1 - Math.pow(1 - t, 5);
    const from = fromRotRef.current;
    const to = toRotRef.current;
    setRotation(from + (to - from) * eased);
    setBallRot((from + (to - from) * eased) * -1.35); // ball spins opposite & faster
    if (t < 1) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, []);

  const spin = useCallback(() => {
    if (spinning) return;
    const stake = Math.max(1, Math.floor(bet));
    if (!session) {
      toast.error('Starting session… try again in a moment.');
      return;
    }
    if (stake > balance) {
      toast.error('Not enough demo coins — hit reload in the balance pill.');
      return;
    }
    const betReq: IBetRequest<RoulettePick> = {
      gameId: 'roulette',
      sessionId: session.sessionId,
      stake: { amount: String(stake), currency: 'INR' },
      mode: BetMode.Single,
      selections: [{ pick: selection }],
      idempotencyKey: `roulette:${session.sessionId}:${stat.seq}:${stake}`,
      clientSeed: 'demo',
    };
    setResult(null);
    setWinning(null);
    setSpinning(true);
    setBallSettled(false);
    sound.play('chips');
    sound.play('wheel');

    // Runtime: validate → debit → engine (provably-fair pocket). UI spins to it.
    void runtime
      .startRound<RouletteState>(betReq)
      .then(({ result, roundId }) => {
        const n = result.state.number;
        const won = result.win;
        const mult = result.multiplier;

        // Compute target rotation so pocket `n` lands under the top marker.
        const idx = WHEEL_ORDER.indexOf(n as (typeof WHEEL_ORDER)[number]);
        const pocketAngle = idx * SLICE; // pocket's base angle from top (clockwise)
        // rotate so pocketAngle ends at 0 (top): rotation ≡ -pocketAngle (mod 360)
        const current = ((rotation % 360) + 360) % 360;
        const targetMod = (360 - pocketAngle) % 360;
        let delta = targetMod - current;
        if (delta < 0) delta += 360;
        const spins = 6; // full turns for drama
        fromRotRef.current = rotation;
        toRotRef.current = rotation + spins * 360 + delta;

        startRef.current = performance.now();
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(tick);

        // ball settle sound near the end
        timeoutRef.current.push(
          window.setTimeout(() => sound.play('ball'), SPIN_MS - 500),
          window.setTimeout(() => {
            setBallSettled(true);
            setSpinning(false);
            setWinning(n);
            settle(n, won, mult, stake, roundId);
          }, SPIN_MS + 60),
        );
      })
      .catch((e: unknown) => {
        setSpinning(false);
        setBallSettled(true);
        toast.error(e instanceof Error ? e.message : 'Could not place bet.');
      });
  }, [spinning, bet, balance, session, selection, stat.seq, rotation, tick, settle, runtime]);

  // Hot / Cold from history (fallback to seeded so never empty).
  const { hot, cold, redPct, oddPct } = useMemo(() => {
    const counts = new Map<number, number>();
    for (const r of stat.history) counts.set(r.value, (counts.get(r.value) ?? 0) + 1);
    const withCounts = Array.from({ length: POCKETS }, (_, n) => ({ n, c: counts.get(n) ?? 0 }));
    const sorted = [...withCounts].sort((a, b) => b.c - a.c || a.n - b.n);
    const coldSorted = [...withCounts].sort((a, b) => a.c - b.c || a.n - b.n);
    const total = stat.history.length || 1;
    const reds = stat.history.filter((r) => colorOf(r.value) === 'red').length;
    const odds = stat.history.filter((r) => r.value % 2 === 1).length;
    return {
      hot: sorted.slice(0, 5).map((x) => x.n),
      cold: coldSorted.slice(0, 5).map((x) => x.n),
      redPct: Math.round((reds / total) * 100),
      oddPct: Math.round((odds / total) * 100),
    };
  }, [stat.history]);

  const isSelected = (b: BetSelection) =>
    b.kind === 'outside' && selection.kind === 'outside'
      ? b.key === selection.key
      : b.kind === 'straight' && selection.kind === 'straight' && b.n === selection.n;

  const winColor = winning === null ? null : colorOf(winning);

  return (
    <div className="grid gap-4 lg:gap-6 lg:grid-cols-[2fr_1fr] xl:grid-cols-[2.3fr_1fr]">
      {/* Wheel stage + result */}
      <div className="space-y-4">
        <div className="card-premium relative flex aspect-square max-h-[440px] items-center justify-center overflow-hidden p-4 lg:max-h-[560px] xl:max-h-[640px]">
          <GameFx trigger={fx} />
          <div className="bg-grid absolute inset-0 opacity-30" />

          {/* marker */}
          <div className="absolute left-1/2 top-2 z-20 -translate-x-1/2">
            <div className="h-0 w-0 border-x-[10px] border-t-[16px] border-x-transparent border-t-gold drop-shadow" />
          </div>

          <div className="relative aspect-square w-full max-w-[380px] lg:max-w-[500px] xl:max-w-[580px]">
            {/* Wheel */}
            <div
              className="absolute inset-0 rounded-full shadow-glow"
              style={{ transform: `rotate(${rotation}deg)`, willChange: 'transform' }}
            >
              <svg viewBox="0 0 200 200" className="h-full w-full">
                <defs>
                  <radialGradient id="rlHub" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="hsl(45 90% 65%)" />
                    <stop offset="100%" stopColor="hsl(38 80% 45%)" />
                  </radialGradient>
                </defs>
                {WHEEL_ORDER.map((n, i) => {
                  const a0 = (i * SLICE - 90 - SLICE / 2) * (Math.PI / 180);
                  const a1 = ((i + 1) * SLICE - 90 - SLICE / 2) * (Math.PI / 180);
                  const R = 100;
                  const x0 = 100 + R * Math.cos(a0);
                  const y0 = 100 + R * Math.sin(a0);
                  const x1 = 100 + R * Math.cos(a1);
                  const y1 = 100 + R * Math.sin(a1);
                  const c = colorOf(n);
                  const fill =
                    c === 'green' ? 'hsl(160 84% 39%)' : c === 'red' ? 'hsl(0 72% 51%)' : 'hsl(222 20% 18%)';
                  // label position
                  const am = ((i + 0.5) * SLICE - 90 - SLICE / 2) * (Math.PI / 180);
                  const lx = 100 + 84 * Math.cos(am);
                  const ly = 100 + 84 * Math.sin(am);
                  return (
                    <g key={i}>
                      <path d={`M100 100 L ${x0} ${y0} A ${R} ${R} 0 0 1 ${x1} ${y1} Z`} fill={fill} stroke="hsl(45 60% 55% / 0.5)" strokeWidth={0.6} />
                      <text
                        x={lx}
                        y={ly}
                        fill="white"
                        fontSize={7}
                        fontWeight={700}
                        textAnchor="middle"
                        dominantBaseline="central"
                        transform={`rotate(${(i + 0.5) * SLICE} ${lx} ${ly})`}
                      >
                        {n}
                      </text>
                    </g>
                  );
                })}
                <circle cx={100} cy={100} r={34} fill="url(#rlHub)" stroke="hsl(38 70% 40%)" strokeWidth={1.5} />
                <circle cx={100} cy={100} r={20} fill="hsl(45 85% 58%)" />
              </svg>
            </div>

            {/* Ball track — ball rides just inside the rim, opposite spin */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                transform: `rotate(${ballRot}deg)`,
                transition: ballSettled && !spinning ? 'transform 0.4s ease-out' : undefined,
                willChange: 'transform',
              }}
            >
              <div
                className="absolute left-1/2 top-[7%] h-3 w-3 -translate-x-1/2 rounded-full bg-white shadow-[0_0_8px_2px_rgba(255,255,255,0.7)] ring-1 ring-black/10"
              />
            </div>

            {/* center readout */}
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              {winning !== null ? (
                <motion.div
                  key={winning}
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className={cn(
                    'flex h-14 w-14 items-center justify-center rounded-full font-display text-2xl font-bold tabular-nums shadow-glow',
                    chipClass(colorOf(winning)),
                  )}
                >
                  {winning}
                </motion.div>
              ) : spinning ? (
                <CircleDot className="h-8 w-8 animate-spin text-gold/70" />
              ) : (
                <CircleDot className="h-8 w-8 text-gold/60" />
              )}
            </div>
          </div>
        </div>

        {/* Result readout */}
        <div className="card-premium flex items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-full font-display text-lg font-bold tabular-nums',
                winning !== null ? chipClass(winColor!) : 'bg-black/5 text-muted-foreground',
              )}
            >
              {winning ?? '—'}
            </span>
            <div>
              <p className="font-display text-sm font-bold text-foreground">
                {winning !== null ? labelOf(winning) : spinning ? 'Spinning…' : 'Place a bet & spin'}
              </p>
              <p className="text-xs text-muted-foreground">
                {selection.kind === 'straight'
                  ? `Straight up ${selection.n} · 36×`
                  : `${OUTSIDE.find((o) => o.key === selection.key)!.label} · 2×`}
              </p>
            </div>
          </div>
          {result ? (
            <span
              className={cn(
                'font-display text-lg font-bold tabular-nums',
                result.win ? 'text-emerald' : 'text-destructive',
              )}
            >
              {result.win ? `+${result.payout.toLocaleString('en-US')}` : result.payout.toLocaleString('en-US')}
            </span>
          ) : null}
        </div>
      </div>

      {/* Controls + panels */}
      <div className="space-y-4">
        {/* Bet panel */}
        <div className="card-premium space-y-3 p-4">
          <p className="font-display text-sm font-bold">Your bet</p>
          <div className="grid grid-cols-3 gap-1.5">
            {OUTSIDE.map((o) => {
              const b: BetSelection = { kind: 'outside', key: o.key };
              const active = isSelected(b);
              return (
                <button
                  key={o.key}
                  disabled={spinning}
                  onClick={() => {
                    setSelection(b);
                    sound.play('chips');
                  }}
                  className={cn(
                    'rounded-lg py-2 text-xs font-bold transition-colors',
                    active
                      ? o.key === 'red'
                        ? 'bg-destructive text-white shadow-glow'
                        : o.key === 'black'
                          ? 'bg-foreground text-white'
                          : 'bg-primary text-white shadow-glow'
                      : 'bg-black/[0.04] text-muted-foreground hover:bg-primary/10 hover:text-primary',
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Straight up · 36×</p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(1.9rem,1fr))] gap-1">
              {Array.from({ length: POCKETS }, (_, n) => {
                const b: BetSelection = { kind: 'straight', n };
                const active = isSelected(b);
                const c = colorOf(n);
                return (
                  <button
                    key={n}
                    disabled={spinning}
                    onClick={() => {
                      setSelection(b);
                      sound.play('chips');
                    }}
                    className={cn(
                      'aspect-square rounded-md font-mono text-[11px] font-bold tabular-nums transition-transform',
                      chipClass(c),
                      active ? 'scale-110 ring-2 ring-gold ring-offset-1' : 'opacity-70 hover:opacity-100',
                    )}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Stake */}
          <div className="flex items-center rounded-xl border border-black/10 bg-white/70 px-2">
            <input
              type="number"
              min={1}
              value={bet}
              onChange={(e) => setBet(Math.max(1, Number(e.target.value)))}
              disabled={spinning}
              className="h-10 w-full bg-transparent font-mono text-sm outline-none"
            />
            <button onClick={() => setBet((b) => Math.max(1, Math.floor(b / 2)))} className="px-1 text-xs text-muted-foreground hover:text-foreground">
              ½
            </button>
            <button onClick={() => setBet((b) => b * 2)} className="px-1 text-xs text-muted-foreground hover:text-foreground">
              2×
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_CHIPS.map((v) => (
              <button
                key={v}
                onClick={() => setBet(v)}
                disabled={spinning}
                className="rounded-lg bg-black/[0.04] px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
              >
                {v.toLocaleString('en-US')}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <Button variant="gradient" size="lg" className="sheen w-full" onClick={() => spin()} disabled={spinning}>
              <CircleDot className="h-5 w-5" /> {spinning ? 'Spinning…' : `Spin · ${bet.toLocaleString('en-US')}`}
            </Button>
            {result && !spinning ? (
              <Button variant="glass" size="lg" onClick={() => spin()} title="Spin again">
                <RotateCcw className="h-5 w-5" />
              </Button>
            ) : null}
          </div>
        </div>

        {/* Recent numbers */}
        <div className="card-premium p-4">
          <p className="mb-2 font-display text-sm font-bold">Recent numbers</p>
          <div className="flex flex-wrap gap-1.5">
            {stat.history.slice(0, 14).map((r) => (
              <span
                key={r.id}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-md font-mono text-[11px] font-bold tabular-nums',
                  chipClass(colorOf(r.value)),
                )}
              >
                {r.value}
              </span>
            ))}
          </div>
        </div>

        {/* Hot / Cold */}
        <div className="card-premium grid grid-cols-2 gap-3 p-4">
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-destructive">
              <Flame className="h-3.5 w-3.5" /> Hot
            </p>
            <div className="flex flex-wrap gap-1.5">
              {hot.map((n) => (
                <span key={n} className={cn('flex h-7 w-7 items-center justify-center rounded-md font-mono text-[11px] font-bold tabular-nums', chipClass(colorOf(n)))}>
                  {n}
                </span>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-primary">
              <Snowflake className="h-3.5 w-3.5" /> Cold
            </p>
            <div className="flex flex-wrap gap-1.5">
              {cold.map((n) => (
                <span key={n} className={cn('flex h-7 w-7 items-center justify-center rounded-md font-mono text-[11px] font-bold tabular-nums', chipClass(colorOf(n)))}>
                  {n}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Quick stats: red/black + odd/even */}
        <div className="card-premium grid grid-cols-2 gap-3 p-4">
          <div>
            <div className="mb-1 flex justify-between text-[11px] font-semibold text-muted-foreground">
              <span className="text-destructive">Red {redPct}%</span>
              <span>Black {100 - redPct}%</span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-foreground">
              <div className="bg-destructive" style={{ width: `${redPct}%` }} />
            </div>
          </div>
          <div>
            <div className="mb-1 flex justify-between text-[11px] font-semibold text-muted-foreground">
              <span className="text-primary">Odd {oddPct}%</span>
              <span>Even {100 - oddPct}%</span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-black/10">
              <div className="bg-primary" style={{ width: `${oddPct}%` }} />
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="card-premium grid grid-cols-3 gap-3 p-4 text-center">
          <Stat label="Rounds" value={String(stat.rounds)} />
          <Stat icon={<Trophy className="h-4 w-4 text-gold" />} label="Biggest win" value={`+${stat.biggestWin.toLocaleString('en-US')}`} />
          <Stat icon={<Zap className="h-4 w-4 text-emerald" />} label="Best streak" value={String(stat.bestStreak)} />
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
