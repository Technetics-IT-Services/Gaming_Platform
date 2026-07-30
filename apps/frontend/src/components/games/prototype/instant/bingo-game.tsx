'use client';

import { Button, cn } from '@gaming-platform/ui';
import type { IBetRequest } from '@gaming-platform/types';
import { BetMode } from '@gaming-platform/types';
import { motion } from 'framer-motion';
import { Grid3x3, TrendingUp, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { GameFx, type FxSignal } from '@/components/games/prototype/game-fx';
import { BetAmount, HistoryStrip, ProvablyFair, Stat } from '@/components/games/prototype/instant/shared';
import { BINGO_CONFIG, type BingoState, bingoLines } from '@/games/instant/bingo-engine';
import { sound } from '@/lib/sound';
import { useGameRuntime } from '@/runtime/react/use-game-runtime';
import { useDemoWallet } from '@/stores/demo-wallet';
import { useGameStat } from '@/stores/game-stats';

const SLUG = 'bingo';
const SIZE = BINGO_CONFIG.size;
const CELLS = SIZE * SIZE;
const LINES = bingoLines(SIZE);

export function BingoGame() {
  const { runtime, session } = useGameRuntime(SLUG);
  const balance = useDemoWallet((s) => s.balance);
  const stat = useGameStat(SLUG);

  const [bet, setBet] = useState(100);
  const [playing, setPlaying] = useState(false);
  const [marked, setMarked] = useState<number[]>([]);
  const [shown, setShown] = useState(0);
  const [result, setResult] = useState<{ win: boolean; lines: number; multiplier: number } | null>(null);
  const [fx, setFx] = useState<FxSignal>({ key: 0, type: null });

  const fxKey = useRef(0);
  const pending = useRef(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const stake = Math.max(1, Math.floor(bet));
  const markedShown = new Set(marked.slice(0, shown));
  const doneLines = result ? LINES.filter((l) => l.every((c) => markedShown.has(c))) : [];
  const litCells = new Set(doneLines.flat());

  const play = useCallback(() => {
    if (playing || pending.current) return;
    if (!session) return void toast.error('Starting session… try again in a moment.');
    if (stake > balance) return void toast.error('Not enough demo coins — hit reload in the balance pill.');
    pending.current = true;
    setPlaying(true);
    setResult(null);
    setShown(0);
    const req: IBetRequest = {
      gameId: SLUG,
      sessionId: session.sessionId,
      stake: { amount: String(stake), currency: 'INR' },
      mode: BetMode.Single,
      selections: [{ pick: null }],
      idempotencyKey: `${SLUG}:${session.sessionId}:${stat.seq}:${stake}`,
      clientSeed: 'demo',
    };
    void runtime
      .startRound<BingoState>(req)
      .then(({ result: r, roundId }) => {
        setMarked(r.state.marked);
        r.state.marked.forEach((_, i) => {
          timers.current.push(window.setTimeout(() => { setShown(i + 1); sound.play('ball'); }, 130 * (i + 1)));
        });
        timers.current.push(
          window.setTimeout(() => {
            setPlaying(false);
            setResult({ win: r.win, lines: r.state.lines, multiplier: r.state.multiplier });
            if (r.win) {
              fxKey.current += 1;
              setFx({ key: fxKey.current, type: 'win', amount: Math.round(stake * r.state.multiplier) - stake });
              sound.play(r.state.lines >= 3 ? 'jackpot' : 'reward');
              void runtime.cashOut({ roundId, atMultiplier: r.state.multiplier }).catch(() => {});
            } else {
              sound.play('lose');
              void runtime.finishRound({ roundId, finalMultiplier: 0 }).catch(() => {});
            }
          }, 130 * r.state.marked.length + 300),
        );
      })
      .catch((e: unknown) => { setPlaying(false); toast.error(e instanceof Error ? e.message : 'Could not place bet.'); })
      .finally(() => { pending.current = false; });
  }, [playing, stake, balance, session, stat.seq, runtime]);

  return (
    <div className="grid gap-4 lg:gap-6 lg:grid-cols-[1.6fr_1fr]">
      <div className="card-premium relative flex flex-col items-center overflow-hidden p-5">
        <GameFx trigger={fx} />
        <div className="absolute inset-0 bg-gradient-to-b from-accent/5 via-white to-primary/5" />
        <div className="relative grid w-full max-w-[380px] gap-2" style={{ gridTemplateColumns: `repeat(${SIZE}, 1fr)` }} role="grid" aria-label="Bingo card">
          {Array.from({ length: CELLS }, (_, i) => {
            const isMarked = markedShown.has(i);
            const lit = litCells.has(i);
            return (
              <motion.div
                key={i}
                role="gridcell"
                aria-label={`Cell ${i + 1}${isMarked ? ' marked' : ''}`}
                animate={isMarked ? { scale: [0.8, 1.1, 1] } : {}}
                className={cn(
                  'grid aspect-square place-items-center rounded-lg border font-mono text-sm font-bold transition-colors',
                  lit ? 'border-emerald bg-emerald text-white shadow-glow'
                    : isMarked ? 'border-gold/50 bg-gold/20 text-gold'
                      : 'border-black/10 bg-white/70 text-muted-foreground',
                )}
              >
                {i + 1}
              </motion.div>
            );
          })}
        </div>
        <p className={cn('relative mt-3 text-center font-display text-lg font-bold', result ? (result.win ? 'text-emerald' : 'text-destructive') : 'text-muted-foreground')}>
          {result ? (result.lines > 0 ? `${result.lines} line${result.lines > 1 ? 's' : ''} · ${result.multiplier}×` : 'No line — try again') : playing ? 'Drawing…' : 'Press Play to draw'}
        </p>
      </div>

      <div className="space-y-4">
        <div className="card-premium space-y-3 p-4">
          <BetAmount value={bet} onChange={setBet} disabled={playing} />
          <Button variant="gradient" size="lg" className="sheen w-full" onClick={play} disabled={playing}>
            <Zap className="h-5 w-5" /> {playing ? 'Drawing…' : `Play · ${stake.toLocaleString('en-US')}`}
          </Button>
        </div>
        <div className="card-premium grid grid-cols-2 gap-3 p-4 text-center">
          <Stat icon={<TrendingUp className="h-4 w-4 text-emerald" />} label="Best ×" value={`${stat.highest.toFixed(2)}×`} />
          <Stat icon={<Grid3x3 className="h-4 w-4 text-gold" />} label="Rounds" value={String(stat.rounds)} />
        </div>
        <ProvablyFair session={session} />
        <HistoryStrip stat={stat} />
      </div>
    </div>
  );
}
