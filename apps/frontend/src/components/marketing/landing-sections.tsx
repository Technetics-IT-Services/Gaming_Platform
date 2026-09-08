'use client';

import { Button, cn } from '@gaming-platform/ui';
import { motion } from 'framer-motion';
import {
  Coins,
  Crown,
  Flame,
  Gift,
  Quote,
  Sparkles,
  Star,
  Timer,
  Trophy,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { AnimatedNumber } from './animated-number';

/* -------------------------------------------------------------------------- */
/* Daily jackpot                                                              */
/* -------------------------------------------------------------------------- */

export function JackpotBanner() {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-black/10 bg-card/40 p-1">
      <div className="bg-aurora absolute inset-0 opacity-20" />
      <div className="relative flex flex-col items-center gap-6 rounded-[calc(1.5rem-2px)] bg-gradient-to-b from-background/40 to-background/80 px-6 py-10 text-center md:flex-row md:justify-between md:text-left">
        <div className="flex items-center gap-4">
          <span className="flex h-16 w-16 shrink-0 animate-glow-pulse items-center justify-center rounded-2xl bg-gradient-gold text-gold-foreground shadow-glow-gold">
            <Coins className="h-8 w-8" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
              Mega Daily Jackpot
            </p>
            <div className="font-display text-4xl font-bold tracking-tight md:text-5xl">
              <span className="text-gradient-gold">
                <AnimatedNumber value={1284930} prefix="$" live />
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <div className="flex items-center gap-2 rounded-full border border-black/10 bg-card/60 px-4 py-2 text-sm text-muted-foreground">
            <Timer className="h-4 w-4 text-gold" /> Drops in <Countdown seconds={6 * 3600 + 1200} />
          </div>
          <Button asChild size="lg" variant="gold" className="sheen">
            <Link href="/games?sort=popular">
              <Zap className="h-4 w-4" /> Play for jackpot
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

function Countdown({ seconds }: { seconds: number }) {
  const [remaining, setRemaining] = useState(seconds);
  useEffect(() => {
    const id = setInterval(() => setRemaining((r) => (r <= 1 ? seconds : r - 1)), 1000);
    return () => clearInterval(id);
  }, [seconds]);
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    <span className="font-mono font-semibold tabular-nums text-foreground">
      {pad(h)}:{pad(m)}:{pad(s)}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Live winners ticker (illustrative marquee)                                 */
/* -------------------------------------------------------------------------- */

const WINNERS = [
  { name: 'Phoenix', game: 'Crash', amount: 12450 },
  { name: 'NovaQueen', game: 'Roulette', amount: 8230 },
  { name: 'Vortex', game: 'Dice', amount: 3120 },
  { name: 'GoldRush', game: 'Blackjack', amount: 21500 },
  { name: 'Zenith', game: 'Crash', amount: 5400 },
  { name: 'Mirage', game: 'Sports', amount: 9870 },
  { name: 'Apex', game: 'Roulette', amount: 4300 },
  { name: 'Lumen', game: 'Dice', amount: 15640 },
];

export function LiveWinners() {
  const row = [...WINNERS, ...WINNERS];
  return (
    <section className="space-y-3">
      <SectionHeading icon={<Flame className="h-5 w-5 text-warning" />} title="Latest winners" />
      <div className="relative overflow-hidden rounded-2xl border border-black/10 bg-card/30 py-3 [mask-image:linear-gradient(90deg,transparent,black_6%,black_94%,transparent)]">
        <div className="flex w-max animate-marquee gap-3">
          {row.map((w, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-xl border border-black/10 bg-card/60 px-4 py-2.5"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-violet text-xs font-bold text-white">
                {w.name.slice(0, 2).toUpperCase()}
              </span>
              <div className="leading-tight">
                <p className="text-sm font-semibold">{w.name}</p>
                <p className="text-xs text-muted-foreground">{w.game}</p>
              </div>
              <span className="font-mono text-sm font-bold text-emerald">
                +${w.amount.toLocaleString('en-US')}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Promotions                                                                 */
/* -------------------------------------------------------------------------- */

const PROMOS = [
  {
    title: 'Welcome Bonus',
    desc: '100% match up to $500 + 200 free spins on your first deposit.',
    cta: 'Claim now',
    href: '/register',
    icon: Gift,
    accent: 'from-primary to-violet',
    badge: 'New players',
  },
  {
    title: 'Weekly Cashback',
    desc: 'Get up to 15% back on net losses every week. No opt-in needed.',
    cta: 'Learn more',
    href: '/rewards',
    icon: Coins,
    accent: 'from-gold to-warning',
    badge: 'VIP',
  },
  {
    title: 'Crash Race',
    desc: 'Climb the live multiplier leaderboard for a share of $50,000.',
    cta: 'Join the race',
    href: '/crash',
    icon: Trophy,
    accent: 'from-accent to-primary',
    badge: 'Hot',
  },
];

export function Promotions() {
  return (
    <section id="promotions" className="scroll-mt-24 space-y-4">
      <SectionHeading
        icon={<Sparkles className="h-5 w-5 text-primary" />}
        title="Today's promotions"
        action={{ label: 'All promotions', href: '/offers' }}
      />
      <div className="grid gap-4 md:grid-cols-3">
        {PROMOS.map((p, i) => {
          const Icon = p.icon;
          return (
            <motion.div
              key={p.title}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className="card-premium sheen group relative overflow-hidden p-6"
            >
              <div
                className={cn(
                  'absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br opacity-20 blur-2xl transition-opacity group-hover:opacity-40',
                  p.accent,
                )}
              />
              <div className="relative space-y-4">
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      'flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-glow-sm',
                      p.accent,
                    )}
                  >
                    <Icon className="h-6 w-6" />
                  </span>
                  <span className="rounded-full border border-black/10 bg-card/60 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {p.badge}
                  </span>
                </div>
                <div>
                  <h3 className="font-display text-lg font-bold">{p.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{p.desc}</p>
                </div>
                <Button asChild variant="glass" size="sm" className="w-full">
                  <Link href={p.href}>{p.cta}</Link>
                </Button>
              </div>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Tournament spotlight                                                       */
/* -------------------------------------------------------------------------- */

export function TournamentSpotlight() {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-black/10">
      <div className="absolute inset-0 bg-gradient-to-br from-violet/30 via-background to-accent/20" />
      <div className="bg-grid absolute inset-0 opacity-40" />
      <div className="relative grid gap-6 p-8 md:grid-cols-2 md:items-center md:p-12">
        <div className="space-y-5">
          <span className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-card/50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent backdrop-blur">
            <Crown className="h-3.5 w-3.5" /> Featured tournament
          </span>
          <h2 className="font-display text-3xl font-bold leading-tight md:text-4xl">
            Weekend Millionaire <span className="text-gradient">Showdown</span>
          </h2>
          <p className="max-w-md text-muted-foreground">
            Battle thousands of players across crash, dice and roulette. Climb the live leaderboard
            and claim your share of the prize pool.
          </p>
          <div className="flex flex-wrap gap-6">
            <Spotlight label="Prize pool" value={<AnimatedNumber value={1000000} prefix="$" />} />
            <Spotlight label="Players" value={<AnimatedNumber value={12480} live />} />
            <Spotlight label="Starts in" value={<Countdown seconds={2 * 3600 + 540} />} />
          </div>
          <div className="flex gap-3">
            <Button asChild size="lg" variant="gradient" className="sheen">
              <Link href="/tournaments">
                <Trophy className="h-4 w-4" /> Register now
              </Link>
            </Button>
            <Button asChild size="lg" variant="glass">
              <Link href="/leaderboards">View leaderboard</Link>
            </Button>
          </div>
        </div>
        <div className="relative hidden md:block">
          <div className="mx-auto flex aspect-square max-w-xs items-center justify-center">
            <div className="absolute h-56 w-56 animate-glow-pulse rounded-full bg-gold/30 blur-3xl" />
            <Trophy className="relative h-40 w-40 text-gold drop-shadow-[0_0_30px_hsl(var(--gold)/0.6)]" />
          </div>
        </div>
      </div>
    </section>
  );
}

function Spotlight({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="font-display text-2xl font-bold text-foreground">{value}</div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Testimonials                                                               */
/* -------------------------------------------------------------------------- */

const QUOTES = [
  {
    name: 'Marcus T.',
    role: 'Diamond VIP',
    text: 'Fastest withdrawals I have ever seen and the crash game is pure adrenaline. This is the real deal.',
  },
  {
    name: 'Sofia R.',
    role: 'Tournament champion',
    text: 'Won the weekend showdown last month. The leaderboards update live — it feels like an esport.',
  },
  {
    name: 'Dev K.',
    role: 'High roller',
    text: 'Slick, gorgeous, and it never lags even on big multiplier rounds. My new home for live casino.',
  },
];

export function Testimonials() {
  return (
    <section id="about" className="scroll-mt-24 space-y-4">
      <SectionHeading icon={<Star className="h-5 w-5 text-gold" />} title="Loved by players" />
      <div className="grid gap-4 md:grid-cols-3">
        {QUOTES.map((q, i) => (
          <motion.div
            key={q.name}
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.5, delay: i * 0.08 }}
            className="card-premium relative p-6"
          >
            <Quote className="h-7 w-7 text-primary/40" />
            <p className="mt-3 text-sm text-foreground/90">{q.text}</p>
            <div className="mt-5 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-violet text-xs font-bold text-white">
                {q.name.slice(0, 2).toUpperCase()}
              </span>
              <div>
                <p className="text-sm font-semibold">{q.name}</p>
                <p className="text-xs text-gold">{q.role}</p>
              </div>
              <div className="ml-auto flex gap-0.5">
                {Array.from({ length: 5 }).map((_, s) => (
                  <Star key={s} className="h-3.5 w-3.5 fill-gold text-gold" />
                ))}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared section heading                                                     */
/* -------------------------------------------------------------------------- */

export function SectionHeading({
  icon,
  title,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="flex items-center gap-2 font-display text-xl font-bold tracking-tight md:text-2xl">
        {icon}
        {title}
      </h2>
      {action ? (
        <Link
          href={action.href}
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-accent"
        >
          {action.label} →
        </Link>
      ) : null}
    </div>
  );
}
