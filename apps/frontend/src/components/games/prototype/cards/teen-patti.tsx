'use client';

import { Badge, Button, cn } from '@gaming-platform/ui';
import type { IBetRequest } from '@gaming-platform/types';
import { BetMode } from '@gaming-platform/types';
import { motion } from 'framer-motion';
import { Crown, RotateCcw, Sparkles, Trophy, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { PlayingCard } from '@/components/card/playing-card';
import { GameFx, type FxSignal } from '@/components/games/prototype/game-fx';
import { AnimatedNumber } from '@/components/marketing/animated-number';
import { type HandRank, type TeenPattiState } from '@/games/cards/teen-patti-engine';
import type { Card } from '@/lib/deck';
import { sound } from '@/lib/sound';
import { useGameRuntime } from '@/runtime/react/use-game-runtime';
import { useDemoWallet } from '@/stores/demo-wallet';
import { useGameStat } from '@/stores/game-stats';

const SLUG = 'teen-patti';
const CHIPS = [100, 500, 1000, 5000];

type Phase = 'idle' | 'dealing' | 'done';

/**
 * Teen Patti (3-card Indian poker) hand ranking, strongest first:
 *   6 Trail (three of a kind) · 5 Pure sequence (straight flush) ·
 *   4 Sequence (straight) · 3 Color (flush) · 2 Pair · 1 High card.
 * A small "hand rank" bonus scales the payout for stronger winning hands.
 */
export const HAND_NAMES = ['High Card', 'Pair', 'Color', 'Sequence', 'Pure Sequence', 'Trail'] as const;
interface Deal {
  player: Card[];
  dealer: Card[];
}

export function TeenPattiGame() {
  // The Runtime owns bet/RNG/settlement/history; the UI only renders + collects
  // intent. Demo providers delegate to these same stores, so surfaces are unchanged.
  const { runtime, session } = useGameRuntime(SLUG);
  const balance = useDemoWallet((s) => s.balance);
  const stat = useGameStat(SLUG);

  const [phase, setPhase] = useState<Phase>('idle');
  const [bet, setBet] = useState(100);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [result, setResult] = useState<{
    win: boolean;
    net: number;
    playerRank: HandRank;
    dealerRank: HandRank;
    cmp: number;
  } | null>(null);
  const [fx, setFx] = useState<FxSignal>({ key: 0, type: null });

  const timers = useRef<number[]>([]);
  const fxKeyRef = useRef(0);
  const pendingRef = useRef(false);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  /** Present the outcome + settle through the Runtime (win → cashOut, loss → finish). */
  const settle = useCallback(
    (roundId: string, win: boolean, mult: number, stake: number, s: TeenPattiState) => {
      const net = win ? Math.round(stake * mult) - stake : -stake;
      setResult({ win, net, playerRank: s.playerRank, dealerRank: s.dealerRank, cmp: s.cmp });
      setPhase('done');
      sound.play(win ? 'reward' : 'lose');
      if (win) {
        fxKeyRef.current += 1;
        setFx({ key: fxKeyRef.current, type: 'win', amount: net });
        toast.success(`${s.playerRank.name}! +${net.toLocaleString('en-US')}`);
        void runtime.cashOut({ roundId, atMultiplier: mult }).catch(() => {});
      } else {
        toast.error(s.cmp === 0 ? 'Tie — dealer edge.' : `Dealer's ${s.dealerRank.name} wins.`);
        void runtime.finishRound({ roundId, finalMultiplier: 0 }).catch(() => {});
      }
    },
    [runtime],
  );

  const play = useCallback(() => {
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
    pendingRef.current = true;

    const betReq: IBetRequest = {
      gameId: SLUG,
      sessionId: session.sessionId,
      stake: { amount: String(stake), currency: 'INR' },
      mode: BetMode.Single,
      selections: [{ pick: null }],
      idempotencyKey: `${SLUG}:${session.sessionId}:${stat.seq}:${stake}`,
      clientSeed: 'demo',
    };
    void runtime
      .startRound<TeenPattiState>(betReq)
      .then(({ result, roundId }) => {
        const s = result.state;
        setDeal({ player: s.player, dealer: s.dealer });
        setResult(null);
        setRevealed(false);
        setPhase('dealing');
        sound.play('cardFlip');
        timers.current.push(window.setTimeout(() => sound.play('cardFlip'), 220));
        timers.current.push(window.setTimeout(() => sound.play('cardFlip'), 440));
        timers.current.push(
          window.setTimeout(() => {
            setRevealed(true);
            sound.play('cardFlip');
          }, 700),
        );
        timers.current.push(
          window.setTimeout(() => {
            settle(roundId, result.win, result.multiplier, stake, s);
          }, 1250),
        );
      })
      .catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : 'Could not place bet.');
      })
      .finally(() => {
        pendingRef.current = false;
      });
  }, [phase, bet, balance, session, stat.seq, runtime, settle]);

  const dealing = phase === 'dealing';

  return (
    <div className="grid gap-4 lg:gap-6 lg:grid-cols-[2.2fr_1fr] xl:grid-cols-[2.5fr_1fr]">
      {/* Stage */}
      <div className="card-premium relative aspect-[16/10] overflow-hidden p-0">
        <GameFx trigger={fx} />
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-100 via-white to-emerald-50" />
        <div className="bg-grid absolute inset-0 opacity-40" />

        <div className="relative z-10 flex h-full flex-col items-center justify-center gap-4 p-6">
          <HandRow
            label="Dealer"
            cards={deal?.dealer}
            faceDown={!revealed}
            rank={result?.dealerRank}
            winner={phase === 'done' && result ? result.cmp < 0 : false}
          />

          <div className="flex items-center gap-2">
            <span className="h-px w-10 bg-emerald-300/60" />
            <span className="font-display text-xs font-bold uppercase tracking-widest text-emerald-700/50">
              vs
            </span>
            <span className="h-px w-10 bg-emerald-300/60" />
          </div>

          <HandRow
            label="You"
            cards={deal?.player}
            faceDown={!revealed}
            rank={result?.playerRank}
            winner={phase === 'done' && result ? result.cmp > 0 : false}
          />

          {phase === 'idle' && !deal ? (
            <div className="text-center">
              <Crown className="mx-auto mb-1 h-8 w-8 animate-float text-gold" />
              <p className="font-display text-base font-bold text-foreground">Ante up & deal 3 cards</p>
              <p className="text-sm text-muted-foreground">Best Teen Patti hand wins</p>
            </div>
          ) : phase === 'done' && result ? (
            <motion.div
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className={cn(
                'flex items-center gap-2 rounded-full px-4 py-1.5 font-display text-sm font-bold shadow',
                result.win ? 'bg-emerald/15 text-emerald' : 'bg-destructive/15 text-destructive',
              )}
            >
              {result.win ? <Trophy className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
              {result.win
                ? `${result.playerRank.name} · +${result.net.toLocaleString('en-US')}`
                : `Lost ${result.net.toLocaleString('en-US')}`}
            </motion.div>
          ) : (
            <p className="font-display text-sm font-semibold text-emerald-700/70">
              {dealing ? 'Dealing…' : 'Ready'}
            </p>
          )}
        </div>

        <div className="absolute left-3 top-3 z-10 flex gap-1">
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
      </div>

      {/* Controls + stats */}
      <div className="space-y-4">
        <div className="card-premium space-y-3 p-4">
          <label className="block text-xs font-semibold text-muted-foreground">
            Ante (bet)
            <div className="mt-1 flex items-center rounded-xl border border-black/10 bg-white/70 px-2">
              <input
                type="number"
                min={1}
                value={bet}
                onChange={(e) => setBet(Math.max(1, Math.floor(Number(e.target.value))))}
                disabled={dealing}
                className="h-10 w-full bg-transparent font-mono text-sm outline-none"
              />
              <button
                onClick={() => setBet((b) => Math.max(1, Math.floor(b / 2)))}
                disabled={dealing}
                className="px-1 text-xs text-muted-foreground hover:text-foreground"
              >
                ½
              </button>
              <button
                onClick={() => setBet((b) => b * 2)}
                disabled={dealing}
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
                disabled={dealing}
                className="rounded-lg bg-black/[0.04] px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-60"
              >
                {v.toLocaleString('en-US')}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <Button
              variant="gradient"
              size="lg"
              className="w-full sheen"
              disabled={dealing}
              onClick={() => play()}
            >
              <Sparkles className="h-5 w-5" /> Deal · {bet.toLocaleString('en-US')}
            </Button>
            {phase === 'done' ? (
              <Button variant="glass" size="lg" onClick={() => play()} title="Deal again">
                <RotateCcw className="h-5 w-5" />
              </Button>
            ) : null}
          </div>

          <p className="text-center text-[11px] text-muted-foreground">
            Even money + rank bonus: Pair 2.2× · Color 2.5× · Seq 3× · Pure 4× · Trail 6×
          </p>

          <div className="text-center text-xs text-muted-foreground">
            Balance{' '}
            <AnimatedNumber value={balance} className="font-mono font-bold tabular-nums text-foreground" />
          </div>
        </div>

        <div className="card-premium grid grid-cols-2 gap-3 p-4 text-center">
          <Stat label="Best hand" value={HAND_NAMES[Math.max(0, Math.min(5, stat.highest - 1))] ?? '—'} />
          <Stat label="Best streak" value={String(stat.bestStreak)} />
          <Stat label="Rounds" value={String(stat.rounds)} />
          <Stat label="Biggest win" value={`+${stat.biggestWin.toLocaleString('en-US')}`} />
        </div>

        <div className="card-premium p-4">
          <p className="mb-2 font-display text-sm font-bold">History</p>
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

function HandRow({
  label,
  cards,
  faceDown,
  rank,
  winner,
}: {
  label: string;
  cards?: Card[];
  faceDown?: boolean;
  rank?: HandRank;
  winner?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex w-full max-w-sm items-center justify-between gap-3 rounded-2xl border-2 p-2.5 transition-colors sm:max-w-md lg:max-w-lg',
        winner ? 'border-gold bg-gold/10 shadow-glow' : 'border-transparent',
      )}
    >
      <div className="flex flex-col items-start gap-0.5">
        <span className="font-display text-xs font-bold uppercase tracking-widest text-emerald-700/70">
          {label}
        </span>
        {rank ? (
          <Badge variant={winner ? 'featured' : 'secondary'} className="text-[10px]">
            {rank.name}
          </Badge>
        ) : (
          <span className="h-5" />
        )}
      </div>
      <div className="flex gap-1.5">
        {(cards ?? [undefined, undefined, undefined]).map((c, i) => (
          <PlayingCard key={`${label}-${i}`} code={c} faceDown={faceDown} index={i} small />
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-black/[0.03] p-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-display text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}
