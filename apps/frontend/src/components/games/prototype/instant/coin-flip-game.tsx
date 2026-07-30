'use client';

import { Button, cn } from '@gaming-platform/ui';
import type { IBetRequest } from '@gaming-platform/types';
import { BetMode } from '@gaming-platform/types';
import { motion } from 'framer-motion';
import { Coins, TrendingUp, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { GameFx, type FxSignal } from '@/components/games/prototype/game-fx';
import { BetAmount, HistoryStrip, ProvablyFair, Stat } from '@/components/games/prototype/instant/shared';
import { COIN_FLIP_CONFIG, type CoinSide, type CoinFlipState } from '@/games/instant/coin-flip-engine';
import { sound } from '@/lib/sound';
import { useGameRuntime } from '@/runtime/react/use-game-runtime';
import { useDemoWallet } from '@/stores/demo-wallet';
import { useGameStat } from '@/stores/game-stats';

const SLUG = 'coin-flip';
const FLIP_MS = 1000;

export function CoinFlipGame() {
  const { runtime, session } = useGameRuntime(SLUG);
  const balance = useDemoWallet((s) => s.balance);
  const stat = useGameStat(SLUG);

  const [bet, setBet] = useState(100);
  const [side, setSide] = useState<CoinSide>('heads');
  const [flipping, setFlipping] = useState(false);
  const [face, setFace] = useState<CoinSide>('heads');
  const [result, setResult] = useState<{ win: boolean; outcome: CoinSide } | null>(null);
  const [fx, setFx] = useState<FxSignal>({ key: 0, type: null });

  const fxKey = useRef(0);
  const pending = useRef(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const stake = Math.max(1, Math.floor(bet));

  const flip = useCallback(() => {
    if (flipping || pending.current) return;
    if (!session) return void toast.error('Starting session… try again in a moment.');
    if (stake > balance) return void toast.error('Not enough demo coins — hit reload in the balance pill.');
    pending.current = true;
    setResult(null);
    setFlipping(true);
    sound.play('coin');

    const req: IBetRequest<CoinSide> = {
      gameId: SLUG,
      sessionId: session.sessionId,
      stake: { amount: String(stake), currency: 'INR' },
      mode: BetMode.Single,
      selections: [{ pick: side }],
      idempotencyKey: `${SLUG}:${session.sessionId}:${stat.seq}:${stake}`,
      clientSeed: 'demo',
    };
    void runtime
      .startRound<CoinFlipState>(req)
      .then(({ result: r, roundId }) => {
        timers.current.push(
          window.setTimeout(() => {
            setFace(r.state.outcome);
            setFlipping(false);
            setResult({ win: r.win, outcome: r.state.outcome });
            if (r.win) {
              fxKey.current += 1;
              setFx({ key: fxKey.current, type: 'win', amount: Math.round(stake * COIN_FLIP_CONFIG.payout) - stake });
              sound.play('reward');
              void runtime.cashOut({ roundId, atMultiplier: COIN_FLIP_CONFIG.payout }).catch(() => {});
            } else {
              sound.play('lose');
              void runtime.finishRound({ roundId, finalMultiplier: 0 }).catch(() => {});
            }
          }, FLIP_MS),
        );
      })
      .catch((e: unknown) => {
        setFlipping(false);
        toast.error(e instanceof Error ? e.message : 'Could not place bet.');
      })
      .finally(() => {
        pending.current = false;
      });
  }, [flipping, stake, balance, session, side, stat.seq, runtime]);

  return (
    <div className="grid gap-4 lg:gap-6 lg:grid-cols-[2.2fr_1fr] xl:grid-cols-[2.5fr_1fr]">
      <div className="card-premium relative flex aspect-[16/10] items-center justify-center overflow-hidden p-0">
        <GameFx trigger={fx} />
        <div className="absolute inset-0 bg-gradient-to-b from-white to-gold/5" />
        <div className="bg-grid absolute inset-0 opacity-40" />
        <div className="relative z-10 flex flex-col items-center gap-5" style={{ perspective: 800 }}>
          <motion.div
            animate={flipping ? { rotateY: [0, 1800] } : { rotateY: face === 'heads' ? 0 : 180 }}
            transition={flipping ? { duration: FLIP_MS / 1000, ease: 'easeOut' } : { duration: 0.3 }}
            className={cn(
              'grid h-32 w-32 place-items-center rounded-full font-display text-3xl font-bold shadow-glow-gold sm:h-40 sm:w-40 sm:text-4xl',
              'bg-gradient-to-br from-gold to-warning text-white ring-4 ring-gold/40',
            )}
            style={{ transformStyle: 'preserve-3d' }}
            aria-live="polite"
            aria-label={flipping ? 'Coin flipping' : `Coin shows ${face}`}
          >
            {flipping ? '?' : face === 'heads' ? 'H' : 'T'}
          </motion.div>
          {result ? (
            <p className={cn('font-display text-lg font-bold', result.win ? 'text-emerald' : 'text-destructive')}>
              {result.win ? `${face === 'heads' ? 'Heads' : 'Tails'} — you won!` : `${face === 'heads' ? 'Heads' : 'Tails'} — you lost`}
            </p>
          ) : (
            <p className="text-sm font-semibold text-muted-foreground">{flipping ? 'Flipping…' : 'Call it in the air'}</p>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="card-premium space-y-3 p-4">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Pick a side">
            {(['heads', 'tails'] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={side === s}
                onClick={() => setSide(s)}
                disabled={flipping}
                className={cn(
                  'rounded-xl border px-3 py-3 font-display text-sm font-bold capitalize transition-colors disabled:opacity-50',
                  side === s ? 'border-primary bg-primary/10 text-primary shadow-glow' : 'border-black/10 bg-white/60 text-muted-foreground hover:text-foreground',
                )}
              >
                {s} · 1.98×
              </button>
            ))}
          </div>
          <BetAmount value={bet} onChange={setBet} disabled={flipping} />
          <Button variant="gradient" size="lg" className="sheen w-full" onClick={flip} disabled={flipping}>
            <Zap className="h-5 w-5" /> {flipping ? 'Flipping…' : `Flip · ${stake.toLocaleString('en-US')}`}
          </Button>
        </div>
        <div className="card-premium grid grid-cols-2 gap-3 p-4 text-center">
          <Stat icon={<TrendingUp className="h-4 w-4 text-emerald" />} label="Rounds" value={String(stat.rounds)} />
          <Stat icon={<Coins className="h-4 w-4 text-gold" />} label="Best streak" value={String(stat.bestStreak)} />
        </div>
        <ProvablyFair session={session} />
        <HistoryStrip stat={stat} />
      </div>
    </div>
  );
}
