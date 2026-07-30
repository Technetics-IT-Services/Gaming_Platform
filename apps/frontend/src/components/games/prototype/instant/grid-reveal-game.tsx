'use client';

import { Button, cn } from '@gaming-platform/ui';
import type { IBetRequest } from '@gaming-platform/types';
import { BetMode, RuntimeState, SettlementType } from '@gaming-platform/types';
import { motion } from 'framer-motion';
import { Bomb, Coins, Flame, Gem, RotateCcw, TrendingUp } from 'lucide-react';
import { useCallback, useRef, useState, type ComponentType } from 'react';
import { toast } from 'sonner';

import { GameFx, type FxSignal } from '@/components/games/prototype/game-fx';
import { BetAmount, HistoryStrip, ProvablyFair, Stat } from '@/components/games/prototype/instant/shared';
import { type GridRevealState, gridMultiplier } from '@/games/instant/grid-reveal-engine';
import { sound } from '@/lib/sound';
import { useGameRuntime } from '@/runtime/react/use-game-runtime';
import { useDemoWallet } from '@/stores/demo-wallet';
import { useGameStat } from '@/stores/game-stats';

type Phase = 'idle' | 'playing' | 'done';

interface GridTheme {
  slug: string;
  cols: number;
  mineOptions: number[];
  SafeIcon: ComponentType<{ className?: string }>;
  MineIcon: ComponentType<{ className?: string }>;
  mineLabel: string;
}

/**
 * Shared grid-reveal UI (Phase 4B) — powers Mines (5×5) and Bomb Hunt (4×4). Pure
 * UI over the frozen interactive runtime: `startInteractive` → `submitAction`
 * (reveal / cashout). No engine/provider access.
 */
function GridRevealGame({ theme }: { theme: GridTheme }) {
  const { runtime, session } = useGameRuntime(theme.slug);
  const balance = useDemoWallet((s) => s.balance);
  const stat = useGameStat(theme.slug);
  const tiles = theme.cols * theme.cols;

  const [bet, setBet] = useState(100);
  const [mines, setMines] = useState(theme.mineOptions[1] ?? 3);
  const [phase, setPhase] = useState<Phase>('idle');
  const [gs, setGs] = useState<GridRevealState | null>(null);
  const [result, setResult] = useState<{ win: boolean; payout: number; multiplier: number } | null>(null);
  const [fx, setFx] = useState<FxSignal>({ key: 0, type: null });

  const roundIdRef = useRef<string | null>(null);
  const fxKey = useRef(0);
  const pending = useRef(false);

  const stake = Math.max(1, Math.floor(bet));
  const revealed = gs?.revealed ?? [];
  const board = new Set(gs?.board ?? []);
  const safeCount = tiles - mines;
  const nextMult = gs ? gridMultiplier(tiles, gs.mines, revealed.length + 1) : gridMultiplier(tiles, mines, 1);

  const finish = useCallback(
    (step: { state: RuntimeState; gameState: GridRevealState; settlement?: { type: SettlementType; payout: string } }) => {
      setGs(step.gameState);
      const win = step.settlement?.type === SettlementType.Win;
      const payout = Number(step.settlement?.payout ?? 0);
      setResult({ win, payout, multiplier: step.gameState.multiplier });
      setPhase('done');
      if (win) {
        fxKey.current += 1;
        setFx({ key: fxKey.current, type: 'win', amount: payout - stake });
        sound.play('cashout');
      } else {
        sound.play('explosion');
      }
    },
    [stake],
  );

  const start = useCallback(() => {
    if (phase === 'playing' || pending.current) return;
    if (!session) return void toast.error('Starting session… try again in a moment.');
    if (stake > balance) return void toast.error('Not enough demo coins — hit reload in the balance pill.');
    pending.current = true;
    setResult(null);
    const req: IBetRequest<{ mines: number }> = {
      gameId: theme.slug,
      sessionId: session.sessionId,
      stake: { amount: String(stake), currency: 'INR' },
      mode: BetMode.Single,
      selections: [{ pick: { mines } }],
      idempotencyKey: `${theme.slug}:${session.sessionId}:${stat.seq}:${stake}`,
      clientSeed: 'demo',
    };
    void runtime
      .startInteractive<GridRevealState>(req)
      .then(({ roundId, step }) => {
        roundIdRef.current = roundId;
        setGs(step.gameState);
        setPhase('playing');
        sound.play('chips');
      })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : 'Could not place bet.'))
      .finally(() => {
        pending.current = false;
      });
  }, [phase, stake, balance, session, mines, stat.seq, runtime, theme.slug]);

  const reveal = useCallback(
    (index: number) => {
      const roundId = roundIdRef.current;
      // The tile button is disabled once revealed, so no re-reveal guard is needed.
      if (phase !== 'playing' || !roundId) return;
      sound.play('cardFlip');
      void runtime
        .submitAction<GridRevealState>({ roundId, action: { type: 'reveal', payload: { index } } })
        .then((step) => {
          if (step.state === RuntimeState.Completed) finish(step);
          else setGs(step.gameState);
        })
        .catch(() => {});
    },
    [phase, runtime, finish],
  );

  const cashout = useCallback(() => {
    const roundId = roundIdRef.current;
    if (phase !== 'playing' || !roundId || (gs?.revealed.length ?? 0) === 0) return;
    void runtime
      .submitAction<GridRevealState>({ roundId, action: { type: 'cashout' } })
      .then((step) => finish(step))
      .catch(() => {});
  }, [phase, gs, runtime, finish]);

  return (
    <div className="grid gap-4 lg:gap-6 lg:grid-cols-[2fr_1fr] xl:grid-cols-[2.2fr_1fr]">
      <div className="card-premium relative overflow-hidden p-5">
        <GameFx trigger={fx} />
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-white to-accent/5" />
        <div
          className="relative mx-auto grid w-full max-w-[460px] gap-2"
          style={{ gridTemplateColumns: `repeat(${theme.cols}, 1fr)` }}
          role="grid"
          aria-label={`${theme.slug} board`}
        >
          {Array.from({ length: tiles }, (_, i) => {
            const isRevealed = revealed.includes(i);
            const isMine = board.has(i);
            const over = phase === 'done';
            const hit = gs?.hit === i;
            return (
              <motion.button
                key={i}
                type="button"
                role="gridcell"
                aria-label={`Tile ${i + 1}`}
                disabled={phase !== 'playing' || isRevealed}
                onClick={() => reveal(i)}
                whileTap={{ scale: 0.94 }}
                animate={hit ? { scale: [1, 1.15, 1] } : {}}
                className={cn(
                  'grid aspect-square place-items-center rounded-xl border text-xl font-bold transition-colors',
                  isRevealed
                    ? 'border-emerald/40 bg-emerald/10 text-emerald'
                    : over && isMine
                      ? 'border-destructive/50 bg-destructive/15 text-destructive'
                      : over
                        ? 'border-black/10 bg-black/[0.04] text-muted-foreground opacity-60'
                        : 'border-black/10 bg-white/70 hover:border-primary/40 hover:bg-primary/5',
                )}
              >
                {isRevealed ? <theme.SafeIcon className="h-5 w-5" /> : over && isMine ? <theme.MineIcon className="h-5 w-5" /> : ''}
              </motion.button>
            );
          })}
        </div>
        {result ? (
          <p className={cn('relative mt-3 text-center font-display text-lg font-bold', result.win ? 'text-emerald' : 'text-destructive')}>
            {result.win ? `Cashed out ${result.multiplier.toFixed(2)}× · +${(result.payout - stake).toLocaleString('en-US')}` : `${theme.mineLabel}! Lost ${stake.toLocaleString('en-US')}`}
          </p>
        ) : phase === 'playing' ? (
          <p className="relative mt-3 text-center text-sm font-semibold text-muted-foreground">
            {revealed.length}/{safeCount} safe · next {nextMult.toFixed(2)}×
          </p>
        ) : null}
      </div>

      <div className="space-y-4">
        <div className="card-premium space-y-3 p-4">
          <div className="text-xs font-semibold text-muted-foreground">
            {theme.mineLabel}s
            <div className="mt-1 flex flex-wrap gap-1.5" role="radiogroup" aria-label={`${theme.mineLabel} count`}>
              {theme.mineOptions.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={mines === n}
                  onClick={() => setMines(n)}
                  disabled={phase === 'playing'}
                  className={cn(
                    'rounded-lg border px-3 py-1 text-sm font-semibold transition-colors disabled:opacity-50',
                    mines === n ? 'border-primary bg-primary/10 text-primary' : 'border-black/10 bg-white/60 text-muted-foreground hover:text-foreground',
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <BetAmount value={bet} onChange={setBet} disabled={phase === 'playing'} />
          {phase === 'playing' ? (
            <Button variant="gold" size="lg" className="sheen w-full" onClick={cashout} disabled={revealed.length === 0}>
              Cash Out {gs ? gs.multiplier.toFixed(2) : '1.00'}× · {gs ? Math.round(stake * gs.multiplier).toLocaleString('en-US') : stake}
            </Button>
          ) : (
            <Button variant="gradient" size="lg" className="sheen w-full" onClick={start}>
              {phase === 'done' ? <RotateCcw className="h-5 w-5" /> : <Coins className="h-5 w-5" />} Bet · {stake.toLocaleString('en-US')}
            </Button>
          )}
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

export function MinesGame() {
  return <GridRevealGame theme={{ slug: 'mines', cols: 5, mineOptions: [1, 3, 5, 10], SafeIcon: Gem, MineIcon: Bomb, mineLabel: 'Mine' }} />;
}
export function BombHuntGame() {
  return <GridRevealGame theme={{ slug: 'bomb-hunt', cols: 4, mineOptions: [1, 3, 5], SafeIcon: Coins, MineIcon: Flame, mineLabel: 'Bomb' }} />;
}
