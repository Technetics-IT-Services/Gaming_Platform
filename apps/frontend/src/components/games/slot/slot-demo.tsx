'use client';

import { Badge, Button, cn } from '@gaming-platform/ui';
import type { IBetRequest } from '@gaming-platform/types';
import { BetMode } from '@gaming-platform/types';
import { ChevronLeft, Coins, Crown, Minus, Plus, RotateCw, Volume2, Zap } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AnimatedNumber } from '@/components/marketing/animated-number';
import { REELS, ROWS, STRIP, SYMBOLS, type SlotsPick, type SlotsState, buildStrip, fnv } from '@/games/slots-engine';
import { useGameRuntime } from '@/runtime/react/use-game-runtime';
import { useDemoWallet } from '@/stores/demo-wallet';

/**
 * Premium, presentation-only slot / instant-win demo.
 *
 * Fully client-side — no backend, no `Math.random()` / `Date.now()`. Outcomes
 * come from a seeded PRNG (mulberry32) advanced one step per spin, so the reel
 * strips are stable across SSR/CSR (no hydration drift) and every session is
 * reproducible. Respects reduced-motion.
 *
 * Runs through the Game Runtime (Phase 3) — every spin goes `startRound` → engine
 * (provably-fair reels, flexible Win/Jackpot settlement) → `cashOut`/`finishRound`,
 * so the slot behaves exactly like the card / crash / dice / roulette games: one
 * wallet, auto bet + win transactions, and a bet-history entry per round (keyed by
 * the slot title via bet metadata). The jackpot pool is a cosmetic demo counter.
 */

// Reel strips, symbols, and RNG helpers live in the shared slots engine.
const CELL = 92; // px per symbol cell
const BETS = [5, 10, 25, 50, 100] as const;

interface SlotDemoProps {
  slug: string;
  title: string;
  /** Back-nav targets (default to the Games library; casino passes /casino). */
  lobbyHref?: string;
  detailHref?: string;
}

export function SlotDemo({ slug, title, lobbyHref = '/games', detailHref }: SlotDemoProps) {
  const backHref = detailHref ?? `${lobbyHref}/${slug}`;
  const strips = useMemo(() => Array.from({ length: REELS }, (_, r) => buildStrip(slug, r)), [slug]);

  // Start each reel showing a stable window (offset 1 → middle row = strip[1]).
  const [offsets, setOffsets] = useState<number[]>(() => strips.map(() => 1));
  const [spinning, setSpinning] = useState(false);
  // The Runtime owns bet/RNG/settlement/history; the UI only renders + collects
  // intent. Demo providers delegate to these same stores, so surfaces are unchanged.
  const { runtime, session } = useGameRuntime('slots');
  const balance = useDemoWallet((s) => s.balance);
  const [betIndex, setBetIndex] = useState(1);
  const [jackpot, setJackpot] = useState(() => 25_000 + (fnv(slug) % 50_000));
  const [lastWin, setLastWin] = useState<number | null>(null);
  const [message, setMessage] = useState('Spin to play — free demo coins');

  const spinCount = useRef(0);
  const reduced = useReducedMotion();
  const bet = BETS[betIndex]!;

  const middleSymbols = offsets.map((o, r) => strips[r]![(o + 1) % STRIP]!);

  const spin = useCallback(() => {
    if (spinning) return;
    if (!session) {
      setMessage('Starting session… try again in a moment.');
      return;
    }
    if (balance < bet) {
      setMessage('Not enough balance — deposit or lower your bet');
      return;
    }
    setSpinning(true);
    setLastWin(null);
    setMessage('Spinning…');
    spinCount.current += 1;

    const betReq: IBetRequest<SlotsPick> = {
      gameId: 'slots',
      sessionId: session.sessionId,
      stake: { amount: String(bet), currency: 'INR' },
      mode: BetMode.Single,
      selections: [{ pick: { slug, jackpot } }],
      idempotencyKey: `slots:${slug}:${session.sessionId}:${spinCount.current}:${bet}`,
      clientSeed: 'demo',
      // Per-round history identity → the ledger + stats key by the slot title.
      metadata: { gameName: title, statsKey: title },
    };

    // Runtime: validate → debit → engine (provably-fair reels). UI spins to it.
    void runtime
      .startRound<SlotsState>(betReq)
      .then(({ result, roundId }) => {
        const { targets, results, win, isJackpot } = result.state;
        const settle = () => {
          setOffsets(targets);
          const [a, b, c] = results as [number, number, number];
          if (a === b && b === c) {
            if (isJackpot) {
              setJackpot(25_000 + (fnv(`${slug}${spinCount.current}`) % 50_000));
              setMessage(`🎉 JACKPOT — ${SYMBOLS[a]!.label} × ${REELS}!`);
            } else {
              setMessage(`Win! Three ${SYMBOLS[a]!.label}s`);
            }
          } else if (a === b || b === c || a === c) {
            setMessage('Nice — a matching pair');
          } else {
            setMessage('No win — spin again');
          }
          setJackpot((j) => j + Math.round(bet * 0.25));
          if (win > 0) setLastWin(win);
          // Runtime settles: credit + bet-history + stats + XP (label = the win kind).
          if (result.win) void runtime.cashOut({ roundId, atMultiplier: result.multiplier }).catch(() => {});
          else void runtime.finishRound({ roundId, finalMultiplier: 0 }).catch(() => {});
          setSpinning(false);
        };
        if (reduced) settle();
        else window.setTimeout(settle, 1150); // let the CSS reel transition play
      })
      .catch(() => {
        setSpinning(false);
        setMessage('Spin failed — try again');
      });
  }, [bet, balance, session, jackpot, reduced, slug, spinning, title, runtime]);

  // Space to spin.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ['INPUT', 'TEXTAREA'].includes(t.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        spin();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [spin]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="glass-strong flex h-14 shrink-0 items-center justify-between border-b border-border/60 px-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={backHref}>
            <ChevronLeft className="h-4 w-4" /> Details
          </Link>
        </Button>
        <span className="flex items-center gap-2 font-display font-semibold">
          <Zap className="h-4 w-4 text-gold" /> {title}
          <Badge variant="secondary">Slot demo</Badge>
        </span>
        <Button asChild variant="ghost" size="sm">
          <Link href={lobbyHref}>Lobby</Link>
        </Button>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-6 p-4 lg:max-w-4xl">
        {/* Jackpot */}
        <div className="glass-strong flex items-center gap-3 rounded-2xl px-5 py-2.5">
          <Crown className="h-5 w-5 text-gold animate-glow-pulse" />
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Jackpot</span>
          <span className="font-mono text-2xl font-extrabold tabular-nums text-gradient-gold">
            <AnimatedNumber value={jackpot} prefix="$" live />
          </span>
        </div>

        {/* Reels */}
        <div className="relative w-full overflow-hidden rounded-3xl border border-gold/30 bg-black/40 p-4 shadow-glow">
          <div className="bg-grid pointer-events-none absolute inset-0 opacity-20" />
          <div
            className="relative mx-auto grid gap-3"
            style={{ gridTemplateColumns: `repeat(${REELS}, 1fr)`, maxWidth: 560 }}
          >
            {strips.map((strip, r) => (
              <div
                key={r}
                className="relative overflow-hidden rounded-2xl ring-1 ring-white/10"
                style={{ height: ROWS * CELL }}
                aria-hidden
              >
                <div
                  className="flex flex-col will-change-transform"
                  style={{
                    transform: `translateY(${-offsets[r]! * CELL}px)`,
                    transition: spinning && !reduced
                      ? `transform ${900 + r * 120}ms cubic-bezier(0.16,1,0.3,1)`
                      : 'none',
                  }}
                >
                  {strip.map((s, i) => (
                    <span
                      key={i}
                      className="flex shrink-0 items-center justify-center"
                      style={{ height: CELL, fontSize: 52 }}
                    >
                      {SYMBOLS[s]!.char}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {/* Win line */}
          <div
            className="pointer-events-none absolute inset-x-4 top-1/2 h-[2px] -translate-y-1/2 bg-gradient-to-r from-transparent via-gold to-transparent opacity-70"
            style={{ marginTop: 0 }}
          />
          {/* Screen-reader result */}
          <p className="sr-only" role="status" aria-live="polite">
            {spinning
              ? 'Reels spinning'
              : `Result: ${middleSymbols.map((s) => SYMBOLS[s]!.label).join(', ')}. ${message}`}
          </p>
        </div>

        {/* Win / message */}
        <div className="flex min-h-[2.5rem] items-center gap-2 text-center">
          {lastWin != null ? (
            <span className="font-display text-2xl font-extrabold text-gradient-gold text-glow">
              +<AnimatedNumber value={lastWin} /> coins
            </span>
          ) : (
            <span className="text-sm font-medium text-muted-foreground">{message}</span>
          )}
        </div>

        {/* Controls */}
        <div className="glass-strong flex w-full flex-wrap items-center justify-between gap-4 rounded-2xl p-4">
          <div className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-gold" />
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Balance</p>
              <p className="font-mono text-lg font-bold tabular-nums text-foreground">
                ₹<AnimatedNumber value={balance} />
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Bet</span>
            <Button
              variant="glass"
              size="icon"
              aria-label="Decrease bet"
              disabled={betIndex === 0 || spinning}
              onClick={() => setBetIndex((i) => Math.max(0, i - 1))}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <span className="w-14 text-center font-mono text-lg font-bold tabular-nums">{bet}</span>
            <Button
              variant="glass"
              size="icon"
              aria-label="Increase bet"
              disabled={betIndex === BETS.length - 1 || spinning}
              onClick={() => setBetIndex((i) => Math.min(BETS.length - 1, i + 1))}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <Button
            variant="gold"
            size="xl"
            className="sheen min-w-[9rem] shadow-glow-gold"
            disabled={spinning}
            onClick={spin}
          >
            <RotateCw className={cn('h-5 w-5', spinning && 'animate-spin')} />
            {spinning ? 'Spinning' : 'Spin'}
          </Button>
        </div>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Volume2 className="h-3.5 w-3.5" /> Press Space to spin · Demo wallet · 18+
        </p>
      </main>
    </div>
  );
}

/** Minimal reduced-motion hook (matchMedia + the app's `.reduce-motion` class). */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () =>
      setReduced(mq.matches || document.documentElement.classList.contains('reduce-motion'));
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return reduced;
}
