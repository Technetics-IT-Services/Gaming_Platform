'use client';

import { cn } from '@gaming-platform/ui';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Coins,
  Lock,
  Receipt,
  Spade,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useDashboardMoney } from '@/components/dashboard/use-dashboard-money';
import { AnimatedNumber } from '@/components/marketing/animated-number';
import { fmtTime } from '@/lib/datetime';

/**
 * Dashboard Wallet Summary widget (Phase 1.3; money source corrected in Phase 2C.17 P0-1).
 *
 * Money comes from `useDashboardMoney()`: server-authoritative for a REAL session (balance is the
 * backend `available`, never computed here) and clearly-labelled demo state for a demo session. It
 * previously read `useDemoWallet` unconditionally, so a real funded player saw demo balances here.
 * Still client-only + mounted-gated, so there is no hydration mismatch.
 */
export function WalletSummary() {
  const money = useDashboardMoney();
  const { today } = money;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const recent = money.transactions;

  if (!mounted) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold tracking-tight md:text-2xl">
          <Wallet className="h-5 w-5 text-primary" /> Wallet summary
          {money.isDemo ? (
            <span
              data-testid="wallet-summary-demo-badge"
              className="rounded-full bg-violet/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet"
            >
              Demo
            </span>
          ) : null}
        </h2>
        <Link
          href="/deposit"
          className="text-sm font-semibold text-primary transition-colors hover:underline"
        >
          Deposit →
        </Link>
      </div>

      {money.error ? (
        <div
          data-testid="wallet-summary-error"
          className="card-premium p-5 text-sm text-destructive"
          role="alert"
        >
          Could not load your wallet right now. Please retry — no figures are shown rather than
          showing a value we cannot verify.
        </div>
      ) : (
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* Balances + today */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat icon={Coins} tone="text-gold" label="Wallet" value={money.loading ? null : money.balance} big />
          <Stat icon={Lock} tone="text-violet" label={money.isReal ? 'Held' : 'Vault'} value={money.loading ? null : money.vault} big />
          <Stat icon={ArrowDownToLine} tone="text-emerald" label="Today deposits" value={money.loading ? null : today.deposit} />
          <Stat icon={ArrowUpFromLine} tone="text-destructive" label="Today withdrawals" value={money.loading ? null : today.withdraw} />
          <Stat icon={Spade} tone="text-muted-foreground" label="Today bets" value={money.loading ? null : today.bet} />
          <Stat icon={TrendingUp} tone="text-emerald" label="Today wins" value={money.loading ? null : today.win} />
        </div>

        {/* Recent transactions */}
        <div className="card-premium flex flex-col p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Receipt className="h-4 w-4 text-primary" /> Recent
            </span>
            <Link href="/transactions" className="text-xs font-semibold text-primary hover:underline">
              View all
            </Link>
          </div>
          {money.loading ? (
            <div className="flex flex-1 items-center justify-center py-6 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : recent.length === 0 ? (
            <div className="flex flex-1 items-center justify-center py-6 text-center text-sm text-muted-foreground">
              No transactions yet.
            </div>
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
                  <span
                    className={cn(
                      'shrink-0 font-mono text-sm font-bold tabular-nums',
                      t.amount > 0 ? 'text-emerald' : 'text-foreground',
                    )}
                  >
                    {t.amount > 0 ? '+' : '−'}₹{Math.abs(t.amount).toLocaleString('en-US')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      )}

      {money.todayTruncated ? (
        <p className="text-[11px] text-muted-foreground">
          Today&apos;s totals cover the most recent {100} entries — open{' '}
          <Link href="/wallet/history" className="underline">wallet history</Link> for the full record.
        </p>
      ) : null}
    </section>
  );
}

function Stat({
  icon: Icon,
  tone,
  label,
  value,
  big,
}: {
  icon: LucideIcon;
  tone: string;
  label: string;
  /** `null` = not known yet (loading / unavailable). Renders "—", never a fabricated 0. */
  value: number | null;
  big?: boolean;
}) {
  return (
    <div className="card-premium flex flex-col gap-1 p-4">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className={cn('h-3.5 w-3.5', tone)} /> {label}
      </span>
      <span
        className={cn(
          'font-mono font-extrabold tabular-nums text-foreground',
          big ? 'text-2xl' : 'text-lg',
        )}
      >
        {value === null ? '—' : <>₹<AnimatedNumber value={value} /></>}
      </span>
    </div>
  );
}
