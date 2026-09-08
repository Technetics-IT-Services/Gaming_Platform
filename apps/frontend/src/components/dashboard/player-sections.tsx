'use client';

import { Badge, cn } from '@gaming-platform/ui';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Dices,
  Gamepad2,
  Gem,
  LifeBuoy,
  Lock,
  Receipt,
  Settings,
  Spade,
  TrendingUp,
  UserCircle2,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useDashboardMoney } from '@/components/dashboard/use-dashboard-money';
import { fmtTime } from '@/lib/datetime';
import { useAuthStore } from '@/stores/auth-store';
import { usePlayerProfile } from '@/stores/player-profile';

/**
 * Player-home widgets (Phase 1.3.3 → 1.4 → 1.3.4). The personal touches on the
 * premium gaming Dashboard — greeting, quick actions and the bottom recent-
 * activity / VIP cards. All client-only + mounted-gated (they read the persisted
 * wallet / in-memory profile), so there is no hydration mismatch. They reuse the
 * existing stores + design system and never touch wallet/auth logic. Offers live
 * only on /promotions — nothing here is promotional.
 *
 * Phase 2C.17 (P0-1): every MONEY figure now comes from `useDashboardMoney()` — server-authoritative
 * for a real session, clearly-labelled demo state for a demo session. These widgets previously read
 * `useDemoWallet` unconditionally, so a real ledger-funded player saw demo money on the page login
 * lands on.
 */

/* ------------------------------------------------------------------ hero */

/**
 * Welcome-back hero (target step 1) — greeting, Demo Account badge and today's
 * gaming summary. VIP progress has its own card at the foot of the page, so this
 * stays focused on identity + today's action.
 */
export function PlayerHero() {
  const demoUsername = usePlayerProfile((s) => s.username);
  const level = usePlayerProfile((s) => s.level);
  const authUser = useAuthStore((s) => s.user);
  const money = useDashboardMoney();
  const today = money.today;
  // A real session is identified by its BACKEND identity, not the demo profile store.
  const username = money.isReal ? (authUser?.displayName || authUser?.username || '') : demoUsername;

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /** Render "—" rather than a fabricated 0 while the server figures are still loading. */
  const stat = (v: string): string => (money.loading ? '—' : v);

  return (
    <section className="card-premium relative overflow-hidden p-6 sm:p-8">
      <div className="bg-aurora pointer-events-none absolute inset-0 opacity-[0.12]" />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet to-primary font-display text-xl font-bold text-white shadow-glow-sm">
            {mounted ? level : '—'}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Welcome back{mounted && username ? `, ${username}` : ''}
              </h1>
              {mounted && money.isDemo ? (
                <Badge variant="secondary" className="gap-1" data-testid="demo-account-badge">
                  <Gem className="h-3 w-3 text-violet" /> Demo Account
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Your gaming hub — jump back in, check today&apos;s action and keep playing.
            </p>
          </div>
        </div>

        {/* Today's gaming summary */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:w-auto">
          <TodayStat label="Rounds" value={mounted ? stat(String(today.rounds)) : '—'} />
          <TodayStat label="Wins" value={mounted ? stat(`${today.wins}/${today.rounds}`) : '—'} tone="text-emerald" />
          <TodayStat label="Wagered" value={mounted ? stat(`₹${today.wagered.toLocaleString('en-US')}`) : '—'} />
          <TodayStat
            label="Net today"
            value={mounted ? stat(`${today.net >= 0 ? '+' : '−'}₹${Math.abs(today.net).toLocaleString('en-US')}`) : '—'}
            tone={mounted && today.net < 0 ? 'text-destructive' : 'text-emerald'}
          />
        </div>
      </div>
    </section>
  );
}

function TodayStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white/50 px-4 py-3 text-center backdrop-blur">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 font-mono text-base font-bold tabular-nums text-foreground', tone)}>{value}</p>
    </div>
  );
}

/* --------------------------------------------------------- quick actions */

const ACTIONS: { label: string; href: string; icon: LucideIcon; tone: string }[] = [
  { label: 'Deposit', href: '/deposit', icon: ArrowDownToLine, tone: 'text-emerald' },
  { label: 'Withdraw', href: '/withdraw', icon: ArrowUpFromLine, tone: 'text-destructive' },
  { label: 'Vault', href: '/vault', icon: Lock, tone: 'text-violet' },
  { label: 'Transactions', href: '/transactions', icon: Receipt, tone: 'text-primary' },
  { label: 'Bet History', href: '/bets', icon: Dices, tone: 'text-accent' },
  { label: 'Casino', href: '/casino', icon: Spade, tone: 'text-primary' },
  { label: 'Sportsbook', href: '/sportsbook', icon: TrendingUp, tone: 'text-accent' },
  { label: 'Profile', href: '/profile', icon: UserCircle2, tone: 'text-violet' },
  { label: 'Support', href: '/help', icon: LifeBuoy, tone: 'text-emerald' },
  { label: 'Settings', href: '/settings', icon: Settings, tone: 'text-muted-foreground' },
];

/** Premium quick actions — equal cards, premium hover, responsive 2 → 6 cols. */
export function QuickActions() {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold tracking-tight md:text-xl">
        <Gamepad2 className="h-5 w-5 text-primary" /> Quick actions
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {ACTIONS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            aria-label={a.label}
            className="card-premium sheen group flex aspect-[4/3] flex-col items-center justify-center gap-2 p-3 text-center outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring sm:aspect-[3/2]"
          >
            <span
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-xl bg-black/[0.04] transition-transform group-hover:scale-110',
                a.tone,
              )}
            >
              <a.icon className="h-5 w-5" />
            </span>
            <span className="text-xs font-semibold text-foreground">{a.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* --------------------------------------------------- bottom recent cards */

/** Recent bets (target step 16) — reads the shared bet ledger. */
export function RecentBetsCard() {
  const money = useDashboardMoney();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const recent = money.bets;

  return (
    <div className="card-premium flex flex-col p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Dices className="h-4 w-4 text-primary" /> Recent bets
        </span>
        <Link href="/bets" className="text-xs font-semibold text-primary hover:underline">
          View all
        </Link>
      </div>
      {!mounted || money.loading ? (
        <Empty text="Loading…" />
      ) : money.error ? (
        <Empty text="Could not load your rounds right now." />
      ) : recent.length === 0 ? (
        <Empty text="No bets yet — play a game to get started." />
      ) : (
        <ul className="space-y-2.5">
          {recent.map((b) => (
            <li key={b.id} className="flex items-center gap-3">
              <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold uppercase', b.win ? 'bg-emerald/10 text-emerald' : 'bg-destructive/10 text-destructive')}>
                {b.win ? 'W' : 'L'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{b.game}</span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">
                  {b.roundId} · {fmtTime(b.ts)}
                </span>
              </span>
              <span className={cn('shrink-0 font-mono text-sm font-bold tabular-nums', b.win ? 'text-emerald' : 'text-destructive')}>
                {b.net >= 0 ? '+' : '−'}₹{Math.abs(b.net).toLocaleString('en-US')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Recent transactions (target step 17) — reads the shared wallet ledger. */
export function RecentTransactionsCard() {
  const money = useDashboardMoney();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const recent = money.transactions;

  return (
    <div className="card-premium flex flex-col p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Receipt className="h-4 w-4 text-primary" /> Recent transactions
        </span>
        <Link href="/transactions" className="text-xs font-semibold text-primary hover:underline">
          View all
        </Link>
      </div>
      {!mounted || money.loading ? (
        <Empty text="Loading…" />
      ) : money.error ? (
        <Empty text="Could not load your transactions right now." />
      ) : recent.length === 0 ? (
        <Empty text="No transactions yet." />
      ) : (
        <ul className="space-y-2.5">
          {recent.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">{t.label}</span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">
                  {t.ref} · {fmtTime(t.ts)}
                </span>
              </span>
              <span className={cn('shrink-0 font-mono text-sm font-bold tabular-nums', t.amount > 0 ? 'text-emerald' : 'text-foreground')}>
                {t.amount > 0 ? '+' : '−'}₹{Math.abs(t.amount).toLocaleString('en-US')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** VIP / level progress (target step 18) — reuses the in-memory player profile. */
export function VipProgressCard() {
  const level = usePlayerProfile((s) => s.level);
  const xp = usePlayerProfile((s) => s.xp);
  const xpToNext = usePlayerProfile((s) => s.xpToNext);
  const seasonTier = usePlayerProfile((s) => s.seasonTier);
  const seasonName = usePlayerProfile((s) => s.seasonName);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const pct = mounted && xpToNext > 0 ? Math.min(100, Math.round((xp / xpToNext) * 100)) : 0;

  return (
    <div className="card-premium relative flex flex-col overflow-hidden p-5">
      <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-gradient-to-br from-violet to-primary opacity-20 blur-3xl" />
      <div className="relative mb-3 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Gem className="h-4 w-4 text-violet" /> VIP progress
        </span>
        <Link href="/vip" className="text-xs font-semibold text-violet hover:underline">
          VIP lounge
        </Link>
      </div>
      <div className="relative flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet to-primary font-display text-lg font-bold text-white shadow-glow-sm">
          {mounted ? level : '—'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-sm font-bold text-foreground">Level {mounted ? level : '—'}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {seasonName} · Tier {mounted ? seasonTier : '—'}
          </p>
        </div>
      </div>
      <div className="relative mt-4">
        <div className="h-2.5 overflow-hidden rounded-full bg-black/5">
          <div
            className="h-full rounded-full bg-gradient-to-r from-violet via-primary to-violet shadow-glow-sm transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1.5 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
          {mounted ? `${xp.toLocaleString('en-US')} / ${xpToNext.toLocaleString('en-US')} XP` : '— XP'}
        </p>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-1 items-center justify-center py-6 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
