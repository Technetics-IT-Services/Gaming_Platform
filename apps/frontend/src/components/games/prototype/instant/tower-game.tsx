'use client';

import { Button, cn } from '@gaming-platform/ui';
import type { IBetRequest } from '@gaming-platform/types';
import { BetMode, RuntimeState, SettlementType } from '@gaming-platform/types';
import { motion } from 'framer-motion';
import { Check, RotateCcw, Skull, TrendingUp } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

import { GameFx, type FxSignal } from '@/components/games/prototype/game-fx';
import { BetAmount, HistoryStrip, ProvablyFair, Stat } from '@/components/games/prototype/instant/shared';
import { TOWER_CONFIG, type TowerState, towerMultiplier } from '@/games/instant/tower-engine';
import { sound } from '@/lib/sound';
import { useGameRuntime } from '@/runtime/react/use-game-runtime';
import { useDemoWallet } from '@/stores/demo-wallet';
import { useGameStat } from '@/stores/game-stats';

const SLUG = 'tower';
type Phase = 'idle' | 'playing' | 'done';

export function TowerGame() {
  const { runtime, session } = useGameRuntime(SLUG);
  const balance = useDemoWallet((s) => s.balance);
  const stat = useGameStat(SLUG);

  const [bet, setBet] = useState(100);
  const [phase, setPhase] = useState<Phase>('idle');
  const [gs, setGs] = useState<TowerState | null>(null);
  const [result, setResult] = useState<{ win: boolean; payout: number; multiplier: number } | null>(null);
  const [fx, setFx] = useState<FxSignal>({ key: 0, type: null });

  const roundIdRef = useRef<string | null>(null);
  const fxKey = useRef(0);
  const pending = useRef(false);

  const stake = Math.max(1, Math.floor(bet));
  const { rows, tilesPerRow } = TOWER_CONFIG;
  const level = gs?.level ?? 0;
  const picks = gs?.picks ?? [];
  const trapRows = gs?.trapRows;

  const finish = useCallback(
    (step: { gameState: TowerState; settlement?: { type: SettlementType; payout: string } }) => {
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
      .startInteractive<TowerState>(req)
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
  }, [phase, stake, balance, session, stat.seq, runtime]);

  const pick = useCallback(
    (tile: number) => {
      const roundId = roundIdRef.current;
      if (phase !== 'playing' || !roundId) return;
      sound.play('cardFlip');
      void runtime
        .submitAction<TowerState>({ roundId, action: { type: 'pick', payload: { tile } } })
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
    if (phase !== 'playing' || !roundId || level === 0) return;
    void runtime
      .submitAction<TowerState>({ roundId, action: { type: 'cashout' } })
      .then((step) => finish(step))
      .catch(() => {});
  }, [phase, level, runtime, finish]);

  return (
    <div className="grid gap-4 lg:gap-6 lg:grid-cols-[1.6fr_1fr]">
      <div className="card-premium relative overflow-hidden p-5">
        <GameFx trigger={fx} />
        <div className="absolute inset-0 bg-gradient-to-b from-accent/5 via-white to-primary/5" />
        <div className="relative mx-auto flex w-full max-w-[420px] flex-col gap-1.5">
          {Array.from({ length: rows }, (_, rFromTop) => {
            const row = rows - 1 - rFromTop; // render top → bottom
            const isCurrent = phase === 'playing' && row === level;
            const climbed = row < level;
            return (
              <div key={row} className={cn('grid gap-1.5', isCurrent && 'rounded-xl ring-2 ring-primary/40')} style={{ gridTemplateColumns: `repeat(${tilesPerRow}, 1fr)` }}>
                {Array.from({ length: tilesPerRow }, (_, tile) => {
                  const picked = climbed && picks[row] === tile;
                  const isTrap = trapRows && trapRows[row] === tile;
                  return (
                    <motion.button
                      key={tile}
                      type="button"
                      aria-label={`Row ${row + 1} tile ${tile + 1}`}
                      disabled={!isCurrent}
                      onClick={() => pick(tile)}
                      whileTap={{ scale: 0.94 }}
                      className={cn(
                        'grid h-11 place-items-center rounded-lg border text-sm font-bold transition-colors',
                        picked
                          ? 'border-emerald/50 bg-emerald/15 text-emerald'
                          : phase === 'done' && isTrap
                            ? 'border-destructive/50 bg-destructive/15 text-destructive'
                            : isCurrent
                              ? 'border-primary/40 bg-white/80 hover:bg-primary/10'
                              : 'border-black/10 bg-black/[0.03] text-muted-foreground opacity-60',
                      )}
                    >
                      {picked ? <Check className="h-4 w-4" /> : phase === 'done' && isTrap ? <Skull className="h-4 w-4" /> : climbed ? '·' : ''}
                    </motion.button>
                  );
                })}
              </div>
            );
          })}
        </div>
        {result ? (
          <p className={cn('relative mt-3 text-center font-display text-lg font-bold', result.win ? 'text-emerald' : 'text-destructive')}>
            {result.win ? `Escaped ${result.multiplier.toFixed(2)}× · +${(result.payout - stake).toLocaleString('en-US')}` : `Trapped! Lost ${stake.toLocaleString('en-US')}`}
          </p>
        ) : phase === 'playing' ? (
          <p className="relative mt-3 text-center text-sm font-semibold text-muted-foreground">
            Floor {level}/{rows} · next {towerMultiplier(TOWER_CONFIG, level + 1).toFixed(2)}×
          </p>
        ) : null}
      </div>

      <div className="space-y-4">
        <div className="card-premium space-y-3 p-4">
          <BetAmount value={bet} onChange={setBet} disabled={phase === 'playing'} />
          {phase === 'playing' ? (
            <Button variant="gold" size="lg" className="sheen w-full" onClick={cashout} disabled={level === 0}>
              Cash Out {gs ? gs.multiplier.toFixed(2) : '1.00'}× · {gs ? Math.round(stake * gs.multiplier).toLocaleString('en-US') : stake}
            </Button>
          ) : (
            <Button variant="gradient" size="lg" className="sheen w-full" onClick={start}>
              {phase === 'done' ? <RotateCcw className="h-5 w-5" /> : null} Bet · {stake.toLocaleString('en-US')}
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
