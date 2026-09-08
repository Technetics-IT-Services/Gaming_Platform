'use client';

import { Badge, cn } from '@gaming-platform/ui';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  Crown,
  Flame,
  Gem,
  Medal,
  Sparkles,
  Star,
  TrendingUp,
  Trophy,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { AnimatedNumber } from '@/components/marketing/animated-number';
import { PageHeader } from '@/components/shared/page-header';
import { sound } from '@/lib/sound';
import { avatarGradient, initials, topPlayers, type CommunityPlayer } from '@/lib/ecosystem-data';

/* ---- Deterministic seed helper ------------------------------------------ */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface Category {
  id: string;
  label: string;
  icon: LucideIcon;
  unit: (v: number) => string;
  /** Seeded raw value for a player+category (larger = higher rank). */
  score: (p: CommunityPlayer, base: number) => number;
  accent: string;
}

const CATEGORIES: Category[] = [
  { id: 'xp', label: 'Top XP', icon: Star, accent: 'from-primary to-violet', unit: (v) => `${v.toLocaleString('en-US')} XP`, score: (p, b) => b * 42 + p.level * 900 },
  { id: 'wins', label: 'Top Wins', icon: Trophy, accent: 'from-gold to-warning', unit: (v) => `${v.toLocaleString('en-US')} wins`, score: (p, b) => b + p.level * 4 },
  { id: 'jackpot', label: 'Biggest Jackpot', icon: Gem, accent: 'from-pink to-violet', unit: (v) => `$${v.toLocaleString('en-US')}`, score: (_p, b) => b * 130 },
  { id: 'champ', label: 'Tournament Champions', icon: Crown, accent: 'from-gold via-warning to-pink', unit: (v) => `${v} titles`, score: (p, b) => (b % 40) + p.level },
  { id: 'level', label: 'Highest Level', icon: Zap, accent: 'from-accent to-primary', unit: (v) => `Level ${v}`, score: (p) => p.level * 1000 + hash(p.seed) % 1000 },
  { id: 'streak', label: 'Longest Streak', icon: Flame, accent: 'from-destructive to-warning', unit: (v) => `${v} in a row`, score: (_p, b) => (b % 60) + 3 },
  { id: 'active', label: 'Most Active', icon: Activity, accent: 'from-emerald to-accent', unit: (v) => `${v.toLocaleString('en-US')} min`, score: (p, b) => b * 3 + p.level * 20 },
];

interface Ranked {
  player: CommunityPlayer;
  score: number;
  displayValue: number;
  rank: number;
}

const PODIUM_META: Record<1 | 2 | 3, { grad: string; ring: string; glow: string; icon: LucideIcon; label: string; badge: 'gold' | 'featured' | 'neon'; h: string }> = {
  1: { grad: 'from-gold via-warning to-gold', ring: 'ring-gold/60', glow: 'shadow-glow-gold', icon: Crown, label: 'Champion', badge: 'gold', h: 'h-40' },
  2: { grad: 'from-slate-600 to-slate-500', ring: 'ring-black/15', glow: 'shadow-glow-sm', icon: Medal, label: 'Runner-up', badge: 'featured', h: 'h-32' },
  3: { grad: 'from-amber-600 to-orange-400', ring: 'ring-warning/40', glow: 'shadow-glow-sm', icon: Medal, label: 'Third', badge: 'neon', h: 'h-28' },
};

export default function HallOfFamePage() {
  const [catId, setCatId] = useState<string>('xp');
  const category = CATEGORIES.find((c) => c.id === catId) ?? CATEGORIES[0]!;

  const ranked: Ranked[] = useMemo(() => {
    const players = topPlayers();
    const scored = players.map((p) => {
      const base = hash(`${category.id}-${p.seed}`) % 100000;
      return { player: p, score: category.score(p, base) };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s, i) => ({
      ...s,
      rank: i + 1,
      // Present a clean value derived from score, monotonically decreasing.
      displayValue: 1 + Math.round(s.score % 250000),
    }));
  }, [category]);

  const top3 = ranked.slice(0, 3);
  const rest = ranked.slice(3);

  function switchCategory(id: string) {
    if (id === catId) return;
    setCatId(id);
    sound.play('reward');
  }

  return (
    <div className="relative space-y-8">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 bg-aurora opacity-[0.22]" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-grid opacity-[0.35]" />

      <PageHeader
        title="Hall of Fame"
        description="The legends who rule the leaderboards"
        action={
          <Badge variant="gold" className="gap-1.5 px-3 py-1">
            <Sparkles className="h-3.5 w-3.5" /> {category.label}
          </Badge>
        }
      />

      {/* Category switcher (glass segmented) */}
      <div className="glass flex flex-wrap gap-1.5 rounded-2xl p-1.5">
        {CATEGORIES.map((c) => {
          const active = c.id === catId;
          const I = c.icon;
          return (
            <button
              key={c.id}
              onClick={() => switchCategory(c.id)}
              className={cn(
                'relative flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors sm:text-sm',
                active ? 'text-white' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {active ? (
                <motion.span
                  layoutId="cat-pill"
                  className={cn('absolute inset-0 -z-10 rounded-xl bg-gradient-to-r shadow-glow-sm', c.accent)}
                  transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                />
              ) : null}
              <I className="h-4 w-4" />
              {c.label}
            </button>
          );
        })}
      </div>

      {/* Podium */}
      <section className="card-premium relative overflow-hidden p-6 pb-0 sm:p-8 sm:pb-0">
        {/* Spotlight */}
        <div className={cn('pointer-events-none absolute left-1/2 top-0 h-64 w-[28rem] -translate-x-1/2 rounded-full bg-gradient-to-b opacity-25 blur-3xl', category.accent)} />
        {/* Confetti / sparkle vibe */}
        {[...Array(14)].map((_, i) => {
          const left = (hash(`conf-${catId}-${i}`) % 100);
          const delay = (hash(`d-${i}`) % 100) / 100;
          const grad = ['from-gold', 'from-pink', 'from-accent', 'from-violet'][i % 4]!;
          return (
            <motion.span
              key={`${catId}-${i}`}
              className={cn('pointer-events-none absolute top-4 h-1.5 w-1.5 rounded-full bg-gradient-to-br to-transparent', grad)}
              style={{ left: `${left}%` }}
              initial={{ y: -10, opacity: 0 }}
              animate={{ y: [0, 40, 90], opacity: [0, 1, 0] }}
              transition={{ duration: 2.4, delay, repeat: Infinity, repeatDelay: 1.5 }}
            />
          );
        })}

        <AnimatePresence mode="wait">
          <motion.div
            key={catId}
            className="relative flex items-end justify-center gap-3 sm:gap-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* Order: 2nd, 1st, 3rd */}
            {([top3[1], top3[0], top3[2]] as (Ranked | undefined)[]).map((entry, slot) => {
              if (!entry) return null;
              const rank = entry.rank;
              if (rank > 3) return null;
              const meta = PODIUM_META[rank as 1 | 2 | 3];
              return (
                <motion.div
                  key={entry.player.seed}
                  className="flex w-24 flex-col items-center sm:w-32"
                  initial={{ y: 60, opacity: 0, scale: 0.9 }}
                  animate={{ y: 0, opacity: 1, scale: 1 }}
                  transition={{ delay: slot * 0.12, type: 'spring', stiffness: 220, damping: 18 }}
                >
                  <div className="relative">
                    {rank === 1 ? (
                      <motion.div
                        className="absolute -top-8 left-1/2 -translate-x-1/2 text-gold"
                        animate={{ y: [0, -4, 0] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      >
                        <Crown className="h-7 w-7 drop-shadow" />
                      </motion.div>
                    ) : null}
                    <div
                      className={cn(
                        'flex items-center justify-center rounded-full bg-gradient-to-br font-display font-bold text-white ring-4',
                        rank === 1 ? 'h-20 w-20 text-2xl sm:h-24 sm:w-24' : 'h-16 w-16 text-xl sm:h-20 sm:w-20',
                        avatarGradient(entry.player.seed),
                        meta.ring,
                        meta.glow,
                      )}
                    >
                      {initials(entry.player.name)}
                    </div>
                    <span className="absolute -bottom-1 -right-1 text-xl">{entry.player.flag}</span>
                  </div>
                  <p className="mt-2 line-clamp-1 text-center text-sm font-bold">{entry.player.name}</p>
                  <p className="text-[11px] text-muted-foreground">Lv {entry.player.level}</p>
                  <p className={cn('font-mono text-xs font-semibold tabular-nums', rank === 1 ? 'text-gold' : 'text-foreground')}>
                    {category.unit(entry.displayValue)}
                  </p>
                  {/* Column */}
                  <div
                    className={cn(
                      'mt-2 flex w-full items-start justify-center rounded-t-2xl bg-gradient-to-b pt-3 ring-1 ring-inset ring-white/20',
                      meta.h,
                      meta.grad,
                      meta.glow,
                    )}
                  >
                    <span className="font-display text-3xl font-black text-white/90 drop-shadow">{rank}</span>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </section>

      {/* Ranked list */}
      <section className="card-premium p-2 sm:p-3">
        <AnimatePresence mode="wait">
          <motion.ul
            key={catId}
            className="divide-y divide-black/5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {rest.map((entry, i) => (
              <motion.li
                key={entry.player.seed}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.05, 0.4) }}
                className="flex items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-black/[0.03]"
              >
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: Math.min(i * 0.05, 0.4), type: 'spring', stiffness: 300, damping: 18 }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/5 font-mono text-sm font-bold tabular-nums text-muted-foreground"
                >
                  {entry.rank}
                </motion.span>
                <div className="relative shrink-0">
                  <span className={cn('flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br font-display text-sm font-bold text-white', avatarGradient(entry.player.seed))}>
                    {initials(entry.player.name)}
                  </span>
                  <span className="absolute -bottom-1 -right-1 text-sm">{entry.player.flag}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{entry.player.name}</p>
                  <p className="text-[11px] text-muted-foreground">Level {entry.player.level}</p>
                </div>
                <p className={cn('font-mono text-sm font-semibold tabular-nums', category.accent.includes('gold') ? 'text-gold' : 'text-foreground')}>
                  <AnimatedNumber value={entry.displayValue} />
                </p>
              </motion.li>
            ))}
          </motion.ul>
        </AnimatePresence>
      </section>

      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <TrendingUp className="h-3.5 w-3.5" /> Rankings refresh every season · {topPlayers().length} legends ranked
      </p>
    </div>
  );
}
