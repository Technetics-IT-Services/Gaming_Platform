'use client';

import { Button, cn } from '@gaming-platform/ui';
import type { IBetRequest } from '@gaming-platform/types';
import { BetMode } from '@gaming-platform/types';
import { motion } from 'framer-motion';
import { Rocket, RotateCcw, TrendingUp, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { GameFx, type FxSignal } from '@/components/games/prototype/game-fx';
import { type LimboPick, type LimboState } from '@/games/instant/limbo-engine';
import { sound } from '@/lib/sound';
import { useGameRuntime } from '@/runtime/react/use-game-runtime';
import { useDemoWallet } from '@/stores/demo-wallet';
import { useGameStat } from '@/stores/game-stats';

const SLUG = 'limbo';
const CHIPS = [100, 500, 1000, 5000] as const;
const ROLL_MS = 900;

/**
 * Limbo (Phase 4 — new instant game). Pure UI over the frozen Runtime: it calls
 * ONLY `useGameRuntime` + `startRound`/`cashOut`/`finishRound` — never a provider,
 * wallet, RNG or settlement directly. The engine (registered as `limbo`) owns the
 * outcome; this component only renders + collects intent.
 */
export function LimboGame() {
  const { runtime, session } = useGameRuntime(SLUG);
  const balance = useDemoWallet((s) => s.balance);
  const stat = useGameStat(SLUG);

  const [bet, setBet] = useState(100);
  const [target, setTarget] = useState(2);
  const [rolling, setRolling] = useState(false);
  const [display, setDisplay] = useState(1);
  const [result, setResult] = useState<{ win: boolean; generated: number; payout: number } | null>(null);
  const [fx, setFx] = useState<FxSignal>({ key: 0, type: null });

  const raf = useRef(0);
  const fxKeyRef = useRef(0);
  const pendingRef = useRef(false);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const stake = Math.max(1, Math.floor(bet));
  const winChance = Math.min(100, (0.99 / target) * 100);
  const potential = Math.round(stake * target);

  const settle = useCallback(
    (generated: number, win: boolean, roundId: string) => {
      const payout = win ? Math.round(stake * target) : 0;
      setResult({ win, generated, payout });
      if (win) {
        fxKeyRef.current += 1;
        setFx({ key: fxKeyRef.current, type: 'win', amount: payout - stake });
        sound.play('reward');
        void runtime.cashOut({ roundId, atMultiplier: target }).catch(() => {});
      } else {
        setFx({ key: fxKeyRef.current, type: 'lose' });
        sound.play('lose');
        void runtime.finishRound({ roundId, finalMultiplier: 0 }).catch(() => {});
      }
      setRolling(false);
    },
    [runtime, stake, target],
  );

  const animateTo = useCallback(
    (generated: number, win: boolean, roundId: string) => {
      const start = performance.now();
      const step = () => {
        const p = Math.min(1, (performance.now() - start) / ROLL_MS);
        const eased = 1 - Math.pow(1 - p, 3);
        setDisplay(1 + (generated - 1) * eased);
        if (p < 1) {
          raf.current = requestAnimationFrame(step);
          return;
        }
        setDisplay(generated);
        settle(generated, win, roundId);
      };
      raf.current = requestAnimationFrame(step);
    },
    [settle],
  );

  const roll = useCallback(() => {
    if (rolling || pendingRef.current) return;
    if (!session) {
      toast.error('Starting session… try again in a moment.');
      return;
    }
    if (stake > balance) {
      toast.error('Not enough demo coins — hit reload in the balance pill.');
      return;
    }
    pendingRef.current = true;
    setResult(null);
    setRolling(true);
    setDisplay(1);
    sound.play('diceRoll');
    const betReq: IBetRequest<LimboPick> = {
      gameId: SLUG,
      sessionId: session.sessionId,
      stake: { amount: String(stake), currency: 'INR' },
      mode: BetMode.Single,
      selections: [{ pick: { target } }],
      idempotencyKey: `${SLUG}:${session.sessionId}:${stat.seq}:${stake}`,
      clientSeed: 'demo',
    };
    void runtime
      .startRound<LimboState>(betReq)
      .then(({ result: r, roundId }) => animateTo(r.state.generated, r.win, roundId))
      .catch((e: unknown) => {
        setRolling(false);
        toast.error(e instanceof Error ? e.message : 'Could not place bet.');
      })
      .finally(() => {
        pendingRef.current = false;
      });
  }, [rolling, stake, balance, session, target, stat.seq, runtime, animateTo]);

  const color = result ? (result.win ? 'text-emerald' : 'text-destructive') : 'text-primary';

  return (
    <div className="grid gap-4 lg:gap-6 lg:grid-cols-[2.2fr_1fr] xl:grid-cols-[2.5fr_1fr]">
      <div className="card-premium relative aspect-[16/10] overflow-hidden p-0">
        <GameFx trigger={fx} />
        <div className="absolute inset-0 bg-gradient-to-b from-white to-primary/5" />
        <div className="bg-grid absolute inset-0 opacity-40" />
        <div className="absolute left-3 top-3 z-10 flex gap-1">
          {stat.history.slice(0, 6).map((h) => (
            <span
              key={h.id}
              className={cn('rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold', h.win ? 'bg-emerald/15 text-emerald' : 'bg-destructive/15 text-destructive')}
            >
              {h.label}
            </span>
          ))}
        </div>
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center">
          <motion.div
            animate={{ scale: rolling ? [1, 1.03, 1] : 1 }}
            transition={{ duration: 0.35, repeat: rolling ? Infinity : 0 }}
            className={cn('font-display text-7xl font-bold tabular-nums sm:text-8xl', color, (rolling || result) && 'text-glow')}
          >
            {display.toFixed(2)}×
          </motion.div>
          {result ? (
            <p className={cn('mt-2 font-display text-lg font-bold', result.win ? 'text-emerald' : 'text-destructive')}>
              {result.win ? `You won +${(result.payout - stake).toLocaleString('en-US')}` : `Busted below ${target.toFixed(2)}×`}
            </p>
          ) : (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Rocket className="h-4 w-4 text-primary" /> Beat <span className="font-mono font-bold text-foreground">{target.toFixed(2)}×</span>
            </p>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="card-premium space-y-3 p-4">
          <label className="block text-xs font-semibold text-muted-foreground">
            Bet amount
            <div className="mt-1 flex items-center rounded-xl border border-black/10 bg-white/70 px-2">
              <input
                type="number"
                min={1}
                value={bet}
                onChange={(e) => setBet(Math.max(1, Number(e.target.value)))}
                disabled={rolling}
                className="h-10 w-full bg-transparent font-mono text-sm outline-none tabular-nums"
              />
            </div>
          </label>
          <div>
            {CHIPS.map((v) => (
              <button
                key={v}
                onClick={() => setBet(v)}
                disabled={rolling}
                className="mr-1.5 rounded-lg bg-black/[0.04] px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-40"
              >
                {v.toLocaleString('en-US')}
              </button>
            ))}
          </div>
          <label className="block text-xs font-semibold text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>Target multiplier</span>
              <span className="font-mono text-sm font-bold text-foreground tabular-nums">{target.toFixed(2)}×</span>
            </div>
            <input
              type="range"
              min={1.01}
              max={100}
              step={0.01}
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
              disabled={rolling}
              className="mt-2 w-full accent-primary disabled:opacity-50"
            />
          </label>
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-black/[0.03] p-2 text-center">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Win chance</div>
              <div className="mt-0.5 font-mono text-sm font-bold tabular-nums">{winChance.toFixed(2)}%</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Payout</div>
              <div className="mt-0.5 font-mono text-sm font-bold tabular-nums">{potential.toLocaleString('en-US')}</div>
            </div>
          </div>
          <Button variant="gradient" size="lg" className="sheen w-full" onClick={roll} disabled={rolling}>
            <Zap className="h-5 w-5" /> {rolling ? 'Rolling…' : `Bet · ${stake.toLocaleString('en-US')}`}
          </Button>
        </div>

        <div className="card-premium grid grid-cols-2 gap-3 p-4 text-center">
          <div className="rounded-xl bg-black/[0.03] p-2">
            <div className="flex items-center justify-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              <TrendingUp className="h-4 w-4 text-emerald" /> Best
            </div>
            <div className="mt-0.5 font-display text-lg font-bold tabular-nums">{stat.highest.toFixed(2)}×</div>
          </div>
          <div className="rounded-xl bg-black/[0.03] p-2">
            <div className="flex items-center justify-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              <RotateCcw className="h-4 w-4 text-gold" /> Rounds
            </div>
            <div className="mt-0.5 font-display text-lg font-bold tabular-nums">{stat.rounds}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
