'use client';

import { Button, cn } from '@gaming-platform/ui';
import { AnimatePresence, motion } from 'framer-motion';
import { Cat, Flame, RotateCcw, TrendingUp, Trophy, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { IBetRequest } from '@gaming-platform/types';
import { BetMode } from '@gaming-platform/types';

import { GameFx, type FxSignal } from '@/components/games/prototype/game-fx';
import { PlayingCard } from '@/components/card/playing-card';
import { DT_PAYOUT, type DTSide, type DTState } from '@/games/cards/dragon-tiger-engine';
import type { Card } from '@/lib/deck';
import { sound } from '@/lib/sound';
import { useGameRuntime } from '@/runtime/react/use-game-runtime';
import { useDemoWallet } from '@/stores/demo-wallet';
import { useGameStat } from '@/stores/game-stats';

const SLUG = 'dragon-tiger';

type BetSide = DTSide;

const PAYOUT = DT_PAYOUT;
const CHIPS = [100, 500, 1000, 5000] as const;

type Outcome = DTState;

type Phase = 'idle' | 'dealing' | 'result';

export function DragonTigerGame() {
  // The Runtime owns bet/RNG/settlement/history; the UI only renders + collects
  // intent. Demo providers delegate to these same stores, so surfaces are unchanged.
  const { runtime, session } = useGameRuntime(SLUG);
  const balance = useDemoWallet((s) => s.balance);
  const stat = useGameStat(SLUG);

  const [bet, setBet] = useState(100);
  const [side, setSide] = useState<BetSide>('dragon');
  const [phase, setPhase] = useState<Phase>('idle');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [reveal, setReveal] = useState({ dragon: false, tiger: false });
  const [result, setResult] = useState<{ win: boolean; net: number } | null>(null);
  const [fx, setFx] = useState<FxSignal>({ key: 0, type: null });

  const timers = useRef<number[]>([]);
  const fxKeyRef = useRef(0);
  const stakeRef = useRef(0);
  const sideRef = useRef<BetSide>('dragon');
  const pendingRef = useRef(false);

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  /** Present the outcome + settle through the Runtime (win → cashOut, loss → finish). */
  const finish = useCallback(
    (roundId: string, win: boolean, mult: number, stake: number) => {
      const net = win ? Math.round(stake * mult) - stake : -stake;
      setResult({ win, net });
      if (win) {
        fxKeyRef.current += 1;
        setFx({ key: fxKeyRef.current, type: 'win', amount: net });
      }
      sound.play(win ? 'reward' : 'lose');
      setPhase('result');
      if (win) void runtime.cashOut({ roundId, atMultiplier: mult }).catch(() => {});
      else void runtime.finishRound({ roundId, finalMultiplier: 0 }).catch(() => {});
    },
    [runtime],
  );

  const run = useCallback(
    (o: Outcome, roundId: string, win: boolean, mult: number, stake: number) => {
      setOutcome(o);
      setResult(null);
      setReveal({ dragon: false, tiger: false });
      setPhase('dealing');

      timers.current.push(
        window.setTimeout(() => {
          setReveal((r) => ({ ...r, dragon: true }));
          sound.play('cardFlip');
        }, 450),
      );
      timers.current.push(
        window.setTimeout(() => {
          setReveal((r) => ({ ...r, tiger: true }));
          sound.play('cardFlip');
        }, 900),
      );
      timers.current.push(window.setTimeout(() => finish(roundId, win, mult, stake), 1400));
    },
    [finish],
  );

  const deal = useCallback(() => {
    if (phase === 'dealing' || pendingRef.current) return;
    const stake = Math.max(1, Math.floor(bet));
    if (!session) {
      toast.error('Starting session… try again in a moment.');
      return;
    }
    if (stake > balance) {
      toast.error('Not enough demo coins — hit reload in the balance pill.');
      return;
    }
    clearTimers();
    stakeRef.current = stake;
    sideRef.current = side;
    pendingRef.current = true;

    const betReq: IBetRequest<DTSide> = {
      gameId: SLUG,
      sessionId: session.sessionId,
      stake: { amount: String(stake), currency: 'INR' },
      mode: BetMode.Single,
      selections: [{ pick: side }],
      idempotencyKey: `${SLUG}:${session.sessionId}:${stat.seq}:${stake}`,
      clientSeed: 'demo',
    };
    sound.play('chips');
    // Runtime: validate → debit → engine (provably-fair deal). UI reveals to it.
    void runtime
      .startRound<DTState>(betReq)
      .then(({ result, roundId }) => {
        run(result.state, roundId, result.win, result.multiplier, stake);
      })
      .catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : 'Could not place bet.');
      })
      .finally(() => {
        pendingRef.current = false;
      });
  }, [phase, bet, balance, session, side, stat.seq, runtime, run, clearTimers]);

  const winner = phase === 'result' ? outcome?.winner : undefined;

  return (
    <div className="grid gap-4 lg:gap-6 lg:grid-cols-[2.2fr_1fr] xl:grid-cols-[2.5fr_1fr]">
      {/* Stage */}
      <div className="card-premium relative aspect-[16/10] overflow-hidden p-0">
        <GameFx trigger={fx} />
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-100 via-white to-emerald-50" />
        <div className="bg-grid absolute inset-0 opacity-30" />

        <div className="relative flex h-full flex-col items-center justify-center gap-4 p-4">
          <div className="absolute left-3 top-3 flex gap-1">
            {stat.history.slice(0, 6).map((r) => (
              <span
                key={r.id}
                className={cn(
                  'rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold',
                  r.win ? 'bg-emerald/15 text-emerald' : 'bg-destructive/15 text-destructive',
                )}
              >
                {r.label}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-8">
            <Side
              title="Dragon"
              icon={<Flame className="h-4 w-4" />}
              card={outcome?.dragon}
              shown={reveal.dragon}
              tone="text-destructive"
              highlight={winner === 'dragon'}
              dim={phase === 'result' && winner !== 'dragon' && winner !== 'tie'}
            />

            <div className="flex flex-col items-center gap-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              <Zap className="h-5 w-5 text-gold" />
              VS
            </div>

            <Side
              title="Tiger"
              icon={<Cat className="h-4 w-4" />}
              card={outcome?.tiger}
              shown={reveal.tiger}
              tone="text-warning"
              highlight={winner === 'tiger'}
              dim={phase === 'result' && winner !== 'tiger' && winner !== 'tie'}
            />
          </div>

          <div className="min-h-[2.5rem]">
            <AnimatePresence mode="wait">
              {phase === 'result' && result ? (
                <motion.p
                  key="res"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={cn(
                    'font-display text-2xl font-bold',
                    result.win ? 'text-emerald' : 'text-destructive',
                  )}
                >
                  {result.win
                    ? `You won +${result.net.toLocaleString('en-US')}`
                    : `${outcome?.winner === 'tie' ? 'Tie' : outcome?.winner === 'dragon' ? 'Dragon' : 'Tiger'} wins · ${result.net.toLocaleString('en-US')}`}
                </motion.p>
              ) : phase === 'idle' ? (
                <motion.p
                  key="idle"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="font-display text-lg font-bold text-foreground"
                >
                  High card wins — Dragon or Tiger?
                </motion.p>
              ) : (
                <motion.p
                  key="deal"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-sm font-semibold text-muted-foreground"
                >
                  Dealing…
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Controls + stats */}
      <div className="space-y-4">
        <div className="card-premium space-y-3 p-4">
          <div className="grid grid-cols-3 gap-2">
            {(['dragon', 'tie', 'tiger'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSide(s)}
                disabled={phase === 'dealing'}
                className={cn(
                  'rounded-xl border px-2 py-3 text-center transition-all disabled:opacity-60',
                  side === s
                    ? 'border-primary bg-primary/10 shadow-glow'
                    : 'border-black/10 bg-white/60 hover:border-primary/40',
                )}
              >
                <span className="block font-display text-sm font-bold capitalize text-foreground">
                  {s}
                </span>
                <span className="font-mono text-[11px] font-semibold text-muted-foreground">
                  {PAYOUT[s]}×
                </span>
              </button>
            ))}
          </div>

          <label className="block text-xs font-semibold text-muted-foreground">
            Bet amount
            <div className="mt-1 flex items-center rounded-xl border border-black/10 bg-white/70 px-2">
              <input
                type="number"
                min={1}
                value={bet}
                onChange={(e) => setBet(Math.max(1, Number(e.target.value)))}
                disabled={phase === 'dealing'}
                className="h-10 w-full bg-transparent font-mono text-sm outline-none"
              />
              <button
                onClick={() => setBet((b) => Math.max(1, Math.floor(b / 2)))}
                className="px-1 text-xs text-muted-foreground hover:text-foreground"
              >
                ½
              </button>
              <button
                onClick={() => setBet((b) => b * 2)}
                className="px-1 text-xs text-muted-foreground hover:text-foreground"
              >
                2×
              </button>
            </div>
          </label>

          <div className="flex flex-wrap gap-1.5">
            {CHIPS.map((v) => (
              <button
                key={v}
                onClick={() => setBet(v)}
                disabled={phase === 'dealing'}
                className="rounded-lg bg-black/[0.04] px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
              >
                {v.toLocaleString('en-US')}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <Button
              variant="gradient"
              size="lg"
              className="sheen w-full"
              disabled={phase === 'dealing'}
              onClick={() => deal()}
            >
              <Flame className="h-5 w-5" /> Deal · {bet.toLocaleString('en-US')}
            </Button>
            {phase === 'result' ? (
              <Button
                variant="glass"
                size="lg"
                onClick={() => deal()}
                title="Deal again"
              >
                <RotateCcw className="h-5 w-5" />
              </Button>
            ) : null}
          </div>
        </div>

        <div className="card-premium grid grid-cols-2 gap-3 p-4 text-center">
          <Stat
            icon={<TrendingUp className="h-4 w-4 text-emerald" />}
            label="Best mult"
            value={`${stat.highest.toFixed(2)}×`}
          />
          <Stat
            icon={<Trophy className="h-4 w-4 text-gold" />}
            label="Best streak"
            value={String(stat.bestStreak)}
          />
          <Stat label="Rounds" value={String(stat.rounds)} />
          <Stat label="Biggest win" value={`+${stat.biggestWin.toLocaleString('en-US')}`} />
        </div>

        <div className="card-premium p-4">
          <p className="mb-2 flex items-center gap-2 font-display text-sm font-bold">History</p>
          <div className="flex flex-wrap gap-1.5">
            {stat.history.slice(0, 14).map((r) => (
              <span
                key={r.id}
                className={cn(
                  'rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold',
                  r.win ? 'bg-emerald/15 text-emerald' : 'bg-destructive/15 text-destructive',
                )}
              >
                {r.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Side({
  title,
  icon,
  card,
  shown,
  tone,
  highlight,
  dim,
}: {
  title: string;
  icon: React.ReactNode;
  card?: Card;
  shown: boolean;
  tone: string;
  highlight?: boolean;
  dim?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-2xl px-5 py-3 transition-all',
        highlight && 'bg-emerald/10 shadow-glow ring-2 ring-emerald/50',
        dim && 'opacity-45',
      )}
    >
      <div className={cn('flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide', tone)}>
        {icon}
        {title}
      </div>
      <PlayingCard code={shown ? card : undefined} faceDown={!shown} index={0} />
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
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
