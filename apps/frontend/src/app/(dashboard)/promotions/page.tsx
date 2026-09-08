'use client';

import { Button, cn } from '@gaming-platform/ui';
import {
  BadgePercent,
  Coins,
  Crown,
  Gift,
  Sparkles,
  Target,
  Trophy,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { DailyRewardCard } from '@/components/rewards/daily-reward-card';
import { LuckyWheel } from '@/components/rewards/lucky-wheel';
import { MysteryChest } from '@/components/rewards/mystery-chest';
import { SectionHeading, TournamentSpotlight } from '@/components/marketing/landing-sections';
import { sound } from '@/lib/sound';
import { useDemoWallet } from '@/stores/demo-wallet';

/* -------------------------------------------------------------------------- */
/* Offer catalogue (demo). `reward` offers are claimable → credit a Bonus.    */
/* -------------------------------------------------------------------------- */

type OfferStatus = 'active' | 'claimed' | 'expired';

interface Offer {
  id: string;
  title: string;
  desc: string;
  badge: string;
  icon: LucideIcon;
  accent: string;
  status: OfferStatus;
  /** Claimable coin bonus; omitted for informational/linked offers. */
  reward?: number;
  /** CTA for non-claimable offers. */
  cta?: string;
  href?: string;
}

const OFFERS: Offer[] = [
  {
    id: 'welcome',
    title: 'Welcome Bonus',
    desc: 'A starter boost credited to every new guest wallet — already yours.',
    badge: 'New players',
    icon: Gift,
    accent: 'from-primary to-violet',
    status: 'claimed',
  },
  {
    id: 'reload',
    title: 'Reload Bonus',
    desc: 'Top your wallet back up to the demo baseline whenever you run low.',
    badge: 'Anytime',
    icon: Zap,
    accent: 'from-accent to-primary',
    status: 'active',
    reward: 5000,
  },
  {
    id: 'cashback',
    title: 'Weekly Cashback',
    desc: 'Get a slice of your weekly wagering back — no strings attached.',
    badge: 'VIP',
    icon: Coins,
    accent: 'from-gold to-warning',
    status: 'active',
    reward: 2500,
  },
  {
    id: 'weekly',
    title: 'Weekly Promo',
    desc: 'Fresh bonuses drop every week across casino, crash and live tables.',
    badge: 'This week',
    icon: BadgePercent,
    accent: 'from-emerald to-accent',
    status: 'active',
    reward: 1500,
  },
  {
    id: 'referral',
    title: 'Referral Bonus',
    desc: 'Invite a friend and you both earn a coin bonus on their first play.',
    badge: 'Invite',
    icon: Users,
    accent: 'from-violet to-pink',
    status: 'active',
    cta: 'Invite a friend',
    href: '/profile',
  },
  {
    id: 'seasonal',
    title: 'Seasonal Promotion',
    desc: 'Limited-time seasonal rewards tied to the current battle pass.',
    badge: 'Season 3',
    icon: Sparkles,
    accent: 'from-pink to-violet',
    status: 'active',
    cta: 'View battle pass',
    href: '/battle-pass',
  },
  {
    id: 'vip',
    title: 'VIP Offers',
    desc: 'Exclusive reload rates, cashback and gifts for VIP-tier players.',
    badge: 'VIP',
    icon: Crown,
    accent: 'from-gold to-warning',
    status: 'active',
    cta: 'VIP lounge',
    href: '/vip',
  },
  {
    id: 'missions',
    title: 'Mission Rewards',
    desc: 'Complete daily and weekly missions to claim coin + XP rewards.',
    badge: 'Daily',
    icon: Target,
    accent: 'from-primary to-accent',
    status: 'active',
    cta: 'View missions',
    href: '/missions',
  },
  {
    id: 'tournaments',
    title: 'Tournament Rewards',
    desc: 'Climb the leaderboard in featured tournaments for prize payouts.',
    badge: 'Compete',
    icon: Trophy,
    accent: 'from-accent to-primary',
    status: 'active',
    cta: 'View tournaments',
    href: '/tournaments',
  },
  {
    id: 'launch',
    title: 'Launch Free Spins',
    desc: 'Opening-week free spins bundle — this promotion has now ended.',
    badge: 'Ended',
    icon: Sparkles,
    accent: 'from-muted to-muted',
    status: 'expired',
  },
];

const FILTERS: { key: 'all' | OfferStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'claimed', label: 'Claimed' },
  { key: 'expired', label: 'Expired' },
];

/* -------------------------------------------------------------------------- */

export default function PromotionsPage() {
  const bonus = useDemoWallet((s) => s.bonus);
  const [filter, setFilter] = useState<'all' | OfferStatus>('all');
  const [claimed, setClaimed] = useState<Record<string, boolean>>({});

  const offers = useMemo(() => {
    return OFFERS.map((o) => (claimed[o.id] ? { ...o, status: 'claimed' as OfferStatus } : o));
  }, [claimed]);

  const rows = filter === 'all' ? offers : offers.filter((o) => o.status === filter);

  const claim = (o: Offer) => {
    if (!o.reward) return;
    bonus(o.reward, { label: o.title, source: 'promo' });
    setClaimed((c) => ({ ...c, [o.id]: true }));
    sound.play('reward');
    toast.success(`${o.title} claimed — +₹${o.reward.toLocaleString('en-US')}!`);
  };

  return (
    <div className="space-y-10 pb-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gold/10 text-gold">
          <Gift className="h-6 w-6" />
        </span>
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            Promotions
          </h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            Your offer center — bonuses, cashback, daily rewards and seasonal promotions in one place.
          </p>
        </div>
      </div>

      {/* Status filter */}
      <div className="glass-strong flex flex-wrap gap-1.5 rounded-2xl p-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm font-semibold transition-colors',
              filter === f.key
                ? 'bg-primary text-primary-foreground shadow-glow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Offers grid */}
      <section className="space-y-4">
        <SectionHeading icon={<Sparkles className="h-5 w-5 text-primary" />} title="Bonuses & offers" />
        {rows.length === 0 ? (
          <div className="card-premium flex h-40 items-center justify-center text-sm text-muted-foreground">
            No {filter} promotions right now.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {rows.map((o) => (
              <OfferCard key={o.id} offer={o} onClaim={() => claim(o)} />
            ))}
          </div>
        )}
      </section>

      {/* Daily rewards + mini-games (reused reward components) */}
      <section className="space-y-4">
        <SectionHeading icon={<Gift className="h-5 w-5 text-gold" />} title="Claim your daily rewards" />
        <div className="grid gap-4 lg:grid-cols-3">
          <DailyRewardCard />
          <LuckyWheel />
          <MysteryChest />
        </div>
      </section>

      {/* Featured tournament reward (reused marketing section) */}
      <section className="space-y-4">
        <SectionHeading icon={<Trophy className="h-5 w-5 text-accent" />} title="Featured tournament" />
        <TournamentSpotlight />
      </section>
    </div>
  );
}

function OfferCard({ offer, onClaim }: { offer: Offer; onClaim: () => void }) {
  const { icon: Icon, status } = offer;
  const dim = status !== 'active';

  return (
    <div className={cn('card-premium sheen group relative overflow-hidden p-6', dim && 'opacity-90')}>
      <div
        className={cn(
          'absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br opacity-20 blur-2xl transition-opacity group-hover:opacity-40',
          offer.accent,
        )}
      />
      <div className="relative flex h-full flex-col gap-4">
        <div className="flex items-center justify-between">
          <span
            className={cn(
              'flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-glow-sm',
              offer.accent,
            )}
          >
            <Icon className="h-6 w-6" />
          </span>
          <StatusBadge status={status} fallback={offer.badge} />
        </div>
        <div className="flex-1">
          <h3 className="font-display text-lg font-bold">{offer.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{offer.desc}</p>
        </div>

        {offer.reward && status === 'active' ? (
          <Button variant="gradient" size="sm" className="sheen w-full" onClick={onClaim}>
            <Wallet className="h-4 w-4" /> Claim ₹{offer.reward.toLocaleString('en-US')}
          </Button>
        ) : offer.href ? (
          <Button asChild variant="glass" size="sm" className="w-full">
            <Link href={offer.href}>{offer.cta ?? 'Learn more'}</Link>
          </Button>
        ) : (
          <Button variant="glass" size="sm" className="w-full" disabled>
            {status === 'claimed' ? 'Claimed' : 'Ended'}
          </Button>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status, fallback }: { status: OfferStatus; fallback: string }) {
  if (status === 'claimed') {
    return (
      <span className="rounded-full border border-emerald/30 bg-card px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald">
        Claimed
      </span>
    );
  }
  if (status === 'expired') {
    return (
      <span className="rounded-full border border-black/10 bg-card px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Expired
      </span>
    );
  }
  return (
    <span className="rounded-full border border-black/10 bg-card px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {fallback}
    </span>
  );
}
