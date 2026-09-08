'use client';

import { Badge, Button, cn } from '@gaming-platform/ui';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  CircleDollarSign,
  CircleDot,
  Clover,
  Coins,
  Compass,
  Cpu,
  Crown,
  Diamond,
  Dice5,
  Flame,
  Gamepad2,
  Gem,
  Grid3x3,
  Heart,
  Image as ImageIcon,
  Layers,
  Lock,
  type LucideIcon,
  Medal,
  MousePointer2,
  Music,
  Orbit,
  Package,
  Rocket,
  Shield,
  ShieldCheck,
  Sparkles,
  Spade,
  Star,
  Store,
  Sunrise,
  Timer,
  TrendingUp,
  Trees,
  Trophy,
  User,
  Waves,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { MarketplaceHistory } from '@/components/economy/marketplace-history';
import { PriceHistory } from '@/components/economy/price-history';
import { AnimatedNumber } from '@/components/marketing/animated-number';
import {
  ALL_COSMETICS,
  type Cosmetic,
  type CosmeticCategory,
  RARITY_RING,
  RARITY_TEXT,
} from '@/lib/cosmetics';
import { marketTrades, priceHistory, supplyDemand } from '@/lib/economy';
import { sound } from '@/lib/sound';
import { useDemoWallet } from '@/stores/demo-wallet';
import { usePlayerProfile } from '@/stores/player-profile';

/* ---- Icon record --------------------------------------------------------- */
const ICONS: Record<string, LucideIcon> = {
  Shield, Gem, Crown, Sparkles, Zap, Cpu, Diamond, Trophy, Gamepad2, Rocket, Star,
  Waves, Trees, Orbit, User, Clover, Dice5, CircleDot, Medal, Package, Compass,
  ShieldCheck, Image: ImageIcon, Grid3x3, Sunrise, Flame, Coins, MousePointer2,
  Music, CircleDollarSign, Spade,
};
const iconFor = (name: string): LucideIcon => ICONS[name] ?? Sparkles;

const EQUIPPABLE: CosmeticCategory[] = ['frame', 'theme', 'title', 'banner'];
const isEquippable = (c: CosmeticCategory) => EQUIPPABLE.includes(c);

const CATEGORY_LABELS: Record<CosmeticCategory, string> = {
  frame: 'Frames',
  theme: 'Themes',
  title: 'Titles',
  banner: 'Banners',
  particle: 'Particles',
  cursor: 'Cursors',
  music: 'Music',
  diceSkin: 'Dice Skins',
  chip: 'Chips',
  cardBack: 'Card Backs',
};

/* ---- Deterministic pickers (no Date.now at module scope) ----------------- */
const FEATURED = ALL_COSMETICS.filter((c) => c.rarity === 'legendary' || c.rarity === 'epic').slice(0, 3);
const TRENDING = ALL_COSMETICS.filter((c) => c.rarity === 'rare' || c.rarity === 'epic').slice(0, 10);
// Deterministic limited set + seed seconds (ticked client-side, never Date.now here)
const LIMITED = ALL_COSMETICS.filter((c) => c.rarity === 'legendary').slice(0, 4);
const LIMITED_SEED_SECONDS: Record<string, number> = LIMITED.reduce(
  (acc, c, i) => {
    acc[c.id] = 3600 * (i + 1) + 1800; // deterministic: 1h30m, 2h30m, ...
    return acc;
  },
  {} as Record<string, number>,
);

function fmtCountdown(total: number): string {
  const s = Math.max(0, total);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default function MarketplacePage() {
  const balance = useDemoWallet((s) => s.balance);
  const owned = usePlayerProfile((s) => s.owned);
  const equippedFrame = usePlayerProfile((s) => s.equippedFrame);
  const equippedTheme = usePlayerProfile((s) => s.equippedTheme);
  const equippedTitle = usePlayerProfile((s) => s.equippedTitle);
  const equippedBanner = usePlayerProfile((s) => s.equippedBanner);
  const buy = usePlayerProfile((s) => s.buy);
  const equipCosmetic = usePlayerProfile((s) => s.equipCosmetic);

  // Deterministic market activity (backend-free).
  const trades = useMemo(() => marketTrades('marketplace', 8), []);
  const pulse = useMemo(() => supplyDemand('marketplace-pulse'), []);
  const pulseSeries = useMemo(() => priceHistory('marketplace-pulse', 16, 1200), []);

  const [preview, setPreview] = useState<Cosmetic | null>(null);
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [filter, setFilter] = useState<CosmeticCategory | 'all'>('all');

  // Countdown state — seeded deterministically, ticked client-side only.
  const [remaining, setRemaining] = useState<Record<string, number>>(LIMITED_SEED_SECONDS);
  useEffect(() => {
    const id = window.setInterval(() => {
      setRemaining((prev) => {
        const next: Record<string, number> = {};
        for (const k of Object.keys(prev)) {
          const cur = prev[k] ?? 0;
          next[k] = cur <= 0 ? LIMITED_SEED_SECONDS[k] ?? 3600 : cur - 1;
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const equippedId = (cat: CosmeticCategory): string | null => {
    switch (cat) {
      case 'frame':
        return equippedFrame;
      case 'theme':
        return equippedTheme;
      case 'title':
        return equippedTitle;
      case 'banner':
        return equippedBanner;
      default:
        return null;
    }
  };

  const handleBuy = (item: Cosmetic) => {
    const ok = buy(item.id);
    if (ok) {
      sound.play('coin');
      toast.success(`Purchased ${item.name}!`, {
        description: `${item.price.toLocaleString('en-US')} coins spent.`,
      });
    } else {
      toast.error('Not enough coins.', { description: 'Reload demo coins in the Store.' });
    }
  };

  const handleEquip = (item: Cosmetic) => {
    equipCosmetic(item.category, item.id);
    sound.play('reward');
    toast.success(`Equipped ${item.name}.`);
  };

  const toggleWish = (id: string, name: string) => {
    setWishlist((prev) => {
      if (prev.includes(id)) {
        toast.info(`Removed ${name} from wishlist.`);
        return prev.filter((w) => w !== id);
      }
      sound.play('reward');
      toast.success(`Added ${name} to wishlist.`);
      return [...prev, id];
    });
  };

  // Collections grouped by category (respecting filter)
  const categories = useMemo(
    () => (Object.keys(CATEGORY_LABELS) as CosmeticCategory[]).filter((c) => filter === 'all' || c === filter),
    [filter],
  );

  const wishlistItems = wishlist
    .map((id) => ALL_COSMETICS.find((c) => c.id === id))
    .filter((c): c is Cosmetic => Boolean(c));

  return (
    <div className="relative space-y-10">
      <div className="bg-grid pointer-events-none absolute inset-0 -z-10 opacity-[0.04]" />

      {/* Header */}
      <section className="card-premium sheen relative overflow-hidden p-6 sm:p-7">
        <div className="bg-aurora absolute inset-0 opacity-10" />
        <div className="relative flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-accent via-primary to-violet text-white shadow-glow">
              <Store className="h-6 w-6" />
            </span>
            <div>
              <h1 className="font-display text-2xl font-bold text-gradient sm:text-3xl">Marketplace</h1>
              <p className="text-sm text-muted-foreground">
                Featured drops, trending picks and limited items — all with demo coins.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-2xl border border-gold/20 bg-white/70 px-4 py-2.5 shadow-glow-gold backdrop-blur">
            <Coins className="h-6 w-6 text-gold" />
            <div>
              <div className="font-display text-xl font-bold text-gradient-gold">
                <AnimatedNumber value={balance} />
              </div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Demo coins</div>
            </div>
          </div>
        </div>
      </section>

      {/* Featured */}
      <section className="space-y-4">
        <SectionTitle icon={Sparkles} label="Featured" accent="gold" />
        <div className="grid gap-4 md:grid-cols-3">
          {FEATURED.map((item, i) => {
            const Icon = iconFor(item.icon);
            const ownedIt = owned.includes(item.id);
            return (
              <motion.button
                key={item.id}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
                onClick={() => setPreview(item)}
                className="card-premium group relative overflow-hidden p-0 text-left"
              >
                <div className={cn('relative h-40 overflow-hidden bg-gradient-to-br', item.gradient)}>
                  <motion.div
                    aria-hidden
                    className="absolute inset-0 bg-gradient-to-br from-white/25 via-transparent to-white/10"
                    animate={{ opacity: [0.25, 0.55, 0.25] }}
                    transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut', delay: i * 0.4 }}
                  />
                  <div className="bg-grid absolute inset-0 opacity-10" />
                  <Icon className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 text-white drop-shadow-2xl transition-transform group-hover:scale-110" />
                  <Badge variant="gold" className="absolute left-3 top-3">
                    Featured
                  </Badge>
                  {ownedIt ? (
                    <Badge variant="new" className="absolute right-3 top-3">
                      Owned
                    </Badge>
                  ) : null}
                </div>
                <div className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-display text-lg font-bold">{item.name}</p>
                    <p className={cn('text-xs font-semibold capitalize', RARITY_TEXT[item.rarity])}>
                      {item.rarity} · {CATEGORY_LABELS[item.category]}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 font-bold text-gold">
                    <Coins className="h-4 w-4" />
                    {item.price.toLocaleString('en-US')}
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      </section>

      {/* Trending — horizontal scroll */}
      <section className="space-y-4">
        <SectionTitle icon={TrendingUp} label="Trending" accent="primary" />
        <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
          {TRENDING.map((item) => {
            const Icon = iconFor(item.icon);
            const ownedIt = owned.includes(item.id);
            const affordable = balance >= item.price;
            return (
              <div
                key={item.id}
                className="card-premium relative w-44 shrink-0 overflow-hidden p-3"
              >
                <button
                  onClick={() => setPreview(item)}
                  className={cn(
                    'relative flex h-24 w-full items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br ring-2',
                    item.gradient,
                    RARITY_RING[item.rarity],
                  )}
                >
                  <Icon className="h-9 w-9 text-white drop-shadow-lg" />
                </button>
                <p className="mt-2 truncate font-display text-sm font-bold">{item.name}</p>
                <div className="mt-0.5 flex items-center justify-between">
                  <span className={cn('text-[11px] font-semibold capitalize', RARITY_TEXT[item.rarity])}>
                    {item.rarity}
                  </span>
                  <span className="flex items-center gap-1 text-xs font-bold text-gold">
                    <Coins className="h-3 w-3" />
                    {item.price.toLocaleString('en-US')}
                  </span>
                </div>
                <div className="mt-2">
                  {ownedIt ? (
                    <Badge variant="new" className="w-full justify-center">Owned</Badge>
                  ) : affordable ? (
                    <Button size="sm" variant="gradient" className="h-8 w-full" onClick={() => handleBuy(item)}>
                      Buy
                    </Button>
                  ) : (
                    <Button size="sm" variant="glass" className="h-8 w-full" disabled>
                      <Lock className="mr-1 h-3 w-3" /> Locked
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Market activity — latest trades + price pulse (deterministic) */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="card-premium p-5 lg:col-span-2">
          <h2 className="mb-4 flex items-center gap-2 font-display text-xl font-bold">
            <Layers className="h-5 w-5 text-accent" /> Latest trades
          </h2>
          <MarketplaceHistory trades={trades} />
        </div>
        <div className="card-premium space-y-4 p-5">
          <h2 className="flex items-center gap-2 font-display text-xl font-bold">
            <TrendingUp className="h-5 w-5 text-emerald" /> Market pulse
          </h2>
          <div>
            <p className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">7-day price index</p>
            <PriceHistory series={pulseSeries} movementPct={pulse.movementPct} />
          </div>
          <div className="space-y-2.5">
            <PulseBar label="Supply" value={pulse.supply} max={520} tone="bg-accent" />
            <PulseBar label="Demand" value={pulse.demand} max={640} tone="bg-pink" />
            <PulseBar label="Popularity" value={pulse.popularity} max={100} tone="bg-gold" suffix="%" />
          </div>
        </div>
      </section>

      {/* Limited items — countdown */}
      <section className="space-y-4">
        <SectionTitle icon={Timer} label="Limited Items" accent="pink" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {LIMITED.map((item) => {
            const Icon = iconFor(item.icon);
            const ownedIt = owned.includes(item.id);
            const affordable = balance >= item.price;
            const secs = remaining[item.id] ?? LIMITED_SEED_SECONDS[item.id] ?? 3600;
            return (
              <div key={item.id} className="card-premium relative overflow-hidden p-3">
                <button
                  onClick={() => setPreview(item)}
                  className={cn(
                    'relative flex h-28 w-full items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br ring-2',
                    item.gradient,
                    RARITY_RING[item.rarity],
                  )}
                >
                  <div className="bg-grid absolute inset-0 opacity-10" />
                  <Icon className="relative h-11 w-11 text-white drop-shadow-lg" />
                  <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 font-mono text-[11px] font-bold text-white backdrop-blur">
                    <Timer className="h-3 w-3" /> {fmtCountdown(secs)}
                  </span>
                </button>
                <div className="mt-2 flex items-center justify-between">
                  <p className="truncate font-display text-sm font-bold">{item.name}</p>
                  <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-gold">
                    <Coins className="h-3 w-3" />
                    {item.price.toLocaleString('en-US')}
                  </span>
                </div>
                <div className="mt-2">
                  {ownedIt ? (
                    <Badge variant="new" className="w-full justify-center">Owned</Badge>
                  ) : affordable ? (
                    <Button size="sm" variant="gold" className="h-8 w-full sheen" onClick={() => handleBuy(item)}>
                      Grab it
                    </Button>
                  ) : (
                    <Button size="sm" variant="glass" className="h-8 w-full" disabled>
                      <Lock className="mr-1 h-3 w-3" /> Not enough
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Wishlist */}
      <section className="space-y-4">
        <SectionTitle icon={Heart} label="Wishlist" accent="pink" count={wishlistItems.length} />
        {wishlistItems.length === 0 ? (
          <div className="card-premium flex items-center gap-3 p-5 text-sm text-muted-foreground">
            <Heart className="h-5 w-5 text-pink" />
            Tap the heart on any item below to add it to your wishlist.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {wishlistItems.map((item) => {
              const Icon = iconFor(item.icon);
              return (
                <div key={item.id} className="card-premium flex items-center gap-3 p-3">
                  <button
                    onClick={() => setPreview(item)}
                    className={cn(
                      'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ring-1',
                      item.gradient,
                      RARITY_RING[item.rarity],
                    )}
                  >
                    <Icon className="h-6 w-6 text-white" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{item.name}</p>
                    <p className="flex items-center gap-1 text-xs font-bold text-gold">
                      <Coins className="h-3 w-3" /> {item.price.toLocaleString('en-US')}
                    </p>
                  </div>
                  <button
                    onClick={() => toggleWish(item.id, item.name)}
                    className="flex h-8 w-8 items-center justify-center rounded-full glass text-pink hover:text-pink"
                    aria-label="Remove from wishlist"
                  >
                    <Heart className="h-4 w-4 fill-pink" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Collections — grouped by category, with filter */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle icon={Layers} label="Collections" accent="violet" />
          <div className="flex flex-wrap gap-2">
            <FilterPill active={filter === 'all'} onClick={() => setFilter('all')} label="All" />
            {(Object.keys(CATEGORY_LABELS) as CosmeticCategory[]).map((c) => (
              <FilterPill
                key={c}
                active={filter === c}
                onClick={() => setFilter(c)}
                label={CATEGORY_LABELS[c]}
              />
            ))}
          </div>
        </div>

        <div className="space-y-8">
          {categories.map((cat) => {
            const catItems = ALL_COSMETICS.filter((c) => c.category === cat);
            if (catItems.length === 0) return null;
            return (
              <div key={cat} className="space-y-3">
                <h3 className="flex items-center gap-2 font-display text-lg font-bold">
                  <span className="text-gradient">{CATEGORY_LABELS[cat]}</span>
                  <span className="text-xs font-normal text-muted-foreground">({catItems.length})</span>
                </h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {catItems.map((item) => {
                    const Icon = iconFor(item.icon);
                    const ownedIt = owned.includes(item.id);
                    const affordable = balance >= item.price;
                    const equipped = equippedId(item.category) === item.id;
                    const equippable = isEquippable(item.category);
                    const wished = wishlist.includes(item.id);
                    return (
                      <div key={item.id} className="card-premium group relative overflow-hidden p-2.5">
                        <button
                          onClick={() => toggleWish(item.id, item.name)}
                          className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur transition-colors hover:bg-black/65"
                          aria-label={wished ? 'Remove from wishlist' : 'Add to wishlist'}
                        >
                          <Heart className={cn('h-3.5 w-3.5', wished && 'fill-pink text-pink')} />
                        </button>
                        <button
                          onClick={() => setPreview(item)}
                          className={cn(
                            'relative flex h-20 w-full items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br ring-1 transition-transform group-hover:scale-[1.03]',
                            item.gradient,
                            RARITY_RING[item.rarity],
                          )}
                        >
                          <Icon className="h-8 w-8 text-white drop-shadow-lg" />
                        </button>
                        <p className="mt-2 truncate text-sm font-semibold">{item.name}</p>
                        <div className="mt-1 flex items-center justify-between">
                          <span className="flex items-center gap-1 text-xs font-bold text-gold">
                            <Coins className="h-3 w-3" /> {item.price === 0 ? 'Free' : item.price.toLocaleString('en-US')}
                          </span>
                          {ownedIt ? (
                            equippable && !equipped ? (
                              <button
                                onClick={() => handleEquip(item)}
                                className="text-xs font-bold text-accent hover:underline"
                              >
                                Equip
                              </button>
                            ) : equipped ? (
                              <span className="flex items-center gap-0.5 text-xs font-bold text-emerald">
                                <Check className="h-3 w-3" /> On
                              </span>
                            ) : (
                              <span className="text-xs font-bold text-emerald">Owned</span>
                            )
                          ) : affordable ? (
                            <button
                              onClick={() => handleBuy(item)}
                              className="text-xs font-bold text-primary hover:underline"
                            >
                              Buy
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground">Locked</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Preview modal */}
      <AnimatePresence>
        {preview ? (
          <PreviewModal
            item={preview}
            owned={owned.includes(preview.id)}
            equipped={equippedId(preview.category) === preview.id}
            equippable={isEquippable(preview.category)}
            affordable={balance >= preview.price}
            wished={wishlist.includes(preview.id)}
            onClose={() => setPreview(null)}
            onBuy={() => handleBuy(preview)}
            onEquip={() => handleEquip(preview)}
            onWish={() => toggleWish(preview.id, preview.name)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ---- Helpers ------------------------------------------------------------- */
function SectionTitle({
  icon: Icon,
  label,
  accent,
  count,
}: {
  icon: LucideIcon;
  label: string;
  accent: 'gold' | 'primary' | 'pink' | 'violet';
  count?: number;
}) {
  const bg: Record<string, string> = {
    gold: 'from-gold to-warning shadow-glow-gold',
    primary: 'from-primary to-violet shadow-glow',
    pink: 'from-pink to-violet shadow-glow-pink',
    violet: 'from-violet to-accent shadow-glow',
  };
  return (
    <h2 className="flex items-center gap-2 font-display text-xl font-bold md:text-2xl">
      <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br text-white', bg[accent])}>
        <Icon className="h-5 w-5" />
      </span>
      {label}
      {typeof count === 'number' ? (
        <span className="text-sm font-normal text-muted-foreground">({count})</span>
      ) : null}
    </h2>
  );
}

function PulseBar({
  label,
  value,
  max,
  tone,
  suffix,
}: {
  label: string;
  value: number;
  max: number;
  tone: string;
  suffix?: string;
}) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums">
          {value.toLocaleString('en-US')}
          {suffix ?? ''}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-black/5">
        <div className={cn('h-full rounded-full shadow-glow-sm', tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function FilterPill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full px-3 py-1 text-xs font-semibold transition-all',
        active
          ? 'bg-gradient-to-r from-primary via-violet to-pink text-white shadow-glow-sm'
          : 'glass text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

function PreviewModal({
  item,
  owned,
  equipped,
  equippable,
  affordable,
  wished,
  onClose,
  onBuy,
  onEquip,
  onWish,
}: {
  item: Cosmetic;
  owned: boolean;
  equipped: boolean;
  equippable: boolean;
  affordable: boolean;
  wished: boolean;
  onClose: () => void;
  onBuy: () => void;
  onEquip: () => void;
  onWish: () => void;
}) {
  const Icon = iconFor(item.icon);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.94, y: 16, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.94, y: 16, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
        className="card-premium relative w-full max-w-md overflow-hidden p-5"
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full glass text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div
          className={cn(
            'relative flex h-44 w-full items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br ring-2',
            item.gradient,
            RARITY_RING[item.rarity],
          )}
        >
          <div className="bg-grid absolute inset-0 opacity-10" />
          <Icon className="relative h-20 w-20 text-white drop-shadow-xl" />
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <h2 className="font-display text-xl font-bold">{item.name}</h2>
          <button
            onClick={onWish}
            className="flex h-8 w-8 items-center justify-center rounded-full glass text-pink"
            aria-label="Toggle wishlist"
          >
            <Heart className={cn('h-4 w-4', wished && 'fill-pink')} />
          </button>
        </div>
        <p className="mt-1 text-sm capitalize text-muted-foreground">
          {item.rarity} · {CATEGORY_LABELS[item.category]}
        </p>

        <div className="mt-3 flex items-center gap-2 text-lg font-bold text-gold">
          <Coins className="h-5 w-5" />
          {item.price === 0 ? 'Free' : item.price.toLocaleString('en-US')}
        </div>

        <div className="mt-5">
          {owned ? (
            equippable ? (
              equipped ? (
                <Button variant="glass" disabled className="w-full">
                  <Check className="mr-1.5 h-4 w-4 text-emerald" /> Equipped
                </Button>
              ) : (
                <Button variant="neon" className="w-full" onClick={onEquip}>
                  Equip now
                </Button>
              )
            ) : (
              <div className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald/10 py-2.5 text-sm font-semibold text-emerald ring-1 ring-inset ring-emerald/40">
                <Check className="h-4 w-4" /> Owned
              </div>
            )
          ) : affordable ? (
            <Button variant="gradient" className="w-full sheen" onClick={onBuy}>
              Buy for {item.price.toLocaleString('en-US')} coins
            </Button>
          ) : (
            <Button variant="glass" disabled className="w-full">
              <Lock className="mr-1.5 h-4 w-4" /> Not enough coins
            </Button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
