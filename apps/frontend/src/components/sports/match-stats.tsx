'use client';

import { motion } from 'framer-motion';

import type { Match, Participant } from '@/lib/sports-api';
import { matchStats } from '@/lib/sports-mock';

/**
 * Live sport-appropriate stat panel. Renders one row per stat, with a
 * comparative bar for stats that carry a `bar` pair (e.g. possession).
 * Presentation only — reads from the deterministic mock helper.
 */
export function MatchStats({
  match,
  home,
  away,
}: {
  match: Match;
  home: Participant | undefined;
  away: Participant | undefined;
}) {
  const stats = matchStats(match);
  if (stats.length === 0) return null;

  return (
    <div className="card-premium rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-display text-sm font-bold text-foreground">Live Stats</p>
        <span className="flex items-center gap-3 text-[11px] font-semibold text-muted-foreground">
          <span className="truncate">{home?.short ?? home?.name}</span>
          <span className="text-muted-foreground">vs</span>
          <span className="truncate">{away?.short ?? away?.name}</span>
        </span>
      </div>

      <div className="space-y-3">
        {stats.map((s, i) => {
          const bar = s.bar;
          const hPct = bar ? Math.max(0, Math.min(100, bar[0])) : 50;
          const aPct = bar ? Math.max(0, Math.min(100, bar[1])) : 50;
          return (
            <div key={`${s.label}-${i}`}>
              <div className="flex items-center justify-between text-xs">
                <span className="w-10 text-left font-mono font-bold tabular-nums text-foreground">{s.home}</span>
                <span className="flex-1 text-center uppercase tracking-wide text-muted-foreground">{s.label}</span>
                <span className="w-10 text-right font-mono font-bold tabular-nums text-foreground">{s.away}</span>
              </div>
              {bar ? (
                <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-black/10">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${hPct}%` }}
                    transition={{ duration: 0.9, ease: 'easeOut', delay: i * 0.04 }}
                    className="h-full rounded-l-full bg-gradient-to-r from-primary to-accent"
                  />
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${aPct}%` }}
                    transition={{ duration: 0.9, ease: 'easeOut', delay: i * 0.04 }}
                    className="h-full rounded-r-full bg-gradient-to-r from-pink to-gold"
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
