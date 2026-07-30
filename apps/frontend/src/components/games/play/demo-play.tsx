'use client';

import { Badge, Button, Spinner } from '@gaming-platform/ui';
import { ChevronLeft } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import type { ComponentType } from 'react';

import { DepositRequired } from '@/components/wallet/bet-gate';
import { type CardProto, type InstantProto, demoExperienceFor } from '@/lib/demo-games';
import { useDemoWallet } from '@/stores/demo-wallet';

/**
 * Backend-free play dispatcher.
 *
 * Every casino/game slug resolves to a self-contained prototype (card, crash,
 * dice, roulette) or the animated Slot demo — all client-side, all using the
 * local demo wallet. NOTHING here touches the runtime websocket or the card API,
 * so a game can NEVER show "Failed to start runtime" in demo mode.
 */

const spinner = (
  <div className="flex h-full items-center justify-center">
    <Spinner size={32} />
  </div>
);

const loading = () => spinner;

const CARD_GAMES: Record<CardProto, ComponentType> = {
  'teen-patti': dynamic(() => import('@/components/games/prototype/cards/teen-patti').then((m) => m.TeenPattiGame), { ssr: false, loading }),
  'andar-bahar': dynamic(() => import('@/components/games/prototype/cards/andar-bahar').then((m) => m.AndarBaharGame), { ssr: false, loading }),
  'dragon-tiger': dynamic(() => import('@/components/games/prototype/cards/dragon-tiger').then((m) => m.DragonTigerGame), { ssr: false, loading }),
  baccarat: dynamic(() => import('@/components/games/prototype/cards/baccarat').then((m) => m.BaccaratGame), { ssr: false, loading }),
  blackjack: dynamic(() => import('@/components/games/prototype/cards/blackjack').then((m) => m.BlackjackGame), { ssr: false, loading }),
  'casino-war': dynamic(() => import('@/components/games/prototype/cards/casino-war').then((m) => m.CasinoWarGame), { ssr: false, loading }),
  'lucky-7': dynamic(() => import('@/components/games/prototype/cards/lucky-7').then((m) => m.Lucky7Game), { ssr: false, loading }),
};

/** Phase 4/4B instant games with a bespoke UI (registry-driven runtime; UI-only).
 * Each is lazy-loaded so a game only ships its bundle when played. */
const INSTANT_GAMES: Record<InstantProto, ComponentType> = {
  limbo: dynamic(() => import('@/components/games/prototype/instant/limbo-game').then((m) => m.LimboGame), { ssr: false, loading }),
  'coin-flip': dynamic(() => import('@/components/games/prototype/instant/coin-flip-game').then((m) => m.CoinFlipGame), { ssr: false, loading }),
  wheel: dynamic(() => import('@/components/games/prototype/instant/wheel-game').then((m) => m.WheelGame), { ssr: false, loading }),
  mines: dynamic(() => import('@/components/games/prototype/instant/grid-reveal-game').then((m) => m.MinesGame), { ssr: false, loading }),
  'bomb-hunt': dynamic(() => import('@/components/games/prototype/instant/grid-reveal-game').then((m) => m.BombHuntGame), { ssr: false, loading }),
  tower: dynamic(() => import('@/components/games/prototype/instant/tower-game').then((m) => m.TowerGame), { ssr: false, loading }),
  keno: dynamic(() => import('@/components/games/prototype/instant/keno-game').then((m) => m.KenoGame), { ssr: false, loading }),
  bingo: dynamic(() => import('@/components/games/prototype/instant/bingo-game').then((m) => m.BingoGame), { ssr: false, loading }),
  'lucky-pick': dynamic(() => import('@/components/games/prototype/instant/lucky-pick-game').then((m) => m.LuckyPickGame), { ssr: false, loading }),
};

const CrashGame = dynamic(() => import('@/components/games/prototype/crash-game').then((m) => m.CrashGame), { ssr: false, loading });
const DiceGame = dynamic(() => import('@/components/games/prototype/dice-game').then((m) => m.DiceGame), { ssr: false, loading });
const RouletteGame = dynamic(() => import('@/components/games/prototype/roulette-game').then((m) => m.RouletteGame), { ssr: false, loading });
const SlotDemo = dynamic(() => import('@/components/games/slot/slot-demo').then((m) => m.SlotDemo), { ssr: false, loading });

export function DemoPlay({
  slug,
  title,
  lobbyHref = '/games',
  detailHref,
}: {
  slug: string;
  title: string;
  /** Where "Lobby" returns to — `/casino` keeps casino play in-experience. */
  lobbyHref?: string;
  /** Where "Details" links — defaults to the matching lobby's detail route. */
  detailHref?: string;
}) {
  const exp = demoExperienceFor(slug);
  const dHref = detailHref ?? `${lobbyHref}/${slug}`;
  const balance = useDemoWallet((s) => s.balance);

  const header = (
    <header className="glass-strong flex h-14 shrink-0 items-center justify-between border-b border-border/60 px-4">
      <Button asChild variant="ghost" size="sm">
        <Link href={lobbyHref}>
          <ChevronLeft className="h-4 w-4" /> Lobby
        </Link>
      </Button>
      <span className="flex items-center gap-2 font-display font-semibold text-foreground">
        {title}
        <Badge variant="secondary">Demo</Badge>
      </span>
      <Button asChild variant="ghost" size="sm">
        <Link href={dHref}>Details</Link>
      </Button>
    </header>
  );

  // Betting is disabled with an empty wallet — prompt a deposit (Phase 1.2).
  // Browsing the lobby/detail is unaffected.
  if (balance <= 0) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <main className="flex-1 overflow-y-auto px-3 py-6 sm:px-5">
          <div className="mx-auto w-full max-w-2xl py-8">
            <DepositRequired />
          </div>
        </main>
      </div>
    );
  }

  // The Slot demo ships its own full-screen chrome (header + Lobby link).
  if (exp.kind === 'slot') {
    return <SlotDemo slug={slug} title={title} lobbyHref={lobbyHref} detailHref={dHref} />;
  }

  const Game: ComponentType =
    exp.kind === 'card' ? CARD_GAMES[exp.game]
      : exp.kind === 'instant' ? INSTANT_GAMES[exp.game]
        : exp.kind === 'crash' ? CrashGame
          : exp.kind === 'dice' ? DiceGame
            : RouletteGame;

  return (
    <div className="flex h-full flex-col">
      {header}
      <main className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 sm:px-5 lg:px-6">
        {/* Full-width immersive play surface — board dominates, vertically centered
            so there's no dead space under the table (scrolls if taller than view). */}
        <div className="mx-auto flex min-h-full w-full max-w-[1700px] flex-col justify-center 2xl:max-w-[1850px]">
          <Game />
        </div>
      </main>
    </div>
  );
}
