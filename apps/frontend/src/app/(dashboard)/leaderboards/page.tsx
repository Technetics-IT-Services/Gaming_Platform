'use client';

import { Badge, Button, cn } from '@gaming-platform/ui';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Crown, Trophy, Users } from 'lucide-react';
import { useMemo, useState } from 'react';

import { AnimatedNumber } from '@/components/marketing/animated-number';
import { TrendArrow } from '@/components/presence/trend-arrow';
import {
  avatarGradient,
  generateLeaderboard,
  LEADERBOARD_CATEGORIES,
  PLAYERS_RANKED,
  TOTAL_PAID_OUT,
  type LeaderboardCategory,
  type LeaderboardCategoryId,
  type PlayerRow,
  type VipTier,
} from '@/lib/leaderboard-mock';
import { tournamentApi } from '@/lib/tournament-api';

/* -------------------------------------------------------------------------- */
/* Static config                                                              */
/* -------------------------------------------------------------------------- */

const DEFAULT_CATEGORY = LEADERBOARD_CATEGORIES[0]!;

const VIP_BADGE: Record<VipTier, { label: string; variant: 'gold' | 'neon' | 'featured' | 'secondary' | 'outline' }> = {
  Diamond: { label: 'Diamond', variant: 'neon' },
  Platinum: { label: 'Platinum', variant: 'featured' },
  Gold: { label: 'Gold', variant: 'gold' },
  Silver: { label: 'Silver', variant: 'secondary' },
  Bronze: { label: 'Bronze', variant: 'outline' },
};

const PODIUM_STYLE: Record<1 | 2 | 3, { glow: string; chip: string; ring: string; text: string; label: string }> = {
  1: {
    glow: 'border-gold/50 shadow-glow-gold',
    chip: 'bg-gold text-gold-foreground shadow-glow-gold',
    ring: 'ring-gold',
    text: 'text-gradient-gold',
    label: 'Champion',
  },
  2: {
    glow: 'border-foreground/20 shadow-glow-sm',
    chip: 'bg-foreground/80 text-background',
    ring: 'ring-foreground/40',
    text: 'text-foreground/70',
    label: 'Runner-up',
  },
  3: {
    glow: 'border-warning/40',
    chip: 'bg-warning text-background',
    ring: 'ring-warning/60',
    text: 'text-warning',
    label: '3rd place',
  },
};

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function LeaderboardsPage() {
  const [categoryId, setCategoryId] = useState<LeaderboardCategoryId>(DEFAULT_CATEGORY.id);
  const category =
    LEADERBOARD_CATEGORIES.find((c) => c.id === categoryId) ?? DEFAULT_CATEGORY;

  // Keep the real backend query wired. We pick the first board and read its
  // top entries; if nothing comes back we fall back to rich demo data so the
  // page is never empty.
  const boards = useQuery({ queryKey: ['leaderboards'], queryFn: tournamentApi.leaderboards });
  const firstBoardId = boards.data?.[0]?.id;

  const top = useQuery({
    queryKey: ['leaderboard-top', firstBoardId],
    queryFn: () => tournamentApi.leaderboardTop(firstBoardId!),
    enabled: !!firstBoardId,
  });

  const rows: PlayerRow[] = useMemo(() => {
    const live = top.data;
    if (live && live.length > 0) {
      // Map real entries onto the presentation shape, enriching the bits the
      // backend doesn't provide with deterministic demo values.
      return live.map((e, i) => {
        const mock = generateLeaderboard(category.id, live.length)[i]!;
        return {
          ...mock,
          rank: e.rank,
          value: e.score,
          name: e.userId.slice(0, 12),
          initials: e.userId.slice(0, 2).toUpperCase(),
          avatarSeed: e.userId,
        };
      });
    }
    return generateLeaderboard(category.id);
  }, [top.data, category.id]);

  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);

  return (
    <div className="relative space-y-8">
      <div className="bg-grid pointer-events-none absolute inset-0 -z-10 opacity-40" />
      <div className="bg-aurora pointer-events-none absolute inset-0 -z-10 opacity-[0.15]" />

      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl border border-black/10 glass-strong p-6 sm:p-8">
        <div className="sheen pointer-events-none absolute inset-0" />
        <div className="relative">
          <h1 className="text-gradient font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Leaderboards
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Global, periodic and game-specific rankings — updated live.
          </p>
        </div>
        <div className="relative mt-5 grid gap-4 sm:grid-cols-2 sm:max-w-xl">
          <HeroStat
            icon={<Trophy className="h-5 w-5" />}
            tone="gold"
            label="Total paid out"
            value={<AnimatedNumber value={TOTAL_PAID_OUT} prefix="$" live />}
          />
          <HeroStat
            icon={<Users className="h-5 w-5" />}
            tone="primary"
            label="Players ranked"
            value={<AnimatedNumber value={PLAYERS_RANKED} />}
          />
        </div>
      </div>

      {/* Category switcher */}
      <CategorySwitcher
        categories={LEADERBOARD_CATEGORIES}
        active={category.id}
        onSelect={setCategoryId}
      />

      <p className="-mt-3 text-sm text-muted-foreground">{category.tagline}</p>

      {/* Podium */}
      <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-3">
        {orderPodium(podium).map(({ entry, place }, i) => (
          <PodiumCard key={entry.avatarSeed} entry={entry} place={place} metric={category.metric} delay={i * 0.08} />
        ))}
      </div>

      {/* Ranked list */}
      <div className="card-premium overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-black/5 px-4 py-3 sm:px-6">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Full ranking
          </h2>
          <Button variant="glass" size="sm">
            View all
          </Button>
        </div>
        <div className="max-h-[640px] divide-y divide-black/5 overflow-y-auto">
          {rest.map((entry, i) => (
            <RankRow key={entry.avatarSeed} entry={entry} metric={category.metric} index={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Hero stat                                                                  */
/* -------------------------------------------------------------------------- */

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
        <p className={cn('font-display text-2xl font-bold tabular-nums', tone === 'gold' ? 'text-gradient-gold' : 'text-gradient')}>
          {value}
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Category switcher                                                          */
/* -------------------------------------------------------------------------- */

function CategorySwitcher({
  categories,
  active,
  onSelect,
}: {
  categories: LeaderboardCategory[];
  active: LeaderboardCategoryId;
  onSelect: (id: LeaderboardCategoryId) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {categories.map((c) => {
        const isActive = c.id === active;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            className={cn(
              'relative rounded-full border px-4 py-2 text-sm font-semibold transition-all',
              isActive
                ? 'border-primary/60 bg-primary/10 text-foreground shadow-glow-sm'
                : 'glass text-muted-foreground hover:border-primary/40 hover:text-foreground',
            )}
          >
            {isActive ? (
              <motion.span
                layoutId="lb-pill"
                className="absolute inset-0 -z-10 rounded-full bg-primary/10 ring-1 ring-inset ring-primary/40"
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              />
            ) : null}
            {c.name}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Avatar                                                                     */
/* -------------------------------------------------------------------------- */

function GradientAvatar({
  seed,
  initials,
  className,
}: {
  seed: string;
  initials: string;
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
      {initials}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Podium card                                                                */
/* -------------------------------------------------------------------------- */

function PodiumCard({
  entry,
  place,
  metric,
  delay,
}: {
  entry: PlayerRow;
  place: 1 | 2 | 3;
  metric: LeaderboardCategory['metric'];
  delay: number;
}) {
  const s = PODIUM_STYLE[place];
  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, type: 'spring', stiffness: 220, damping: 24 }}
      className={cn(
        'card-premium relative flex flex-col items-center rounded-2xl border p-5 text-center',
        s.glow,
        place === 1 ? 'sm:order-2 sm:-mt-6 sm:pb-7' : place === 2 ? 'sm:order-1' : 'sm:order-3',
      )}
    >
      <span
        className={cn(
          'absolute -top-3 flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-[11px] font-bold',
          s.chip,
        )}
      >
        {place === 1 ? <Crown className="h-4 w-4" /> : `#${place}`}
      </span>

      <div className="relative">
        <GradientAvatar
          seed={entry.avatarSeed}
          initials={entry.initials}
          className={cn('h-16 w-16 text-lg ring-2 ring-offset-2 ring-offset-card', s.ring, place === 1 && 'h-20 w-20')}
        />
      </div>

      <p className="mt-3 flex items-center gap-1.5 truncate text-sm font-semibold text-foreground">
        <span className="text-base leading-none">{entry.country}</span>
        {entry.name}
      </p>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{s.label}</p>

      <p className={cn('mt-2 font-display text-2xl font-extrabold tabular-nums', s.text)}>
        <AnimatedNumber value={entry.value} prefix={prefixFor(metric)} decimals={metric === 'multiplier' ? 2 : 0} suffix={suffixFor(metric)} />
      </p>

      <Badge variant={VIP_BADGE[entry.vipTier].variant} className="mt-2">
        {VIP_BADGE[entry.vipTier].label}
      </Badge>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* Ranked row                                                                 */
/* -------------------------------------------------------------------------- */

function RankRow({
  entry,
  metric,
  index,
}: {
  entry: PlayerRow;
  metric: LeaderboardCategory['metric'];
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(index * 0.025, 0.6), duration: 0.3 }}
      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-black/[0.03] sm:px-6"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-card font-mono text-xs font-bold tabular-nums text-muted-foreground">
        {entry.rank}
      </span>

      <TrendArrow delta={entry.delta} />

      <GradientAvatar seed={entry.avatarSeed} initials={entry.initials} className="h-9 w-9 text-xs" />

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-foreground">
          <span className="text-base leading-none">{entry.country}</span>
          {entry.name}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">{entry.game}</p>
      </div>

      <Badge variant={VIP_BADGE[entry.vipTier].variant} className="hidden sm:inline-flex">
        {VIP_BADGE[entry.vipTier].label}
      </Badge>

      <span className="hidden font-mono text-xs tabular-nums text-accent md:inline">
        {entry.multiplier.toFixed(2)}x
      </span>

      <span className="w-28 shrink-0 text-right font-mono text-sm font-bold tabular-nums text-foreground">
        <AnimatedNumber
          value={entry.value}
          prefix={prefixFor(metric)}
          decimals={metric === 'multiplier' ? 2 : 0}
          suffix={suffixFor(metric)}
        />
      </span>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function prefixFor(metric: LeaderboardCategory['metric']): string {
  return metric === 'winnings' ? '$' : '';
}

function suffixFor(metric: LeaderboardCategory['metric']): string {
  return metric === 'multiplier' ? 'x' : metric === 'score' ? ' pts' : '';
}

/** Place 1 in the center, 2 on the left, 3 on the right (on >= sm). */
function orderPodium(entries: PlayerRow[]): Array<{ entry: PlayerRow; place: 1 | 2 | 3 }> {
  return entries.map((entry, i) => ({ entry, place: (i + 1) as 1 | 2 | 3 }));
}
