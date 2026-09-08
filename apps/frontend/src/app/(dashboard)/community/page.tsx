'use client';

import { Badge, Button, cn } from '@gaming-platform/ui';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Award,
  CircleDot,
  Coins,
  Crown,
  Dice5,
  Flame,
  Gem,
  type LucideIcon,
  Medal,
  PartyPopper,
  Rocket,
  Sparkles,
  Trophy,
  Users,
  UserPlus,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { GameShelf } from '@/components/games/game-shelf';
import { AnimatedNumber } from '@/components/marketing/animated-number';
import { SectionHeading } from '@/components/marketing/landing-sections';
import {
  avatarGradient,
  initials,
  liveEvents,
  newPlayers,
  recentAchievements,
  todaysWinners,
  topPlayers,
  type CommunityPlayer,
  type GameEvent,
  type RecentAchievement,
} from '@/lib/ecosystem-data';
import { gamesApi } from '@/lib/games-api';

/* -------------------------------------------------------------------------- */
/* Icon registry — maps lucide NAME strings from the data to components        */
/* -------------------------------------------------------------------------- */

const ICONS: Record<string, LucideIcon> = {
  Trophy,
  Sparkles,
  Rocket,
  CircleDot,
  Dice5,
  Zap,
  Gem,
  Coins,
};

function iconFor(name: string): LucideIcon {
  return ICONS[name] ?? Sparkles;
}

/* -------------------------------------------------------------------------- */
/* Shared avatar                                                              */
/* -------------------------------------------------------------------------- */

function Avatar({
  seed,
  name,
  className,
}: {
  seed: string;
  name: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-display font-bold text-white',
        avatarGradient(seed),
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Ticking countdown (seconds passed as prop; never uses Date.now at module)   */
/* -------------------------------------------------------------------------- */

function Countdown({ seconds, className }: { seconds: number; className?: string }) {
  const [remaining, setRemaining] = useState(seconds);
  useEffect(() => {
    setRemaining(seconds);
    const id = setInterval(() => setRemaining((r) => (r <= 1 ? seconds : r - 1)), 1000);
    return () => clearInterval(id);
  }, [seconds]);
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    <span className={cn('font-mono font-semibold tabular-nums', className)}>
      {pad(h)}:{pad(m)}:{pad(s)}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
};

export default function CommunityPage() {
  const events = liveEvents();
  const top = topPlayers();
  const winners = todaysWinners();
  const achievements = recentAchievements();
  const fresh = newPlayers();

  const trending = useQuery({
    queryKey: ['community', 'trending'],
    queryFn: () => gamesApi.trending(),
  });
  const popular = useQuery({
    queryKey: ['community', 'popular'],
    queryFn: () => gamesApi.popular(),
  });

  return (
    <div className="relative space-y-10">
      <div className="bg-grid pointer-events-none absolute inset-0 -z-10 opacity-40" />
      <div className="bg-aurora pointer-events-none absolute inset-0 -z-10 opacity-[0.15]" />

      {/* 1. Header hero -------------------------------------------------- */}
      <HeroHeader />

      {/* 2. Live & upcoming events -------------------------------------- */}
      <EventsSection events={events} />

      {/* 3. Trending + Popular game shelves ----------------------------- */}
      <motion.section {...fadeUp} transition={{ duration: 0.5 }} className="space-y-6">
        <GameShelf
          title="Trending Games"
          icon={<Flame className="h-5 w-5 text-warning" />}
          games={trending.data}
          loading={trending.isLoading}
          viewAllHref="/games?filter=trending"
        />
        <GameShelf
          title="Popular Today"
          icon={<Sparkles className="h-5 w-5 text-primary" />}
          games={popular.data}
          loading={popular.isLoading}
          viewAllHref="/games?sort=popular"
        />
      </motion.section>

      {/* 4. Top players -------------------------------------------------- */}
      <TopPlayersSection players={top} />

      {/* 5. Today's winners --------------------------------------------- */}
      <WinnersSection winners={winners} />

      {/* 6. Recent achievements ----------------------------------------- */}
      <AchievementsSection achievements={achievements} />

      {/* 7. New players -------------------------------------------------- */}
      <NewPlayersSection players={fresh} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 1. Hero                                                                    */
/* -------------------------------------------------------------------------- */

function HeroHeader() {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-black/10 glass-strong p-6 sm:p-8">
      <div className="sheen pointer-events-none absolute inset-0" />
      <div className="relative">
        <span className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-card/50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary backdrop-blur">
          <Users className="h-3.5 w-3.5" /> Living world
        </span>
        <h1 className="mt-3 text-gradient font-display text-4xl font-bold tracking-tight sm:text-5xl">
          Community
        </h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Where the whole platform comes alive — live events, top players, big wins and the
          newest faces, all in one place.
        </p>
      </div>
      <div className="relative mt-6 grid gap-4 sm:max-w-xl sm:grid-cols-2">
        <HeroStat
          icon={<Users className="h-5 w-5" />}
          tone="primary"
          label="Players online"
          value={<AnimatedNumber value={18432} live />}
        />
        <HeroStat
          icon={<Trophy className="h-5 w-5" />}
          tone="gold"
          label="Winners today"
          value={<AnimatedNumber value={7291} live />}
        />
      </div>
    </section>
  );
}

function HeroStat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone: 'gold' | 'primary';
}) {
  return (
    <div className="glass flex items-center gap-3 rounded-2xl px-4 py-3">
      <span
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
          tone === 'gold'
            ? 'bg-gradient-gold text-gold-foreground shadow-glow-gold'
            : 'bg-primary/15 text-primary shadow-glow-sm',
        )}
      >
        {icon}
      </span>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </p>
        <p
          className={cn(
            'font-display text-2xl font-bold tabular-nums',
            tone === 'gold' ? 'text-gradient-gold' : 'text-gradient',
          )}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 2. Events                                                                  */
/* -------------------------------------------------------------------------- */

function EventsSection({ events }: { events: GameEvent[] }) {
  return (
    <section className="space-y-4">
      <SectionHeading
        icon={<Zap className="h-5 w-5 text-accent" />}
        title="Live & Upcoming Events"
        action={{ label: 'All events', href: '/events' }}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {events.map((ev, i) => (
          <EventCard key={ev.id} event={ev} delay={i * 0.06} />
        ))}
      </div>
    </section>
  );
}

function EventCard({ event, delay }: { event: GameEvent; delay: number }) {
  const Icon = iconFor(event.icon);
  const live = event.status === 'live';
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, delay }}
      className="card-premium group relative flex flex-col overflow-hidden"
    >
      {/* Gradient banner */}
      <div className={cn('relative h-24 bg-gradient-to-br', event.gradient)}>
        <div className="bg-grid absolute inset-0 opacity-30" />
        <div className="sheen pointer-events-none absolute inset-0" />
        <span className="absolute left-4 top-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-white/20 text-white shadow-glow-sm backdrop-blur">
          <Icon className="h-6 w-6" />
        </span>
        <span className="absolute right-4 top-4">
          {live ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white backdrop-blur">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
              </span>
              Live
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white backdrop-blur">
              Soon
            </span>
          )}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div>
          <h3 className="font-display text-lg font-bold">{event.name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{event.desc}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-2.5 py-1 text-xs font-semibold text-gold">
            <Trophy className="h-3.5 w-3.5" /> {event.reward}
          </span>
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 pt-1">
          <div className="leading-tight">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {live ? 'Ends in' : 'Starts in'}
            </p>
            <Countdown seconds={event.seconds} className="text-base text-foreground" />
          </div>
          <Button asChild size="sm" variant={live ? 'gradient' : 'glass'} className="sheen">
            <Link href={event.href}>{live ? 'Join now' : 'Remind me'}</Link>
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* 4. Top players                                                             */
/* -------------------------------------------------------------------------- */

const RANK_STYLE: Record<1 | 2 | 3, { chip: string; icon: LucideIcon; text: string }> = {
  1: { chip: 'bg-gradient-gold text-gold-foreground shadow-glow-gold', icon: Crown, text: 'text-gradient-gold' },
  2: { chip: 'bg-foreground/80 text-background', icon: Medal, text: 'text-foreground/70' },
  3: { chip: 'bg-warning text-background', icon: Award, text: 'text-warning' },
};

function TopPlayersSection({ players }: { players: CommunityPlayer[] }) {
  return (
    <section className="space-y-4">
      <SectionHeading
        icon={<Crown className="h-5 w-5 text-gold" />}
        title="Top Players"
        action={{ label: 'Full leaderboard', href: '/leaderboards' }}
      />
      <div className="card-premium divide-y divide-black/5 overflow-hidden rounded-2xl">
        {players.map((p, i) => (
          <TopPlayerRow key={p.seed} player={p} rank={i + 1} />
        ))}
      </div>
    </section>
  );
}

function TopPlayerRow({ player, rank }: { player: CommunityPlayer; rank: number }) {
  const podium = rank <= 3 ? RANK_STYLE[rank as 1 | 2 | 3] : null;
  const RankIcon = podium?.icon;
  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.3, delay: Math.min(rank * 0.03, 0.4) }}
      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-black/[0.03] sm:px-6"
    >
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-mono text-sm font-bold tabular-nums',
          podium ? podium.chip : 'bg-muted/40 text-muted-foreground',
        )}
      >
        {RankIcon ? <RankIcon className="h-4 w-4" /> : rank}
      </span>

      <Avatar seed={player.seed} name={player.name} className="h-10 w-10 text-xs" />

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-foreground">
          <span className="text-base leading-none">{player.flag}</span>
          {player.name}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">Level {player.level}</p>
      </div>

      <div className="text-right">
        <p className={cn('font-mono text-sm font-bold tabular-nums', podium ? podium.text : 'text-foreground')}>
          {player.meta}
        </p>
        <p className="text-[11px] tabular-nums text-muted-foreground">{player.value} pts</p>
      </div>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* 5. Today's winners                                                         */
/* -------------------------------------------------------------------------- */

function WinnersSection({ winners }: { winners: CommunityPlayer[] }) {
  return (
    <section className="space-y-4">
      <SectionHeading
        icon={<Flame className="h-5 w-5 text-emerald" />}
        title="Today's Winners"
        action={{ label: 'View all wins', href: '/leaderboards' }}
      />
      <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2">
        {winners.map((w, i) => (
          <motion.div
            key={w.seed}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.4, delay: Math.min(i * 0.05, 0.4) }}
            className="card-premium sheen flex w-52 shrink-0 flex-col items-center gap-2 p-5 text-center"
          >
            <div className="relative">
              <Avatar seed={w.seed} name={w.name} className="h-14 w-14 text-base ring-2 ring-emerald/30 ring-offset-2 ring-offset-card" />
              <span className="absolute -bottom-1 -right-1 text-lg leading-none">{w.flag}</span>
            </div>
            <p className="truncate text-sm font-semibold text-foreground">{w.name}</p>
            <p className="font-display text-xl font-extrabold tabular-nums text-emerald">{w.value}</p>
            <p className="text-[11px] capitalize text-muted-foreground">{w.meta}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* 6. Recent achievements                                                     */
/* -------------------------------------------------------------------------- */

const RARITY: Record<RecentAchievement['rarity'], { chip: string; label: string; badge: 'featured' | 'gold' | 'neon' }> = {
  rare: { chip: 'bg-accent/15 text-accent shadow-glow-sm', label: 'Rare', badge: 'neon' },
  epic: { chip: 'bg-violet/15 text-violet shadow-glow-sm', label: 'Epic', badge: 'featured' },
  legendary: { chip: 'bg-gradient-gold text-gold-foreground shadow-glow-gold', label: 'Legendary', badge: 'gold' },
};

function AchievementsSection({ achievements }: { achievements: RecentAchievement[] }) {
  return (
    <section className="space-y-4">
      <SectionHeading
        icon={<Award className="h-5 w-5 text-violet" />}
        title="Recent Achievements"
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {achievements.map((a, i) => {
          const Icon = iconFor(a.icon);
          const r = RARITY[a.rarity];
          return (
            <motion.div
              key={a.seed}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.45, delay: Math.min(i * 0.06, 0.4) }}
              className="card-premium flex items-center gap-4 p-5"
            >
              <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl', r.chip)}>
                <Icon className="h-6 w-6" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="truncate font-display text-base font-bold">{a.title}</h3>
                  <Badge variant={r.badge}>{r.label}</Badge>
                </div>
                <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-muted-foreground">
                  <span className="text-base leading-none">{a.flag}</span>
                  {a.player}
                </p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* 7. New players                                                             */
/* -------------------------------------------------------------------------- */

function NewPlayersSection({ players }: { players: CommunityPlayer[] }) {
  return (
    <section className="space-y-4">
      <SectionHeading
        icon={<UserPlus className="h-5 w-5 text-primary" />}
        title="New Players"
        action={{ label: 'Invite friends', href: '/friends' }}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {players.map((p, i) => (
          <motion.div
            key={p.seed}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.4, delay: Math.min(i * 0.05, 0.4) }}
            className="glass flex items-center gap-3 rounded-2xl border border-black/10 p-4"
          >
            <Avatar seed={p.seed} name={p.name} className="h-11 w-11 text-sm" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-foreground">
                <span className="text-base leading-none">{p.flag}</span>
                {p.name}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                Level {p.level} · {p.meta}
              </p>
            </div>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <PartyPopper className="h-4 w-4" />
            </span>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
