'use client';

import { Button, cn } from '@gaming-platform/ui';
import type { IBetRequest } from '@gaming-platform/types';
import { BetMode } from '@gaming-platform/types';
import { motion } from 'framer-motion';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

import { GameFx, type FxSignal } from '@/components/games/prototype/game-fx';
import { PLINKO_MULT, type PlinkoState } from '@/games/plinko-engine';
import { sound } from '@/lib/sound';
import { useGameRuntime } from '@/runtime/react/use-game-runtime';
import { useDemoWallet } from '@/stores/demo-wallet';
import { useGameStat } from '@/stores/game-stats';

const ROWS = 12;
const BINS = ROWS + 1;
// Multiplier table lives in the shared Plinko engine (single source of truth).
const MULT = PLINKO_MULT;
const CHIPS = [100, 500, 1000, 5000];

function binColor(m: number) {
  if (m >= 8) return 'from-pink to-violet text-white';
  if (m >= 2) return 'from-gold to-warning text-white';
  if (m >= 1) return 'from-accent to-primary text-white';
  return 'from-muted to-muted text-muted-foreground';
}

export function PlinkoGame() {
  // The Runtime owns bet/RNG/settlement/history; the UI only renders + collects
  // intent. Demo providers delegate to these same stores, so surfaces are unchanged.
  const { runtime, session } = useGameRuntime('plinko');
  const balance = useDemoWallet((s) => s.balance);
  const stat = useGameStat('plinko');

  const [bet, setBet] = useState(500);
  const [dropping, setDropping] = useState(false);
  const [ball, setBall] = useState<{ x: number; y: number } | null>(null);
  const [landedBin, setLandedBin] = useState<number | null>(null);
  const [result, setResult] = useState<{ mult: number; win: number } | null>(null);
  const [fx, setFx] = useState<FxSignal>({ key: 0, type: null });
  const timers = useRef<number[]>([]);
  const fxKey = useRef(0);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const drop = useCallback(() => {
    if (dropping) return;
    const stake = Math.max(1, Math.floor(bet));
    if (!session) {
      toast.error('Starting session… try again in a moment.');
      return;
    }
    if (stake > balance) {
      toast.error('Not enough demo coins — reload from the balance pill.');
      return;
    }
    clear();
    setDropping(true);
    setResult(null);
    setLandedBin(null);

    const betReq: IBetRequest = {
      gameId: 'plinko',
      sessionId: session.sessionId,
      stake: { amount: String(stake), currency: 'INR' },
      mode: BetMode.Single,
      selections: [{ pick: null }],
      idempotencyKey: `plinko:${session.sessionId}:${stat.seq}:${stake}`,
      clientSeed: 'demo',
    };

    // Runtime: validate → debit → engine (provably-fair walk). UI drops the ball to it.
    void runtime
      .startRound<PlinkoState>(betReq)
      .then(({ result, roundId }) => {
        const { dirs, bin, mult } = result.state;
        const win = result.win;
        const binCenterX = ((bin + 0.5) / BINS) * 100;

        // animate down the pegs (exact same path the engine walked)
        let x = 50;
        setBall({ x: 50, y: 3 });
        const step = 90;
        for (let i = 0; i < ROWS; i++) {
          const dir = dirs[i]!;
          x += dir * (44 / ROWS);
          const y = 3 + ((i + 1) / ROWS) * 78;
          timers.current.push(
            window.setTimeout(() => {
              setBall({ x, y });
              sound.play('diceBounce');
            }, step * (i + 1)),
          );
        }
        // land in bin
        timers.current.push(
          window.setTimeout(
            () => {
              setBall({ x: binCenterX, y: 92 });
              setLandedBin(bin);
              const winAmt = Math.round(stake * mult);
              fxKey.current += 1;
              if (win) setFx({ key: fxKey.current, type: 'win', amount: winAmt - stake });
              // Runtime settles: win → cashOut, loss → finish (credit + history + stats + XP).
              if (win) void runtime.cashOut({ roundId, atMultiplier: mult }).catch(() => {});
              else void runtime.finishRound({ roundId, finalMultiplier: 0 }).catch(() => {});
              setResult({ mult, win: winAmt });
              setDropping(false);
            },
            step * (ROWS + 1),
          ),
        );
      })
      .catch((e: unknown) => {
        setDropping(false);
        toast.error(e instanceof Error ? e.message : 'Could not place bet.');
      });
  }, [dropping, bet, balance, session, stat.seq, runtime]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
      {/* Board */}
      <div className="card-premium relative overflow-hidden p-5">
        <GameFx trigger={fx} />
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-white to-accent/5" />
        <div className="relative aspect-[4/5] w-full">
          {/* pegs */}
          {Array.from({ length: ROWS }).map((_, row) =>
            Array.from({ length: row + 3 }).map((__, col) => {
              const count = row + 3;
              const x = ((col + 0.5) / count) * 100;
              const y = 5 + (row / ROWS) * 78;
              return (
                <span
                  key={`${row}-${col}`}
                  className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/40"
                  style={{ left: `${x}%`, top: `${y}%` }}
                />
              );
            }),
          )}
          {/* ball */}
          {ball ? (
            <motion.span
              animate={{ left: `${ball.x}%`, top: `${ball.y}%` }}
              transition={{ duration: 0.09, ease: 'easeIn' }}
              className="absolute z-10 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-gold to-warning shadow-glow-gold"
            />
          ) : null}
          {/* bins */}
          <div className="absolute inset-x-0 bottom-0 flex gap-0.5 px-0.5">
            {MULT.map((m, i) => (
              <div
                key={i}
                className={cn(
                  'flex-1 rounded-md bg-gradient-to-b py-1 text-center font-mono text-[10px] font-bold transition-transform',
                  binColor(m),
                  landedBin === i && 'scale-110 ring-2 ring-foreground/40',
                )}
              >
                {m}×
              </div>
            ))}
          </div>
        </div>
        {result ? (
          <div className="relative mt-2 text-center font-display text-lg font-bold">
            <span className={result.mult >= 1 ? 'text-emerald' : 'text-destructive'}>
              {result.mult}× · {result.mult >= 1 ? `+${result.win.toLocaleString('en-US')}` : `-${(bet - result.win).toLocaleString('en-US')}`}
            </span>
          </div>
        ) : null}
      </div>

      {/* Controls */}
      <div className="space-y-4">
        <div className="card-premium space-y-3 p-4">
          <label className="text-xs font-semibold text-muted-foreground">
            Bet amount
            <div className="mt-1 flex items-center rounded-xl border border-black/10 bg-white/70 px-2">
              <input
                type="number"
                min={1}
                value={bet}
                onChange={(e) => setBet(Math.max(1, Number(e.target.value)))}
                disabled={dropping}
                className="h-10 w-full bg-transparent font-mono text-sm outline-none"
              />
              <button onClick={() => setBet((b) => Math.max(1, Math.floor(b / 2)))} disabled={dropping} className="px-1 text-xs text-muted-foreground hover:text-foreground">½</button>
              <button onClick={() => setBet((b) => b * 2)} disabled={dropping} className="px-1 text-xs text-muted-foreground hover:text-foreground">2×</button>
            </div>
          </label>
          <div className="flex flex-wrap gap-1.5">
            {CHIPS.map((v) => (
              <button key={v} onClick={() => setBet(v)} disabled={dropping} className="rounded-lg bg-black/[0.04] px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary">
                {v.toLocaleString('en-US')}
              </button>
            ))}
          </div>
          <Button variant="gradient" size="lg" className="w-full sheen" onClick={drop} disabled={dropping}>
            {dropping ? 'Dropping…' : `Drop ball · ${bet.toLocaleString('en-US')}`}
          </Button>
        </div>

        <div className="card-premium grid grid-cols-2 gap-3 p-4 text-center">
          <div className="rounded-xl bg-black/[0.03] p-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Best ×</div>
            <div className="mt-0.5 font-display text-lg font-bold tabular-nums">{stat.highest}×</div>
          </div>
          <div className="rounded-xl bg-black/[0.03] p-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Drops</div>
            <div className="mt-0.5 font-display text-lg font-bold tabular-nums">{stat.rounds}</div>
          </div>
        </div>

        <div className="card-premium p-4">
          <p className="mb-2 font-display text-sm font-bold">Recent drops</p>
          <div className="flex flex-wrap gap-1.5">
            {stat.history.slice(0, 14).map((r) => (
              <span key={r.id} className={cn('rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold', r.win ? 'bg-emerald/15 text-emerald' : 'bg-destructive/15 text-destructive')}>
                {r.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
