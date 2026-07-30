'use client';

import { Button, cn } from '@gaming-platform/ui';
import type { IBetRequest } from '@gaming-platform/types';
import { BetMode } from '@gaming-platform/types';
import { motion } from 'framer-motion';
import { Eraser, TrendingUp, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { GameFx, type FxSignal } from '@/components/games/prototype/game-fx';
import { BetAmount, HistoryStrip, ProvablyFair, Stat } from '@/components/games/prototype/instant/shared';
import { KENO_CONFIG, type KenoState } from '@/games/instant/keno-engine';
import { sound } from '@/lib/sound';
import { useGameRuntime } from '@/runtime/react/use-game-runtime';
import { useDemoWallet } from '@/stores/demo-wallet';
import { useGameStat } from '@/stores/game-stats';

const SLUG = 'keno';
const POOL = KENO_CONFIG.pool;

export function KenoGame() {
  const { runtime, session } = useGameRuntime(SLUG);
  const balance = useDemoWallet((s) => s.balance);
  const stat = useGameStat(SLUG);

  const [bet, setBet] = useState(100);
  const [selected, setSelected] = useState<number[]>([]);
  const [playing, setPlaying] = useState(false);
  const [drawn, setDrawn] = useState<Set<number>>(new Set());
  const [shown, setShown] = useState(0);
  const [result, setResult] = useState<{ win: boolean; matches: number; multiplier: number } | null>(null);
  const [fx, setFx] = useState<FxSignal>({ key: 0, type: null });

  const fxKey = useRef(0);
  const pending = useRef(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const stake = Math.max(1, Math.floor(bet));
  const drawnArr = [...drawn];
  const drawnShown = new Set(drawnArr.slice(0, shown));

  const toggle = (n: number) => {
    if (playing) return;
    setResult(null);
    setSelected((s) => (s.includes(n) ? s.filter((x) => x !== n) : s.length >= 10 ? s : [...s, n]));
  };

  const play = useCallback(() => {
    if (playing || pending.current) return;
    if (!session) return void toast.error('Starting session… try again in a moment.');
    if (selected.length === 0) return void toast.error('Pick 1–10 numbers first.');
    if (stake > balance) return void toast.error('Not enough demo coins — hit reload in the balance pill.');
    pending.current = true;
    setPlaying(true);
    setResult(null);
    setShown(0);
    const req: IBetRequest<number[]> = {
      gameId: SLUG,
      sessionId: session.sessionId,
      stake: { amount: String(stake), currency: 'INR' },
      mode: BetMode.Single,
      selections: [{ pick: selected }],
      idempotencyKey: `${SLUG}:${session.sessionId}:${stat.seq}:${stake}`,
      clientSeed: 'demo',
    };
    void runtime
      .startRound<KenoState>(req)
      .then(({ result: r, roundId }) => {
        setDrawn(new Set(r.state.drawn));
        r.state.drawn.forEach((_, i) => {
          timers.current.push(window.setTimeout(() => { setShown(i + 1); sound.play('ball'); }, 120 * (i + 1)));
        });
        timers.current.push(
          window.setTimeout(() => {
            setPlaying(false);
            setResult({ win: r.win, matches: r.state.matches, multiplier: r.state.multiplier });
            if (r.win) {
              fxKey.current += 1;
              setFx({ key: fxKey.current, type: 'win', amount: Math.round(stake * r.state.multiplier) - stake });
              sound.play('reward');
              void runtime.cashOut({ roundId, atMultiplier: r.state.multiplier }).catch(() => {});
            } else {
              sound.play('lose');
              void runtime.finishRound({ roundId, finalMultiplier: 0 }).catch(() => {});
            }
          }, 120 * r.state.drawn.length + 300),
        );
      })
      .catch((e: unknown) => { setPlaying(false); toast.error(e instanceof Error ? e.message : 'Could not place bet.'); })
      .finally(() => { pending.current = false; });
  }, [playing, selected, stake, balance, session, stat.seq, runtime]);

  return (
    <div className="grid gap-4 lg:gap-6 lg:grid-cols-[2fr_1fr] xl:grid-cols-[2.2fr_1fr]">
      <div className="card-premium relative overflow-hidden p-5">
        <GameFx trigger={fx} />
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-white to-accent/5" />
        <div className="relative grid grid-cols-8 gap-1.5" role="grid" aria-label="Keno board">
          {Array.from({ length: POOL }, (_, idx) => {
            const n = idx + 1;
            const isSel = selected.includes(n);
            const isDrawn = drawnShown.has(n);
            const isHit = isSel && isDrawn;
            return (
              <motion.button
                key={n}
                type="button"
                role="gridcell"
                aria-pressed={isSel}
                aria-label={`Number ${n}`}
                disabled={playing}
                onClick={() => toggle(n)}
                animate={isHit ? { scale: [1, 1.18, 1] } : {}}
                className={cn(
                  'grid aspect-square place-items-center rounded-lg border font-mono text-sm font-bold transition-colors',
                  isHit ? 'border-emerald bg-emerald text-white shadow-glow'
                    : isDrawn ? 'border-gold/50 bg-gold/15 text-gold'
                      : isSel ? 'border-primary bg-primary/10 text-primary'
                        : 'border-black/10 bg-white/70 text-muted-foreground hover:border-primary/40',
                )}
              >
                {n}
              </motion.button>
            );
          })}
        </div>
        <p className={cn('relative mt-3 text-center font-display text-lg font-bold', result ? (result.win ? 'text-emerald' : 'text-destructive') : 'text-muted-foreground')}>
          {result ? `${result.matches}/${selected.length} matched · ${result.multiplier}×` : playing ? 'Drawing…' : `Pick up to 10 · ${selected.length} selected`}
        </p>
      </div>

      <div className="space-y-4">
        <div className="card-premium space-y-3 p-4">
          <BetAmount value={bet} onChange={setBet} disabled={playing} />
          <div className="flex gap-2">
            <Button variant="gradient" size="lg" className="sheen w-full" onClick={play} disabled={playing || selected.length === 0}>
              <Zap className="h-5 w-5" /> {playing ? 'Drawing…' : `Play · ${stake.toLocaleString('en-US')}`}
            </Button>
            <Button variant="glass" size="lg" onClick={() => setSelected([])} disabled={playing} title="Clear picks" aria-label="Clear picks">
              <Eraser className="h-5 w-5" />
            </Button>
          </div>
        </div>
        <div className="card-premium grid grid-cols-2 gap-3 p-4 text-center">
          <Stat icon={<TrendingUp className="h-4 w-4 text-emerald" />} label="Best ×" value={`${stat.highest.toFixed(2)}×`} />
          <Stat label="Rounds" value={String(stat.rounds)} />
        </div>
        <ProvablyFair session={session} />
        <HistoryStrip stat={stat} />
      </div>
    </div>
  );
}
