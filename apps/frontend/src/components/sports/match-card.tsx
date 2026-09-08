'use client';

import { Badge, cn } from '@gaming-platform/ui';
import Link from 'next/link';

import type { Market, Match, Participant, Selection } from '@/lib/sports-api';
import {
  competitionMeta,
  crestColor,
  crestInitials,
  liveScore,
  matchClock,
  matchStats,
} from '@/lib/sports-mock';
import { useSlipStore } from '@/stores/sports-slip-store';

export function OddsButton({ match, market, selection }: { match: Match; market: Market; selection: Selection }) {
  const has = useSlipStore((s) => s.legs.some((l) => l.selectionId === selection.id));
  const toggle = useSlipStore((s) => s.toggle);
  const disabled = market.status !== 'open' || selection.status !== 'open';

  return (
    <button
      disabled={disabled}
      onClick={() =>
        toggle({
          matchId: match.id,
          marketId: market.id,
          selectionId: selection.id,
          odds: selection.odds,
          matchName: match.name,
          marketName: market.name,
          selectionName: selection.name,
        })
      }
      className={cn(
        'group/odds flex min-w-0 flex-1 flex-col items-center justify-center rounded-xl border px-2 py-2 transition-all duration-200 max-md:min-h-[44px]',
        disabled
          ? 'cursor-not-allowed border-black/5 bg-black/5 opacity-50'
          : has
            ? 'border-accent bg-accent/15 shadow-glow-neon'
            : 'glass hover:-translate-y-0.5 hover:border-accent/70 hover:shadow-glow-sm',
      )}
    >
      <span className="w-full truncate text-center text-[11px] text-muted-foreground">{selection.name}</span>
      <span
        className={cn(
          'font-mono text-base font-bold tabular-nums transition-colors',
          has ? 'text-accent text-glow' : 'text-foreground group-hover/odds:text-accent',
        )}
      >
        {selection.odds.toFixed(2)}
      </span>
    </button>
  );
}

const STATUS_VARIANT: Record<string, 'live' | 'secondary' | 'outline' | 'warning'> = {
  live: 'live',
  scheduled: 'secondary',
  settled: 'outline',
  paused: 'warning',
};

/** Colored circular crest with team initials — original, no external assets. */
export function TeamCrest({ participant, size = 'md' }: { participant: Participant; size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'h-7 w-7 text-[10px]' : 'h-9 w-9 text-xs';
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-display font-extrabold text-white shadow-glow-sm ring-1 ring-white/40',
        dim,
      )}
      style={{ backgroundImage: `linear-gradient(135deg, ${crestColor(participant.name)}, hsl(0 0% 0% / 0.25))` }}
      aria-hidden
    >
      {crestInitials(participant)}
    </span>
  );
}

function shortStart(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function MatchCard({ match, featured = false }: { match: Match; featured?: boolean }) {
  const mainMarket = match.markets[0];
  const isLive = match.status === 'live';
  const meta = competitionMeta(match.competitionKey);
  const score = isLive ? liveScore(match.id) : undefined;
  const clock = isLive ? matchClock(match.id) : undefined;

  const home = match.participants.find((p) => p.side === 'home') ?? match.participants[0];
  const away = match.participants.find((p) => p.side === 'away') ?? match.participants[1];

  // Compact live stat line: prefer a stat with a comparative bar (possession),
  // otherwise the first stat row. Presentation only — never affects betting.
  const stats = isLive ? matchStats(match) : [];
  const barStat = stats.find((s) => s.bar) ?? stats[0];

  return (
    <div
      className={cn(
        'card-premium group relative overflow-hidden rounded-2xl p-4 transition-all duration-300 hover:-translate-y-1 hover:shadow-glow',
        featured && 'ring-1 ring-primary/30',
      )}
    >
      {featured ? <div className="sheen pointer-events-none absolute inset-0" /> : null}
      {isLive ? (
        <span className="pointer-events-none absolute -right-10 top-4 rotate-45 bg-destructive/80 px-10 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-glow-pink">
          Live
        </span>
      ) : null}

      {/* League / country line */}
      <div className="relative mb-2 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
          <span aria-hidden>{meta.flag}</span>
          <span className="truncate">
            {meta.name}
            {meta.region ? <span className="text-muted-foreground"> · {meta.region}</span> : null}
          </span>
        </span>
        {isLive ? (
          <Badge variant="live" className="animate-glow-pulse gap-1">
            <span className="inline-block h-1.5 w-1.5 animate-ping rounded-full bg-destructive" />
            {clock ?? 'LIVE'}
          </Badge>
        ) : (
          <Badge variant={STATUS_VARIANT[match.status] ?? 'outline'}>{shortStart(match.startTime)}</Badge>
        )}
      </div>

      {/* Teams + live score */}
      <Link href={`/sportsbook/${match.id}`} className="relative block">
        <div className="space-y-1.5">
          {[home, away].map((p, i) =>
            p ? (
              <div key={p.id} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <TeamCrest participant={p} size="sm" />
                  <span className="truncate font-display text-sm font-bold text-foreground transition-colors group-hover:text-gradient">
                    {p.name}
                  </span>
                </span>
                {score ? (
                  <span className="font-mono text-lg font-extrabold tabular-nums text-foreground">
                    {i === 0 ? score[0] : score[1]}
                  </span>
                ) : null}
              </div>
            ) : null,
          )}
        </div>
      </Link>

      {/* Compact live stat line */}
      {isLive && barStat ? (
        <div className="relative mt-2.5">
          <div className="flex items-center justify-between text-[10px] font-semibold text-muted-foreground">
            <span className="font-mono tabular-nums text-foreground">{barStat.home}</span>
            <span className="uppercase tracking-wide">{barStat.label}</span>
            <span className="font-mono tabular-nums text-foreground">{barStat.away}</span>
          </div>
          {barStat.bar ? (
            <div className="mt-1 flex h-1 w-full overflow-hidden rounded-full bg-black/10">
              <span
                className="h-full rounded-l-full bg-gradient-to-r from-primary to-accent"
                style={{ width: `${Math.max(0, Math.min(100, barStat.bar[0]))}%` }}
              />
              <span
                className="h-full rounded-r-full bg-gradient-to-r from-pink to-gold"
                style={{ width: `${Math.max(0, Math.min(100, barStat.bar[1]))}%` }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {mainMarket ? (
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] uppercase tracking-wider text-accent">{mainMarket.name}</p>
          <div className="flex gap-2">
            {mainMarket.selections.slice(0, 3).map((s) => (
              <OddsButton key={s.id} match={match} market={mainMarket} selection={s} />
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">No markets open.</p>
      )}

      <Link
        href={`/sportsbook/${match.id}`}
        className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-accent transition-colors hover:text-accent/80 hover:underline max-md:min-h-[44px] max-md:py-2"
      >
        All {match.markets.length} markets →
      </Link>
    </div>
  );
}
