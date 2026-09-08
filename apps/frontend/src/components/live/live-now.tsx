'use client';

import { Button, cn } from '@gaming-platform/ui';
import { motion } from 'framer-motion';
import {
  Bomb,
  CircleDot,
  Club,
  Dice5,
  Gem,
  Rocket,
  Spade,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';

import { AnimatedNumber } from '@/components/marketing/animated-number';
import { SectionHeading } from '@/components/marketing/landing-sections';
import { useIsMobile } from '@/hooks/use-is-mobile';

interface LiveGame {
  name: string;
  href: string;
  icon: LucideIcon;
  gradient: string;
  players: number;
  jackpot: number;
  round: string;
}

/** Deterministic seed so SSR/CSR match; values then drift live on the client. */
const LIVE_GAMES: LiveGame[] = [
  { name: 'Crash', href: '/crash', icon: Rocket, gradient: 'from-pink to-violet', players: 3120, jackpot: 184320, round: '#48213' },
  { name: 'Dice', href: '/dice', icon: Dice5, gradient: 'from-primary to-accent', players: 2480, jackpot: 92110, round: '#71204' },
  { name: 'Roulette', href: '/roulette', icon: CircleDot, gradient: 'from-destructive to-warning', players: 1980, jackpot: 240500, round: '#10925' },
  { name: 'Teen Patti', href: '/casino', icon: Spade, gradient: 'from-violet to-pink', players: 1640, jackpot: 73400, round: '#33871' },
  { name: 'Blackjack', href: '/casino', icon: Club, gradient: 'from-emerald to-accent', players: 2210, jackpot: 128900, round: '#55012' },
  { name: 'Dragon Tiger', href: '/casino', icon: Gem, gradient: 'from-gold to-pink', players: 1290, jackpot: 65200, round: '#22640' },
  { name: 'Poker', href: '/casino', icon: Bomb, gradient: 'from-accent to-primary', players: 1720, jackpot: 156000, round: '#90233' },
  { name: 'Sports', href: '/sportsbook', icon: TrendingUp, gradient: 'from-primary to-emerald', players: 4050, jackpot: 312000, round: 'LIVE' },
];

export function LiveNow() {
  return (
    <section className="space-y-4">
      <SectionHeading
        icon={
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-70" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-destructive" />
          </span>
        }
        title="Live Now"
        action={{ label: 'All games', href: '/casino' }}
      />
      <LiveGamesContainer />
    </section>
  );
}

function LiveGamesContainer() {
  const isMobile = useIsMobile();
  const cards = LIVE_GAMES.map((g, i) => {
    const Icon = g.icon;
    const inner = (
      <Link href={g.href} className="group block">
        <div className="card-premium sheen overflow-hidden p-0">
          {/* animated banner — taller on mobile for a bigger thumbnail */}
          <div className={cn('relative bg-gradient-to-br max-md:h-32 md:h-24', g.gradient)}>
                    <div className="bg-grid absolute inset-0 opacity-30" />
                    <div className="absolute right-3 top-3 rounded-full bg-black/65 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur">
                      ● Live
                    </div>
                    <Icon className="absolute -bottom-3 left-4 h-16 w-16 text-white/90 drop-shadow-lg transition-transform duration-300 group-hover:scale-110" />
                  </div>
                  <div className="space-y-3 p-4">
                    <div className="flex items-center justify-between">
                      <p className="font-display text-base font-bold">{g.name}</p>
                      <span className="font-mono text-[11px] text-muted-foreground">{g.round}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <div>
                        <p className="text-muted-foreground">Players</p>
                        <p className="font-mono font-semibold text-foreground">
                          <AnimatedNumber value={g.players} />
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-muted-foreground">Jackpot</p>
                        <p className="font-mono font-semibold text-gold">
                          <AnimatedNumber value={g.jackpot} prefix="$" />
                        </p>
                      </div>
                    </div>
            <Button variant="gradient" size="sm" className="w-full max-md:min-h-[44px]">
              Play
            </Button>
          </div>
        </div>
      </Link>
    );
    // Mobile: full-width vertical card. Desktop: original animated rail item.
    return isMobile ? (
      <div key={g.name + i} className="w-full">
        {inner}
      </div>
    ) : (
      <motion.div
        key={g.name + i}
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.4, delay: i * 0.05 }}
        className="w-60 shrink-0 snap-start"
      >
        {inner}
      </motion.div>
    );
  });

  return isMobile ? (
    <div className="space-y-4">{cards}</div>
  ) : (
    <div className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-3">{cards}</div>
  );
}
