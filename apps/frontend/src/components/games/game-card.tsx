'use client';

import { Badge, cn } from '@gaming-platform/ui';
import { motion } from 'framer-motion';
import { Coins, Play, Star, Users } from 'lucide-react';
import Link from 'next/link';
import type { GameSummary } from '@gaming-platform/types';

import { FavoriteButton } from './favorite-button';
import { GameCover } from './game-cover';

/** Deterministic "players online" so SSR and client agree (no hydration drift). */
function seededInt(seed: string, min: number, max: number): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return min + (h % (max - min));
}

export function GameCard({
  game,
  priority,
  hrefBase = '/games',
}: {
  game: GameSummary;
  priority?: boolean;
  /** Route prefix for the detail link — `/casino` keeps casino cards in-experience. */
  hrefBase?: string;
}) {
  const players = seededInt(game.id, 40, 2000);
  const jackpot = seededInt(`${game.id}j`, 5, 480) * 1000;
  const hasJackpot = seededInt(`${game.id}h`, 0, 100) > 64;

  // Subtle hover lift only (transform, GPU-cheap). No mouse-follow tilt — that
  // fired pointermove on every card (incl. during touch-scroll) and forced a
  // preserve-3d layer per card, which hurt scroll performance on mobile.
  return (
    <motion.div
      whileHover={{ y: -6 }}
      transition={{ type: 'spring', stiffness: 260, damping: 20 }}
      className="group relative"
    >
      {/* animated gradient border on hover */}
      <div className="absolute -inset-px rounded-2xl bg-gradient-to-br from-primary via-accent to-pink opacity-0 blur-[2px] transition-opacity duration-300 group-hover:opacity-70" />
      <div className="card-premium relative overflow-hidden">
        <Link href={`${hrefBase}/${game.slug}`} className="block">
          <div className="relative aspect-[3/4] w-full overflow-hidden rounded-t-[calc(var(--radius)-1px)]">
            <GameCover
              src={game.thumbnailUrl}
              name={game.name}
              seed={game.id}
              hint={`${game.category?.slug ?? ''} ${game.category?.name ?? ''}`}
              priority={priority}
              showTitle={false}
            />

            {/* badges */}
            <div className="absolute left-2 top-2 z-10 flex flex-col items-start gap-1">
              {game.isFeatured ? <Badge variant="featured">FEATURED</Badge> : null}
              {game.isNew ? <Badge variant="new">NEW</Badge> : null}
              {game.isTrending ? <Badge variant="hot">🔥 HOT</Badge> : null}
              {hasJackpot ? (
                <Badge variant="jackpot" className="gap-1">
                  <Coins className="h-3 w-3" /> ${(jackpot / 1000).toFixed(0)}K
                </Badge>
              ) : null}
              {game.maintenanceMode ? <Badge variant="destructive">Maintenance</Badge> : null}
            </div>

            {/* RTP chip */}
            {game.rtp ? (
              <div className="absolute right-2 top-2 z-10 rounded-md border border-black/10 bg-card px-1.5 py-0.5 text-[10px] font-bold text-emerald">
                {game.rtp}% RTP
              </div>
            ) : null}

            {/* hover play overlay */}
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-foreground/30 opacity-0 backdrop-blur-[2px] transition-opacity duration-200 group-hover:opacity-100">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary to-violet text-white shadow-glow transition-transform duration-200 group-hover:scale-110">
                <Play className="h-6 w-6 translate-x-0.5 fill-white" />
              </span>
            </div>

            {/* live players */}
            <div className="absolute bottom-2 left-2 z-10 flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald" />
              <Users className="h-3 w-3" />
              <span className="tabular-nums">{players.toLocaleString('en-US')}</span>
            </div>
          </div>
        </Link>

        <FavoriteButton
          gameId={game.id}
          className="absolute right-2 top-2 z-20 opacity-0 transition-opacity group-hover:opacity-100"
        />

        <div className="space-y-1 p-3">
          <Link href={`${hrefBase}/${game.slug}`}>
            <p className="truncate font-display text-sm font-semibold transition-colors group-hover:text-primary">
              {game.name}
            </p>
          </Link>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="truncate">{game.provider?.name ?? 'Original'}</span>
            <span className={cn('flex items-center gap-0.5')}>
              <Star className="h-3 w-3 fill-gold text-gold" />
              {game.ratingCount > 0 ? game.ratingAverage.toFixed(1) : (4 + (players % 10) / 10).toFixed(1)}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
