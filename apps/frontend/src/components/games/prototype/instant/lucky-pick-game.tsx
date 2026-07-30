'use client';

import { Button, cn } from '@gaming-platform/ui';
import type { IBetRequest } from '@gaming-platform/types';
import { BetMode } from '@gaming-platform/types';
import { motion } from 'framer-motion';
import { Gift, RotateCcw, TrendingUp } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

import { GameFx, type FxSignal } from '@/components/games/prototype/game-fx';
import { BetAmount, HistoryStrip, ProvablyFair, Stat } from '@/components/games/prototype/instant/shared';
import { LUCKY_PICK_CONFIG, type LuckyPickState } from '@/games/instant/lucky-pick-engine';
import { sound } from '@/lib/sound';
import { useGameRuntime } from '@/runtime/react/use-game-runtime';
import { useDemoWallet } from '@/stores/demo-wallet';
import { useGameStat } from '@/stores/game-stats';

const SLUG = 'lucky-pick';
const BOXES = LUCKY_PICK_CONFIG.boxes;

export function LuckyPickGame() {
  const { runtime, session } = useGameRuntime(SLUG);
  const balance = useDemoWallet((s) => s.balance);
  const stat = useGameStat(SLUG);

  const [bet, setBet] = useState(100);
  const [phase, setPhase] = useState<'idle' | 'revealing' | 'done'>('idle');
  const [picked, setPicked] = useState<number | null>(null);
  const [boxes, setBoxes] = useState<number[] | null>(null);
  const [result, setResult] = useState<{ win: boolean; multiplier: number } | null>(null);
  const [fx, setFx] = useState<FxSignal>({ key: 0, type: null });

  const fxKey = useRef(0);
  const pending = useRef(false);

  const stake = Math.max(1, Math.floor(bet));

  const pick = useCallback(
    (box: number) => {
      if (phase === 'revealing' || pending.current) return;
      if (!session) return void toast.error('Starting session… try again in a moment.');
      if (stake > balance) return void toast.error('Not enough demo coins — hit reload in the balance pill.');
      pending.current = true;
      setPicked(box);
      setBoxes(null);
      setResult(null);
      setPhase('revealing');
      sound.play('cardFlip');
      const req: IBetRequest<number> = {
        gameId: SLUG,
        sessionId: session.sessionId,
        stake: { amount: String(stake), currency: 'INR' },
        mode: BetMode.Single,
        selections: [{ pick: box }],
        idempotencyKey: `${SLUG}:${session.sessionId}:${stat.seq}:${stake}`,
        clientSeed: 'demo',
      };
      void runtime
        .startRound<LuckyPickState>(req)
        .then(({ result: r, roundId }) => {
          setBoxes(r.state.boxes);
          setPhase('done');
          setResult({ win: r.win, multiplier: r.state.multiplier });
          if (r.win) {
            fxKey.current += 1;
            setFx({ key: fxKey.current, type: 'win', amount: Math.round(stake * r.state.multiplier) - stake });
            sound.play(r.state.multiplier >= 10 ? 'jackpot' : 'reward');
            void runtime.cashOut({ roundId, atMultiplier: r.state.multiplier }).catch(() => {});
          } else {
            sound.play('lose');
            void runtime.finishRound({ roundId, finalMultiplier: 0 }).catch(() => {});
          }
        })
        .catch((e: unknown) => { setPhase('idle'); toast.error(e instanceof Error ? e.message : 'Could not place bet.'); })
        .finally(() => { pending.current = false; });
    },
    [phase, stake, balance, session, stat.seq, runtime],
  );

  return (
    <div className="grid gap-4 lg:gap-6 lg:grid-cols-[1.6fr_1fr]">
      <div className="card-premium relative flex flex-col items-center justify-center overflow-hidden p-6">
        <GameFx trigger={fx} />
        <div className="absolute inset-0 bg-gradient-to-b from-gold/5 via-white to-primary/5" />
        <p className="relative mb-4 font-display text-sm font-bold text-muted-foreground">
          {phase === 'idle' ? 'Pick a box' : phase === 'revealing' ? 'Revealing…' : result?.win ? `You found ${result.multiplier}×!` : 'Empty box — try again'}
        </p>
        <div className="relative grid w-full max-w-[520px] grid-cols-5 gap-2 sm:gap-3" role="group" aria-label="Boxes">
          {Array.from({ length: BOXES }, (_, i) => {
            const isPicked = picked === i;
            const mult = boxes?.[i];
            const revealed = phase === 'done' && mult !== undefined;
            return (
              <motion.button
                key={i}
                type="button"
                aria-label={`Box ${i + 1}${revealed ? ` — ${mult}×` : ''}`}
                disabled={phase === 'revealing'}
                onClick={() => pick(i)}
                whileHover={phase === 'idle' ? { y: -4 } : {}}
                whileTap={{ scale: 0.95 }}
                animate={isPicked && revealed ? { scale: [1, 1.1, 1] } : {}}
                className={cn(
                  'grid aspect-[3/4] place-items-center rounded-2xl border-2 font-display text-xl font-bold transition-colors',
                  revealed
                    ? mult! >= 1
                      ? isPicked ? 'border-emerald bg-emerald/15 text-emerald shadow-glow' : 'border-emerald/30 bg-emerald/5 text-emerald/70'
                      : isPicked ? 'border-destructive/50 bg-destructive/10 text-destructive' : 'border-black/10 bg-black/[0.03] text-muted-foreground opacity-60'
                    : 'border-gold/40 bg-gradient-to-br from-gold/10 to-warning/10 text-gold hover:border-gold',
                )}
              >
                {revealed ? (mult! >= 1 ? `${mult}×` : '—') : <Gift className="h-7 w-7" />}
              </motion.button>
            );
          })}
        </div>
      </div>

      <div className="space-y-4">
        <div className="card-premium space-y-3 p-4">
          <BetAmount value={bet} onChange={setBet} disabled={phase === 'revealing'} />
          <p className="text-center text-xs text-muted-foreground">
            {phase === 'done' ? 'Adjust your bet, then pick a box to play again.' : 'Set your bet, then pick a box above.'}
          </p>
          {phase === 'done' ? (
            <Button variant="glass" size="sm" className="w-full" onClick={() => { setPhase('idle'); setPicked(null); setBoxes(null); setResult(null); }}>
              <RotateCcw className="h-4 w-4" /> New round
            </Button>
          ) : null}
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
