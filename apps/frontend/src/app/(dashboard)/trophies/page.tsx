'use client';

import { Badge, Button, cn } from '@gaming-platform/ui';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Award,
  Box,
  Clover,
  Coins,
  Crown,
  Diamond,
  Flame,
  Gem,
  Medal,
  Moon,
  Package,
  Play,
  Rocket,
  Shield,
  Snowflake,
  Sparkles,
  Star,
  Sword,
  Target,
  Trophy,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { AnimatedNumber } from '@/components/marketing/animated-number';
import { PageHeader } from '@/components/shared/page-header';
import { sound } from '@/lib/sound';
import { usePlayerProfile } from '@/stores/player-profile';

/* ---- Icon registry (map lucide NAME strings safely) ---------------------- */
const ICONS: Record<string, LucideIcon> = {
  Play,
  Coins,
  Rocket,
  Sparkles,
  CircleDot: Target,
  Trophy,
  Moon,
  Gem,
  Crown,
  Shield,
  Star,
  Award,
  Clover,
  Package,
  Box,
  Medal,
  Diamond,
  Flame,
  Snowflake,
  Sword,
  Zap,
  Target,
};
function Icon({ name, className }: { name: string; className?: string }) {
  const Cmp = ICONS[name] ?? Trophy;
  return <Cmp className={className} />;
}

/* ---- Rarity styling ------------------------------------------------------ */
type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
const RARITY: Record<Rarity, { label: string; ring: string; glow: string; text: string; grad: string; badge: 'outline' | 'neon' | 'featured' | 'gold' }> = {
  common: { label: 'Common', ring: 'ring-black/10', glow: '', text: 'text-muted-foreground', grad: 'from-muted-foreground/60 to-muted-foreground/30', badge: 'outline' },
  rare: { label: 'Rare', ring: 'ring-accent/40', glow: 'shadow-glow-neon', text: 'text-accent', grad: 'from-accent to-primary', badge: 'neon' },
  epic: { label: 'Epic', ring: 'ring-violet/45', glow: 'shadow-glow', text: 'text-violet', grad: 'from-violet to-pink', badge: 'featured' },
  legendary: { label: 'Legendary', ring: 'ring-gold/50', glow: 'shadow-glow-gold', text: 'text-gold', grad: 'from-gold via-warning to-pink', badge: 'gold' },
};

/* ---- Deterministic showcase data (never empty) --------------------------- */
interface TrophyItem {
  id: string;
  name: string;
  desc: string;
  icon: string;
  rarity: Rarity;
  unlocked: boolean;
  tag?: string;
}

const CUPS: TrophyItem[] = [
  { id: 'cup-gold', name: 'Neon Rush Grand Champion', desc: '1st place · Season 3 Grand Final', icon: 'Trophy', rarity: 'legendary', unlocked: true, tag: 'Gold Cup' },
  { id: 'cup-silver', name: 'Weekend Showdown Finalist', desc: '2nd place · $1M Weekend Showdown', icon: 'Medal', rarity: 'epic', unlocked: true, tag: 'Silver Cup' },
  { id: 'cup-bronze', name: 'Crash Masters Podium', desc: '3rd place · Crash Masters Invitational', icon: 'Medal', rarity: 'rare', unlocked: true, tag: 'Bronze Cup' },
  { id: 'cup-blitz', name: 'Blitz Cup Qualifier', desc: 'Top 8 · Midnight Blitz Cup', icon: 'Award', rarity: 'rare', unlocked: false, tag: 'Locked' },
];

const LEGENDARY: TrophyItem[] = [
  { id: 'leg-crown', name: 'Crown of the Syndicate', desc: 'Awarded to the reigning clan leader', icon: 'Crown', rarity: 'legendary', unlocked: true },
  { id: 'leg-gem', name: 'Eternal Jackpot Gem', desc: 'Hit a 100x jackpot on Crash', icon: 'Gem', rarity: 'legendary', unlocked: true },
  { id: 'leg-diamond', name: 'Diamond Hand', desc: 'Cash out above 50x, ten times', icon: 'Diamond', rarity: 'epic', unlocked: false },
];

const BADGES: TrophyItem[] = [
  { id: 'bdg-founder', name: 'Founder', desc: 'Joined during the launch season', icon: 'Shield', rarity: 'legendary', unlocked: true },
  { id: 'bdg-vip', name: 'VIP', desc: 'Reached VIP status', icon: 'Star', rarity: 'epic', unlocked: true },
  { id: 'bdg-flame', name: 'On Fire', desc: '10-win hot streak', icon: 'Flame', rarity: 'rare', unlocked: true },
  { id: 'bdg-lucky', name: 'Lucky Charm', desc: 'Win with a triple on Dice', icon: 'Clover', rarity: 'rare', unlocked: true },
  { id: 'bdg-frost', name: 'Ice Cold', desc: 'Stay calm through a 5-loss streak', icon: 'Snowflake', rarity: 'common', unlocked: false },
  { id: 'bdg-blade', name: 'Duelist', desc: 'Win a head-to-head challenge', icon: 'Sword', rarity: 'epic', unlocked: false },
];

const SPECIAL_EVENTS: TrophyItem[] = [
  { id: 'ev-newyear', name: 'New Year Blitz 2026', desc: 'Ranked top 100 in the countdown event', icon: 'Sparkles', rarity: 'epic', unlocked: true },
  { id: 'ev-summer', name: 'Summer Heatwave', desc: 'Completed all Happy Hour challenges', icon: 'Flame', rarity: 'rare', unlocked: true },
  { id: 'ev-winter', name: 'Frost Festival', desc: 'Collected all snowflake tokens', icon: 'Snowflake', rarity: 'rare', unlocked: true },
  { id: 'ev-anniv', name: 'Anniversary Gala', desc: 'Attended the platform anniversary', icon: 'Star', rarity: 'legendary', unlocked: false },
];

export default function TrophyRoomPage() {
  const achievements = usePlayerProfile((s) => s.achievements);
  const seasonName = usePlayerProfile((s) => s.seasonName);
  const seasonTier = usePlayerProfile((s) => s.seasonTier);
  const [selected, setSelected] = useState<TrophyItem | null>(null);

  // Season rewards derived from current tier — deterministic, never empty.
  const seasonRewards: TrophyItem[] = useMemo(
    () => [
      { id: 'sr-1', name: `Tier ${seasonTier} Coin Vault`, desc: '25,000 coins season payout', icon: 'Coins', rarity: 'rare', unlocked: true },
      { id: 'sr-2', name: 'Neon Rush Frame', desc: 'Exclusive animated avatar frame', icon: 'Sparkles', rarity: 'epic', unlocked: true },
      { id: 'sr-3', name: 'Season Crown', desc: `Top-tier reward · reach tier ${seasonTier + 13}`, icon: 'Crown', rarity: 'legendary', unlocked: false },
      { id: 'sr-4', name: 'Prestige Emblem', desc: 'Awarded at season prestige', icon: 'Medal', rarity: 'epic', unlocked: false },
    ],
    [seasonTier],
  );

  const achTrophies: TrophyItem[] = useMemo(
    () =>
      achievements.map((a) => ({
        id: a.id,
        name: a.name,
        desc: a.desc,
        icon: a.icon,
        rarity: a.rarity as Rarity,
        unlocked: a.unlocked,
      })),
    [achievements],
  );

  // Statistics strip.
  const allTrophies = useMemo(
    () => [...achTrophies, ...CUPS, ...LEGENDARY, ...BADGES, ...seasonRewards, ...SPECIAL_EVENTS],
    [achTrophies, seasonRewards],
  );
  const stats = useMemo(() => {
    const unlocked = allTrophies.filter((t) => t.unlocked);
    const legendary = unlocked.filter((t) => t.rarity === 'legendary').length;
    const completion = Math.round((unlocked.length / Math.max(1, allTrophies.length)) * 100);
    return { total: unlocked.length, all: allTrophies.length, legendary, completion };
  }, [allTrophies]);

  function openTrophy(t: TrophyItem) {
    setSelected(t);
    if (t.unlocked) {
      sound.play(t.rarity === 'legendary' ? 'achievement' : 'reward');
      toast.success(`${t.name}`, { description: RARITY[t.rarity].label + ' · ' + t.desc });
    } else {
      toast(`${t.name} — locked`, { description: t.desc });
    }
  }

  return (
    <div className="relative space-y-8">
      {/* Ambient room backdrop */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-grid opacity-[0.4]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-aurora opacity-20" />

      <PageHeader
        title="Trophy Room"
        description={`Your personal hall of glory · ${seasonName}`}
        action={
          <Badge variant="gold" className="gap-1.5 px-3 py-1">
            <Trophy className="h-3.5 w-3.5" /> {stats.total} trophies
          </Badge>
        }
      />

      {/* Statistics strip */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={Trophy} grad="from-gold to-warning" label="Total Trophies" value={stats.total} suffix={` / ${stats.all}`} tone="text-gradient-gold" />
        <StatCard icon={Crown} grad="from-violet to-pink" label="Legendary" value={stats.legendary} tone="text-gradient" />
        <StatCard icon={Target} grad="from-primary to-accent" label="Completion" value={stats.completion} suffix="%" tone="text-gradient" />
      </div>

      <Shelf title="Achievements" icon={Award} accent="text-gradient-gold" subtitle={`${achTrophies.filter((a) => a.unlocked).length}/${achTrophies.length} unlocked`}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {achTrophies.map((t, i) => (
            <Pedestal key={t.id} item={t} index={i} onClick={() => openTrophy(t)} />
          ))}
        </div>
      </Shelf>

      <Shelf title="Tournament Cups" icon={Trophy} accent="text-gradient-gold" subtitle="Podium finishes across the arena">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {CUPS.map((t, i) => (
            <Pedestal key={t.id} item={t} index={i} onClick={() => openTrophy(t)} big />
          ))}
        </div>
      </Shelf>

      <Shelf title="Legendary Rewards" icon={Gem} accent="text-gradient" subtitle="The rarest showcase pieces">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {LEGENDARY.map((t, i) => (
            <Pedestal key={t.id} item={t} index={i} onClick={() => openTrophy(t)} big />
          ))}
        </div>
      </Shelf>

      <Shelf title="Badges" icon={Shield} accent="text-gradient" subtitle="Earned marks of honor">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {BADGES.map((t, i) => (
            <Pedestal key={t.id} item={t} index={i} onClick={() => openTrophy(t)} />
          ))}
        </div>
      </Shelf>

      <Shelf title="Season Rewards" icon={Star} accent="text-gradient-gold" subtitle={`${seasonName} · Tier ${seasonTier}`}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {seasonRewards.map((t, i) => (
            <Pedestal key={t.id} item={t} index={i} onClick={() => openTrophy(t)} />
          ))}
        </div>
      </Shelf>

      <Shelf title="Special Events" icon={Sparkles} accent="text-gradient" subtitle="Limited-time event trophies">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {SPECIAL_EVENTS.map((t, i) => (
            <Pedestal key={t.id} item={t} index={i} onClick={() => openTrophy(t)} />
          ))}
        </div>
      </Shelf>

      {/* Detail modal */}
      <AnimatePresence>
        {selected ? (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSelected(null)} />
            <motion.div
              className={cn('card-premium sheen relative z-10 w-full max-w-md overflow-hidden p-6 text-center', RARITY[selected.rarity].glow)}
              initial={{ scale: 0.85, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 10, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            >
              <button
                className="absolute right-3 top-3 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground"
                onClick={() => setSelected(null)}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
              <div
                className={cn(
                  'mx-auto flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br text-white ring-2',
                  RARITY[selected.rarity].grad,
                  RARITY[selected.rarity].ring,
                  RARITY[selected.rarity].glow,
                  !selected.unlocked && 'grayscale',
                )}
              >
                <Icon name={selected.icon} className="h-11 w-11" />
              </div>
              <h3 className="mt-4 font-display text-xl font-bold">{selected.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{selected.desc}</p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <Badge variant={RARITY[selected.rarity].badge}>{RARITY[selected.rarity].label}</Badge>
                <Badge variant={selected.unlocked ? 'success' : 'outline'}>{selected.unlocked ? 'Unlocked' : 'Locked'}</Badge>
              </div>
              <Button variant="glass" className="mt-5 w-full" onClick={() => setSelected(null)}>
                Close
              </Button>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ---- Sub-components ------------------------------------------------------ */
function StatCard({ icon: I, grad, label, value, suffix, tone }: { icon: LucideIcon; grad: string; label: string; value: number; suffix?: string; tone: string }) {
  return (
    <div className="card-premium relative overflow-hidden p-5">
      <div className={cn('pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-gradient-to-br opacity-20 blur-3xl', grad)} />
      <div className="relative flex items-center gap-4">
        <span className={cn('flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-glow-sm', grad)}>
          <I className="h-6 w-6" />
        </span>
        <div>
          <p className={cn('font-display text-2xl font-bold tabular-nums', tone)}>
            <AnimatedNumber value={value} />
            {suffix ? <span className="text-base text-muted-foreground">{suffix}</span> : null}
          </p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </div>
    </div>
  );
}

function Shelf({ title, subtitle, icon: I, accent, children }: { title: string; subtitle?: string; icon: LucideIcon; accent: string; children: React.ReactNode }) {
  return (
    <section className="card-premium relative overflow-hidden p-5 sm:p-6">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/[0.03] to-transparent" />
      <div className="relative mb-5 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-gold/20 to-warning/10 text-gold ring-1 ring-inset ring-gold/30">
          <I className="h-5 w-5" />
        </span>
        <div>
          <h2 className={cn('font-display text-lg font-bold', accent)}>{title}</h2>
          {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
      </div>
      <div className="relative">{children}</div>
    </section>
  );
}

function Pedestal({ item, index, onClick, big }: { item: TrophyItem; index: number; onClick: () => void; big?: boolean }) {
  const r = RARITY[item.rarity];
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.4), type: 'spring', stiffness: 200, damping: 20 }}
      whileHover={{ y: -6 }}
      className={cn(
        'group relative flex flex-col items-center rounded-2xl border p-4 text-center transition-shadow',
        item.unlocked ? cn('glass border-black/10', r.glow) : 'border-dashed border-black/10 bg-white/[0.02]',
      )}
    >
      {item.tag ? (
        <span className="absolute left-2 top-2 rounded-full bg-black/5 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
          {item.tag}
        </span>
      ) : null}
      <div
        className={cn(
          'flex items-center justify-center rounded-2xl bg-gradient-to-br text-white ring-2 transition-transform group-hover:scale-105',
          big ? 'h-20 w-20' : 'h-14 w-14',
          r.grad,
          r.ring,
          item.unlocked ? r.glow : 'opacity-40 grayscale',
        )}
      >
        <Icon name={item.icon} className={big ? 'h-9 w-9' : 'h-6 w-6'} />
      </div>
      {/* Pedestal base */}
      <div className={cn('mt-2 h-1.5 w-2/3 rounded-full bg-gradient-to-r opacity-70', r.grad)} />
      <p className="mt-2 line-clamp-1 text-sm font-semibold">{item.name}</p>
      <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{item.desc}</p>
      <span className={cn('mt-2 text-[10px] font-semibold uppercase tracking-wide', item.unlocked ? r.text : 'text-muted-foreground')}>
        {item.unlocked ? r.label : 'Locked'}
      </span>
    </motion.button>
  );
}
