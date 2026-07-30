'use client';

import { cn } from '@gaming-platform/ui';
import type { IGameSession } from '@gaming-platform/types';
import { ShieldCheck } from 'lucide-react';

import type { GameStat } from '@/stores/game-stats';

/**
 * Shared production-UI primitives for the instant games (Phase 4B). Pure
 * presentation — bet controls, history strip, a provably-fair disclosure, and a
 * stat tile — reused across every game for a consistent, responsive, accessible
 * shell. No runtime/engine/provider access.
 */

const CHIPS = [100, 500, 1000, 5000] as const;

/** Bet amount input + ½/2× + quick chips. */
export function BetAmount({
  value,
  onChange,
  disabled,
  chips = CHIPS,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  chips?: readonly number[];
}) {
  return (
    <div className="space-y-2">
      <label className="block text-xs font-semibold text-muted-foreground">
        Bet amount
        <div className="mt-1 flex items-center rounded-xl border border-black/10 bg-white/70 px-2">
          <input
            type="number"
            min={1}
            value={value}
            onChange={(e) => onChange(Math.max(1, Number(e.target.value)))}
            disabled={disabled}
            aria-label="Bet amount"
            className="h-10 w-full bg-transparent font-mono text-sm outline-none tabular-nums"
          />
          <button
            type="button"
            aria-label="Halve bet"
            onClick={() => onChange(Math.max(1, Math.floor(value / 2)))}
            disabled={disabled}
            className="px-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            ½
          </button>
          <button
            type="button"
            aria-label="Double bet"
            onClick={() => onChange(value * 2)}
            disabled={disabled}
            className="px-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            2×
          </button>
        </div>
      </label>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            disabled={disabled}
            className="rounded-lg bg-black/[0.04] px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-40"
          >
            {v.toLocaleString('en-US')}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Recent-results strip fed by the shared game-stats store. */
export function HistoryStrip({ stat, limit = 14 }: { stat: GameStat; limit?: number }) {
  return (
    <div className="card-premium p-4">
      <p className="mb-2 font-display text-sm font-bold">History</p>
      <div className="flex flex-wrap gap-1.5" aria-label="Recent rounds">
        {stat.history.length === 0 ? (
          <span className="text-xs text-muted-foreground">No rounds yet — place a bet.</span>
        ) : (
          stat.history.slice(0, limit).map((r) => (
            <span
              key={r.id}
              className={cn(
                'rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums',
                r.win ? 'bg-emerald/15 text-emerald' : 'bg-destructive/15 text-destructive',
              )}
            >
              {r.label}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

/** A single stat tile. */
export function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-black/[0.03] p-2">
      <div className="flex items-center justify-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 font-display text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}

/** Provably-fair disclosure — surfaces the round's committed server-seed hash. */
export function ProvablyFair({ session }: { session: IGameSession | null }) {
  return (
    <details className="card-premium group p-3 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 font-semibold text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald" />
        Provably fair
        <span className="ml-auto text-[10px] text-muted-foreground/70 group-open:hidden">details</span>
      </summary>
      <div className="mt-2 space-y-1 text-muted-foreground">
        <p>
          Every outcome is derived from a committed server seed + your client seed. The commit is
          published before you play.
        </p>
        <p className="break-all font-mono text-[10px]">
          hash: {session?.serverSeedHash ?? '—'}
        </p>
      </div>
    </details>
  );
}
