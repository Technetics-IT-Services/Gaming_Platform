'use client';

import { Badge, Button, cn } from '@gaming-platform/ui';
import { motion } from 'framer-motion';
import { Coins, Crown, History, Play, Radio, Trophy, Users } from 'lucide-react';
import Link from 'next/link';

import { GameCover } from '@/components/games/game-cover';
import { AnimatedNumber } from '@/components/marketing/animated-number';
import { casinoStats, recentWinners } from '@/lib/casino-demo';
import { demoGamesBySlugs } from '@/lib/demo-games';

/* Deterministic floating-chip decoration (GPU transforms, reduced-motion aware). */
const CHIPS = [
  { left: '8%', top: '18%', size: 34, tone: 'from-gold to-warning', delay: 0, dur: 'animate-float' },
  { left: '20%', top: '62%', size: 22, tone: 'from-pink to-violet', delay: 0.6, dur: 'animate-float-slow' },
  { left: '84%', top: '24%', size: 40, tone: 'from-accent to-primary', delay: 0.3, dur: 'animate-float-slow' },
  { left: '72%', top: '70%', size: 26, tone: 'from-emerald to-accent', delay: 0.9, dur: 'animate-float' },
  { left: '52%', top: '14%', size: 18, tone: 'from-violet to-pink', delay: 0.2, dur: 'animate-float' },
];

/** Immersive casino hero: featured game, daily jackpot, live stats, chips. */
export function CasinoHero() {
  const stats = casinoStats();
  // Always a casino title (never an arcade/non-casino game).
  const featured = demoGamesBySlugs(['golden-pharaoh'], 'casino-hero')[0]!;
  const winners = recentWinners(5);

  return (
    <section className="relative overflow-hidden rounded-3xl border border-black/[0.06] shadow-elevated">
      {/* Ambient gold lighting + beams */}
      <div className="absolute inset-0 bg-gradient-to-br from-gold/10 via-primary/10 to-accent/10" />
      <div className="bg-grid absolute inset-0 opacity-[0.12]" />
      <div className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full bg-gold/25 blur-3xl animate-glow-pulse" />
      <div className="pointer-events-none absolute -right-16 bottom-0 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 [background:radial-gradient(120%_60%_at_50%_-10%,hsl(0_0%_100%/0.6),transparent_60%)]" />

      {/* Floating chips */}
      {CHIPS.map((c, i) => (
        <motion.span
          key={i}
          aria-hidden
          className={cn('pointer-events-none absolute rounded-full bg-gradient-to-br shadow-glow-sm ring-2 ring-white/60', c.tone, c.dur)}
          style={{ left: c.left, top: c.top, width: c.size, height: c.size, animationDelay: `${c.delay}s` }}
        />
      ))}

      <div className="relative grid gap-6 p-6 sm:p-8 lg:grid-cols-[1.35fr_1fr] lg:p-10">
        {/* Copy + actions */}
        <div className="flex flex-col justify-center gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="gold" className="shadow-glow-gold">★ Featured</Badge>
            <Badge variant="live"><span className="mr-1 h-1.5 w-1.5 animate-pulse rounded-full bg-current" /> Live casino</Badge>
          </div>
          <h1 className="font-display text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            <span className="text-gradient-gold text-glow">{featured.name}</span>
          </h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Step into the luxury lobby — jackpots, live dealers and hundreds of tables, all in demo mode.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button asChild variant="gold" size="xl" className="sheen shadow-glow-gold">
              <Link href={`/casino/${featured.slug}`}>
                <Play className="h-5 w-5 fill-current" /> Play now
              </Link>
            </Button>
            <Button asChild variant="glass" size="xl">
              <Link href="/casino">
                <History className="h-5 w-5" /> Continue playing
              </Link>
            </Button>
          </div>

          {/* Live stats */}
          <div className="mt-2 grid grid-cols-3 gap-3">
            <HeroStat icon={<Users className="h-4 w-4" />} label="Players online" value={stats.playersOnline} tone="text-accent" live />
            <HeroStat icon={<Radio className="h-4 w-4" />} label="Live tables" value={stats.liveTables} tone="text-destructive" />
            <HeroStat icon={<Trophy className="h-4 w-4" />} label="Winners today" value={stats.winnersToday} tone="text-emerald" live />
          </div>
        </div>

        {/* Featured artwork + daily jackpot */}
        <div className="flex flex-col gap-3">
          <div className="group relative aspect-[16/10] overflow-hidden rounded-2xl border border-black/10 shadow-glow">
            <GameCover name={featured.name} seed={featured.id} hint={featured.category?.slug} showTitle={false} sizes="480px" />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/60 to-transparent p-3">
              <span className="rounded-full bg-white/85 px-2.5 py-1 text-xs font-bold text-foreground backdrop-blur">
                {featured.provider?.name}
              </span>
              <span className="rounded-full bg-emerald/90 px-2.5 py-1 text-xs font-bold text-white backdrop-blur">
                {featured.rtp}% RTP
              </span>
            </div>
          </div>

          <div className="glass-strong flex items-center gap-3 rounded-2xl p-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gold to-warning text-white shadow-glow-gold animate-glow-pulse">
              <Crown className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                <Coins className="h-3 w-3 text-gold" /> Daily jackpot
              </p>
              <p className="font-mono text-2xl font-extrabold tabular-nums text-gradient-gold">
                <AnimatedNumber value={stats.dailyJackpot} prefix="$" live />
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Recent winners ticker */}
      <div className="relative flex items-center gap-2 border-t border-black/5 bg-white/40 px-4 py-2 backdrop-blur sm:px-6">
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald">
          <Trophy className="h-3 w-3" /> Winners
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-4 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {winners.map((w, i) => (
            <span key={i} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs">
              <span className="text-sm leading-none">{w.country}</span>
              <span className="font-semibold text-foreground">{w.name}</span>
              <span className="text-muted-foreground">won</span>
              <span className="font-mono font-bold tabular-nums text-emerald">+${w.amount.toLocaleString('en-US')}</span>
              <span className="text-muted-foreground">on {w.game}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function HeroStat({ icon, label, value, tone, live }: { icon: React.ReactNode; label: string; value: number; tone: string; live?: boolean }) {
  return (
    <div className="glass rounded-2xl px-3 py-2.5">
      <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className={tone}>{icon}</span> {label}
      </span>
      <p className={cn('mt-0.5 font-mono text-lg font-bold tabular-nums', tone)}>
        <AnimatedNumber value={value} live={live} />
      </p>
    </div>
  );
}
