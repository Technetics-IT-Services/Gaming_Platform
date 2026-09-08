'use client';

import { Badge } from '@gaming-platform/ui';
import { motion } from 'framer-motion';

import type { Match, Participant } from '@/lib/sports-api';
import { liveScore, matchClock, matchProgress } from '@/lib/sports-mock';

import { TeamCrest } from './match-card';

/**
 * Animated scoreboard for a live match: big score, team crests, a pulsing LIVE
 * indicator + clock, and a thin animated match-progress bar. Presentation only.
 */
export function LiveScoreboard({
  match,
  home,
  away,
}: {
  match: Match;
  home: Participant | undefined;
  away: Participant | undefined;
}) {
  const score = liveScore(match.id);
  const clock = matchClock(match.id);
  const progress = matchProgress(match);
  const [hs, as] = score ?? [0, 0];

  return (
    <div className="card-premium relative overflow-hidden rounded-2xl p-5">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/25 via-violet/15 to-accent/15" />
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-20" />
      <div className="sheen pointer-events-none absolute inset-0" />

      <div className="relative">
        <div className="mb-4 flex items-center justify-center gap-2">
          <Badge variant="live" className="animate-glow-pulse gap-1.5">
            <span className="inline-block h-1.5 w-1.5 animate-ping rounded-full bg-destructive" />
            <span className="font-mono tabular-nums">{clock ?? 'LIVE'}</span>
          </Badge>
        </div>

        <div className="flex items-center justify-between gap-3">
          {home ? (
            <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
              <TeamCrest participant={home} />
              <span className="truncate font-display text-sm font-bold text-foreground">{home.name}</span>
            </div>
          ) : (
            <span className="flex-1" />
          )}

          <div className="shrink-0 px-2 text-center">
            {score ? (
              <div className="flex items-end justify-center gap-2 font-mono font-extrabold tabular-nums">
                <motion.span
                  key={`h-${hs}`}
                  initial={{ scale: 0.6, opacity: 0, y: -6 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 22 }}
                  className="text-4xl text-gradient sm:text-5xl"
                >
                  {hs}
                </motion.span>
                <span className="pb-1 text-2xl text-muted-foreground">:</span>
                <motion.span
                  key={`a-${as}`}
                  initial={{ scale: 0.6, opacity: 0, y: -6 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 22 }}
                  className="text-4xl text-gradient sm:text-5xl"
                >
                  {as}
                </motion.span>
              </div>
            ) : (
              <span className="font-display text-xl font-bold text-muted-foreground">vs</span>
            )}
          </div>

          {away ? (
            <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
              <TeamCrest participant={away} />
              <span className="truncate font-display text-sm font-bold text-foreground">{away.name}</span>
            </div>
          ) : (
            <span className="flex-1" />
          )}
        </div>

        {/* Animated match-progress bar */}
        <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-black/10">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${Math.round(progress * 100)}%` }}
            transition={{ duration: 1.1, ease: 'easeOut' }}
            className="h-full rounded-full bg-gradient-to-r from-primary via-accent to-pink shadow-glow-sm"
          />
        </div>
        <p className="mt-1.5 text-center text-[10px] uppercase tracking-wider text-muted-foreground">
          Match progress · {Math.round(progress * 100)}%
        </p>
      </div>
    </div>
  );
}
