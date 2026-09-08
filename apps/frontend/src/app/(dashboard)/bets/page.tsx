'use client';

import { Input, cn } from '@gaming-platform/ui';
import { Dices, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { fmtDate, fmtTime } from '@/lib/datetime';
import { type BetRecord, useDemoWallet } from '@/stores/demo-wallet';

const FILTERS: { key: string; label: string; match: (b: BetRecord) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'won', label: 'Wins', match: (b) => b.win },
  { key: 'lost', label: 'Losses', match: (b) => !b.win },
];

export default function BetHistoryPage() {
  const bets = useDemoWallet((s) => s.bets);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0]!;
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bets.filter(
      (b) =>
        active.match(b) &&
        (!q || b.game.toLowerCase().includes(q) || b.roundId.toLowerCase().includes(q)),
    );
  }, [bets, active, search]);

  return (
    <section className="mx-auto w-full max-w-[1180px] space-y-6">
      <div className="flex items-center gap-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Dices className="h-6 w-6" />
        </span>
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">
            Bet History
          </h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            Every round you have played in demo mode, with stake, multiplier and profit/loss.
          </p>
        </div>
      </div>

      {/* Filters + search */}
      <div className="glass-strong flex flex-col gap-3 rounded-2xl p-3 lg:flex-row lg:items-center">
        <div className="relative lg:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-accent" />
          <Input
            placeholder="Search by game or round ID…"
            className="h-10 border-black/10 bg-white/60 pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                'rounded-full px-3 py-1.5 text-sm font-semibold transition-colors',
                filter === f.key
                  ? 'bg-primary text-primary-foreground shadow-glow-sm'
                  : 'bg-white/60 text-muted-foreground hover:text-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Ledger */}
      <div className="card-premium overflow-hidden p-0">
        {!mounted ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-center">
            <Dices className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No bets yet — place one in the casino.</p>
          </div>
        ) : (
          <ul className="divide-y divide-black/5">
            {rows.map((b) => (
              <BetRow key={b.id} b={b} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function BetRow({ b }: { b: BetRecord }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-black/[0.015] sm:px-5">
      <span
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold uppercase',
          b.win ? 'bg-emerald/10 text-emerald' : 'bg-destructive/10 text-destructive',
        )}
      >
        {b.win ? 'W' : 'L'}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-foreground">{b.game}</p>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {b.roundId} · {fmtDate(b.ts)} · {fmtTime(b.ts)}
        </p>
      </div>
      <div className="hidden shrink-0 text-right sm:block">
        <p className="font-mono text-xs text-muted-foreground">Stake</p>
        <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
          ₹{b.stake.toLocaleString('en-US')}
        </p>
      </div>
      <div className="hidden w-16 shrink-0 text-right md:block">
        <p className="font-mono text-xs text-muted-foreground">Mult</p>
        <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
          {b.win ? `${b.multiplier.toFixed(2)}×` : '—'}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p
          className={cn(
            'font-mono text-sm font-bold tabular-nums',
            b.win ? 'text-emerald' : 'text-destructive',
          )}
        >
          {b.net >= 0 ? '+' : '−'}₹{Math.abs(b.net).toLocaleString('en-US')}
        </p>
        <p
          className={cn(
            'text-[10px] font-bold uppercase tracking-wide',
            b.win ? 'text-emerald' : 'text-destructive',
          )}
        >
          {b.status}
        </p>
      </div>
    </li>
  );
}
