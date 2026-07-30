'use client';

import { Button, cn } from '@gaming-platform/ui';
import type { IBetRequest, IStepResult } from '@gaming-platform/types';
import { BetMode, RuntimeState, SettlementType } from '@gaming-platform/types';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

import { PlayingCard } from '@/components/card/playing-card';
import { GameFx, type FxSignal } from '@/components/games/prototype/game-fx';
import { type BlackjackState } from '@/games/cards/blackjack-engine';
import { blackjackHand, type Card } from '@/lib/deck';
import { sound } from '@/lib/sound';
import { useGameRuntime } from '@/runtime/react/use-game-runtime';
import { useDemoWallet } from '@/stores/demo-wallet';
import { useGameStat } from '@/stores/game-stats';

type Phase = 'bet' | 'player' | 'dealer' | 'done';
const CHIPS = [100, 500, 1000, 5000];

export function BlackjackGame() {
  // The Runtime owns bet/RNG/settlement/history (incl. the double via raiseStake);
  // the UI only renders + collects intent. Demo providers delegate to these same
  // stores, so surfaces are unchanged.
  const { runtime, session } = useGameRuntime('blackjack');
  const balance = useDemoWallet((s) => s.balance);
  const stat = useGameStat('blackjack');

  const [phase, setPhase] = useState<Phase>('bet');
  const [bet, setBet] = useState(500);
  const [player, setPlayer] = useState<Card[]>([]);
  const [dealer, setDealer] = useState<Card[]>([]);
  const [reveal, setReveal] = useState(false);
  const [result, setResult] = useState<{ text: string; tone: 'win' | 'lose' | 'push' } | null>(null);
  const [fx, setFx] = useState<FxSignal>({ key: 0, type: null });

  const roundIdRef = useRef<string | null>(null);
  const wagerRef = useRef(0);
  const fxKey = useRef(0);
  const timers = useRef<number[]>([]);
  const pendingRef = useRef(false);
  const after = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const pv = blackjackHand(player);
  const dv = blackjackHand(dealer);

  /** Present a completed round (already settled by the runtime). */
  const settleUi = useCallback((step: IStepResult<BlackjackState>) => {
    const s = step.settlement;
    const tone: 'win' | 'lose' | 'push' =
      s?.type === SettlementType.Win ? 'win' : s?.type === SettlementType.Push ? 'push' : 'lose';
    setReveal(true);
    setResult({ text: s?.reason ?? '', tone });
    setPhase('done');
    if (tone === 'win') {
      fxKey.current += 1;
      setFx({ key: fxKey.current, type: 'win', amount: Number(s?.payout ?? 0) - wagerRef.current });
      sound.play('reward');
    } else if (tone === 'push') {
      sound.play('notify');
    } else {
      sound.play('lose');
    }
  }, []);

  /** Reveal the dealer's drawn cards one at a time, then run `onDone`. */
  const animateDealer = useCallback((finalDealer: Card[], onDone: () => void) => {
    setPhase('dealer');
    setReveal(true);
    after(500, () => {
      let n = 2; // dealer starts with two cards shown
      const drawNext = () => {
        if (n >= finalDealer.length) {
          onDone();
          return;
        }
        n += 1;
        setDealer(finalDealer.slice(0, n));
        sound.play('cardFlip');
        after(650, drawNext);
      };
      drawNext();
    });
  }, []);

  /** After a stand/double, animate the dealer reveal then settle via `resolve`. */
  const resolveAfterReveal = useCallback(
    (finalDealer: Card[]) => {
      const roundId = roundIdRef.current;
      if (!roundId) return;
      animateDealer(finalDealer, () => {
        void runtime
          .submitAction<BlackjackState>({ roundId, action: { type: 'resolve' } })
          .then((step) => settleUi(step))
          .catch(() => {});
      });
    },
    [runtime, animateDealer, settleUi],
  );

  const deal = useCallback(() => {
    if (phase === 'player' || phase === 'dealer' || pendingRef.current) return;
    const stake = Math.max(1, Math.floor(bet));
    if (!session) {
      toast.error('Starting session… try again in a moment.');
      return;
    }
    if (stake > balance) {
      toast.error('Not enough demo coins — reload from the balance pill.');
      return;
    }
    timers.current.forEach(clearTimeout);
    timers.current = [];
    pendingRef.current = true;

    const betReq: IBetRequest = {
      gameId: 'blackjack',
      sessionId: session.sessionId,
      stake: { amount: String(stake), currency: 'INR' },
      mode: BetMode.Single,
      selections: [{ pick: null }],
      idempotencyKey: `blackjack:${session.sessionId}:${stat.seq}:${stake}`,
      clientSeed: 'demo',
    };
    void runtime
      .startInteractive<BlackjackState>(betReq)
      .then(({ roundId, step }) => {
        roundIdRef.current = roundId;
        wagerRef.current = stake;
        setResult(null);
        setPlayer(step.gameState.player);
        setDealer(step.gameState.dealer);
        sound.play('cardFlip');
        if (step.state === RuntimeState.Completed) {
          after(700, () => settleUi(step)); // immediate blackjack
        } else {
          setReveal(false);
          setPhase('player');
        }
      })
      .catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : 'Could not place bet.');
      })
      .finally(() => {
        pendingRef.current = false;
      });
  }, [phase, bet, balance, session, stat.seq, runtime, settleUi]);

  const hit = () => {
    const roundId = roundIdRef.current;
    if (phase !== 'player' || !roundId) return;
    void runtime
      .submitAction<BlackjackState>({ roundId, action: { type: 'hit' } })
      .then((step) => {
        setPlayer(step.gameState.player);
        sound.play('cardFlip');
        if (step.state === RuntimeState.Completed) after(500, () => settleUi(step)); // bust
      })
      .catch(() => {});
  };

  const stand = () => {
    const roundId = roundIdRef.current;
    if (phase !== 'player' || !roundId) return;
    void runtime
      .submitAction<BlackjackState>({ roundId, action: { type: 'stand' } })
      .then((step) => resolveAfterReveal(step.gameState.dealer))
      .catch(() => {});
  };

  const double = () => {
    const roundId = roundIdRef.current;
    if (phase !== 'player' || player.length !== 2 || !roundId) return;
    if (wagerRef.current > balance) {
      toast.error('Not enough to double.');
      return;
    }
    // Runtime raises the committed stake (the one wallet op the base API can't do),
    // then the engine draws one card and plays the dealer.
    void runtime
      .raiseStake({ roundId, amount: String(wagerRef.current) })
      .then(() => {
        wagerRef.current *= 2;
        sound.play('chips');
        return runtime.submitAction<BlackjackState>({ roundId, action: { type: 'double' } });
      })
      .then((step) => {
        setPlayer(step.gameState.player);
        if (step.state === RuntimeState.Completed) after(500, () => settleUi(step)); // double bust
        else resolveAfterReveal(step.gameState.dealer);
      })
      .catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : 'Could not double.');
      });
  };

  const inRound = phase === 'player' || phase === 'dealer';

  return (
    <div className="grid gap-4 lg:gap-6 lg:grid-cols-[2.2fr_1fr] xl:grid-cols-[2.5fr_1fr]">
      {/* Table */}
      <div className="card-premium relative overflow-hidden p-5">
        <GameFx trigger={fx} />
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-100 via-white to-emerald-50" />
        <div className="bg-grid absolute inset-0 opacity-40" />
        <div className="relative flex min-h-[22rem] flex-col justify-between gap-6">
          {/* Dealer */}
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Dealer {reveal ? <span className="font-mono text-foreground">· {dv.total}</span> : null}
            </div>
            <div className="flex gap-2">
              {dealer.map((c, i) => (
                <PlayingCard key={`d${i}`} code={c} index={i} faceDown={i === 1 && !reveal} />
              ))}
              {dealer.length === 0 ? <EmptySlot /> : null}
            </div>
          </div>

          {/* Result banner */}
          {result ? (
            <div
              className={cn(
                'self-center rounded-full px-5 py-1.5 font-display text-lg font-bold',
                result.tone === 'win' ? 'bg-emerald/15 text-emerald' : result.tone === 'push' ? 'bg-primary/15 text-primary' : 'bg-destructive/15 text-destructive',
              )}
            >
              {result.text}
            </div>
          ) : phase === 'bet' ? (
            <p className="self-center font-display text-lg font-bold text-muted-foreground">
              Place your bet & deal
            </p>
          ) : null}

          {/* Player */}
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              You <span className="font-mono text-foreground">· {pv.total}{pv.soft ? ' (soft)' : ''}</span>
            </div>
            <div className="flex gap-2">
              {player.map((c, i) => (
                <PlayingCard key={`p${i}`} code={c} index={i} />
              ))}
              {player.length === 0 ? <EmptySlot /> : null}
            </div>
          </div>
        </div>
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
                disabled={inRound}
                className="h-10 w-full bg-transparent font-mono text-sm outline-none"
              />
              <button onClick={() => setBet((b) => Math.max(1, Math.floor(b / 2)))} disabled={inRound} className="px-1 text-xs text-muted-foreground hover:text-foreground">½</button>
              <button onClick={() => setBet((b) => b * 2)} disabled={inRound} className="px-1 text-xs text-muted-foreground hover:text-foreground">2×</button>
            </div>
          </label>
          <div className="flex flex-wrap gap-1.5">
            {CHIPS.map((v) => (
              <button key={v} onClick={() => setBet(v)} disabled={inRound} className="rounded-lg bg-black/[0.04] px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary">
                {v.toLocaleString('en-US')}
              </button>
            ))}
          </div>

          {phase === 'player' ? (
            <div className="grid grid-cols-3 gap-2">
              <Button variant="gradient" onClick={hit}>Hit</Button>
              <Button variant="gold" onClick={stand}>Stand</Button>
              <Button variant="glass" onClick={double} disabled={player.length !== 2}>Double</Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button variant="gradient" size="lg" className="w-full sheen" onClick={() => deal()} disabled={phase === 'dealer'}>
                {phase === 'done' ? 'Deal again' : 'Deal'} · {bet.toLocaleString('en-US')}
              </Button>
              {phase === 'done' ? (
                <Button variant="glass" size="lg" onClick={() => deal()} title="Deal again">↻</Button>
              ) : null}
            </div>
          )}
        </div>

        <div className="card-premium grid grid-cols-2 gap-3 p-4 text-center">
          <Stat label="Best hand" value={String(stat.highest)} />
          <Stat label="Rounds" value={String(stat.rounds)} />
          <Stat label="Biggest win" value={`+${stat.biggestWin.toLocaleString('en-US')}`} />
          <Stat label="Win streak" value={String(stat.bestStreak)} />
        </div>

        <div className="card-premium p-4">
          <p className="mb-2 font-display text-sm font-bold">History</p>
          <div className="flex flex-wrap gap-1.5">
            {stat.history.slice(0, 12).map((r) => (
              <span key={r.id} className={cn('rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold', r.win ? 'bg-emerald/15 text-emerald' : r.payout === 0 ? 'bg-primary/15 text-primary' : 'bg-destructive/15 text-destructive')}>
                {r.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptySlot() {
  return <div className="h-20 w-14 rounded-lg border-2 border-dashed border-emerald/30" />;
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-black/[0.03] p-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-display text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}
