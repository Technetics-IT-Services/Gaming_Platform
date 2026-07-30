'use client';

import { Button, cn } from '@gaming-platform/ui';
import type { IBetRequest } from '@gaming-platform/types';
import { BetMode } from '@gaming-platform/types';
import { motion } from 'framer-motion';
import { Gauge, TrendingUp, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { GameFx, type FxSignal } from '@/components/games/prototype/game-fx';
import { BetAmount, HistoryStrip, ProvablyFair, Stat } from '@/components/games/prototype/instant/shared';
import { WHEEL_SEGMENTS, type WheelRisk, type WheelState } from '@/games/instant/wheel-engine';
import { sound } from '@/lib/sound';
import { useGameRuntime } from '@/runtime/react/use-game-runtime';
import { useDemoWallet } from '@/stores/demo-wallet';
import { useGameStat } from '@/stores/game-stats';

const SLUG = 'wheel';
const SPIN_MS = 3000;

function segFill(m: number): string {
  if (m === 0) return 'hsl(222 20% 22%)';
  if (m >= 8) return 'hsl(326 82% 55%)';
  if (m >= 3) return 'hsl(45 90% 55%)';
  return 'hsl(160 70% 42%)';
}

export function WheelGame() {
  const { runtime, session } = useGameRuntime(SLUG);
  const balance = useDemoWallet((s) => s.balance);
  const stat = useGameStat(SLUG);

  const [bet, setBet] = useState(100);
  const [risk, setRisk] = useState<WheelRisk>('low');
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState<{ win: boolean; multiplier: number } | null>(null);
  const [fx, setFx] = useState<FxSignal>({ key: 0, type: null });

  const fxKey = useRef(0);
  const pending = useRef(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const stake = Math.max(1, Math.floor(bet));
  const segments = WHEEL_SEGMENTS[risk];
  const slice = 360 / segments.length;

  const spin = useCallback(() => {
    if (spinning || pending.current) return;
    if (!session) return void toast.error('Starting session… try again in a moment.');
    if (stake > balance) return void toast.error('Not enough demo coins — hit reload in the balance pill.');
    pending.current = true;
    setResult(null);
    setSpinning(true);
    sound.play('wheel');

    const req: IBetRequest<WheelRisk> = {
      gameId: SLUG,
      sessionId: session.sessionId,
      stake: { amount: String(stake), currency: 'INR' },
      mode: BetMode.Single,
      selections: [{ pick: risk }],
      idempotencyKey: `${SLUG}:${session.sessionId}:${stat.seq}:${stake}`,
      clientSeed: 'demo',
    };
    void runtime
      .startRound<WheelState>(req)
      .then(({ result: r, roundId }) => {
        const sl = 360 / WHEEL_SEGMENTS[r.state.risk].length;
        // Bring the winning segment centre under the top pointer, + full spins.
        const base = ((rotation % 360) + 360) % 360;
        const target = (360 - (r.state.index + 0.5) * sl) % 360;
        let delta = target - base;
        if (delta < 0) delta += 360;
        setRotation(rotation + 6 * 360 + delta);
        timers.current.push(window.setTimeout(() => sound.play('ball'), SPIN_MS - 400));
        timers.current.push(
          window.setTimeout(() => {
            setSpinning(false);
            setResult({ win: r.win, multiplier: r.state.multiplier });
            if (r.win) {
              fxKey.current += 1;
              setFx({ key: fxKey.current, type: 'win', amount: Math.round(stake * r.state.multiplier) - stake });
              sound.play(r.state.multiplier >= 8 ? 'jackpot' : 'reward');
              void runtime.cashOut({ roundId, atMultiplier: r.state.multiplier }).catch(() => {});
            } else {
              sound.play('lose');
              void runtime.finishRound({ roundId, finalMultiplier: 0 }).catch(() => {});
            }
          }, SPIN_MS + 60),
        );
      })
      .catch((e: unknown) => {
        setSpinning(false);
        toast.error(e instanceof Error ? e.message : 'Could not place bet.');
      })
      .finally(() => {
        pending.current = false;
      });
  }, [spinning, stake, balance, session, risk, stat.seq, rotation, runtime]);

  return (
    <div className="grid gap-4 lg:gap-6 lg:grid-cols-[2fr_1fr] xl:grid-cols-[2.3fr_1fr]">
      <div className="card-premium relative flex aspect-square max-h-[560px] items-center justify-center overflow-hidden p-4">
        <GameFx trigger={fx} />
        <div className="bg-grid absolute inset-0 opacity-30" />
        {/* pointer */}
        <div className="absolute left-1/2 top-2 z-20 -translate-x-1/2">
          <div className="h-0 w-0 border-x-[10px] border-t-[16px] border-x-transparent border-t-gold drop-shadow" />
        </div>
        <div className="relative aspect-square w-full max-w-[420px]">
          <motion.div className="absolute inset-0" animate={{ rotate: rotation }} transition={{ duration: SPIN_MS / 1000, ease: [0.16, 1, 0.3, 1] }}>
            <svg viewBox="0 0 200 200" className="h-full w-full">
              {segments.map((m, i) => {
                const a0 = ((i * slice - 90) * Math.PI) / 180;
                const a1 = (((i + 1) * slice - 90) * Math.PI) / 180;
                const R = 98;
                const x0 = 100 + R * Math.cos(a0);
                const y0 = 100 + R * Math.sin(a0);
                const x1 = 100 + R * Math.cos(a1);
                const y1 = 100 + R * Math.sin(a1);
                const am = (((i + 0.5) * slice - 90) * Math.PI) / 180;
                return (
                  <g key={i}>
                    <path d={`M100 100 L ${x0} ${y0} A ${R} ${R} 0 0 1 ${x1} ${y1} Z`} fill={segFill(m)} stroke="hsl(0 0% 100% / 0.35)" strokeWidth={0.5} />
                    {m > 0 ? (
                      <text x={100 + 74 * Math.cos(am)} y={100 + 74 * Math.sin(am)} fill="white" fontSize={7} fontWeight={700} textAnchor="middle" dominantBaseline="middle">
                        {m}×
                      </text>
                    ) : null}
                  </g>
                );
              })}
              <circle cx="100" cy="100" r="16" fill="hsl(45 80% 50%)" stroke="white" strokeWidth={1.5} />
            </svg>
          </motion.div>
          <div className="absolute inset-0 z-10 grid place-items-center">
            {result ? (
              <span className={cn('font-display text-3xl font-bold tabular-nums', result.win ? 'text-emerald' : 'text-destructive')}>{result.multiplier}×</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="card-premium space-y-3 p-4">
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Risk level">
            {(['low', 'medium', 'high'] as const).map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={risk === r}
                onClick={() => setRisk(r)}
                disabled={spinning}
                className={cn(
                  'rounded-xl border px-2 py-2 text-center font-display text-sm font-bold capitalize transition-colors disabled:opacity-50',
                  risk === r ? 'border-primary bg-primary/10 text-primary shadow-glow' : 'border-black/10 bg-white/60 text-muted-foreground hover:text-foreground',
                )}
              >
                {r}
              </button>
            ))}
          </div>
          <BetAmount value={bet} onChange={setBet} disabled={spinning} />
          <Button variant="gradient" size="lg" className="sheen w-full" onClick={spin} disabled={spinning}>
            <Zap className="h-5 w-5" /> {spinning ? 'Spinning…' : `Spin · ${stake.toLocaleString('en-US')}`}
          </Button>
        </div>
        <div className="card-premium grid grid-cols-2 gap-3 p-4 text-center">
          <Stat icon={<TrendingUp className="h-4 w-4 text-emerald" />} label="Best ×" value={`${stat.highest.toFixed(2)}×`} />
          <Stat icon={<Gauge className="h-4 w-4 text-gold" />} label="Spins" value={String(stat.rounds)} />
        </div>
        <ProvablyFair session={session} />
        <HistoryStrip stat={stat} />
      </div>
    </div>
  );
}
