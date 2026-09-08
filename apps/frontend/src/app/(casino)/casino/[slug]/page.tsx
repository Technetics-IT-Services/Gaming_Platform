'use client';

import { Badge, Button, cn } from '@gaming-platform/ui';
import {
  ChevronLeft,
  Coins,
  Flame,
  Gauge,
  Play,
  Spade,
  Star,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { FavoriteButton } from '@/components/games/favorite-button';
import { GameCover } from '@/components/games/game-cover';
import { GameShelf } from '@/components/games/game-shelf';
import { AnimatedNumber } from '@/components/marketing/animated-number';
import { demoGameDetail, relatedDemoGames } from '@/lib/demo-games';

/** Deterministic live-player count (stable across SSR/CSR). */
function playersFor(seed: string): number {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 240 + (h % 4200);
}

/**
 * Independent casino detail page.
 *
 * Reads ONLY the demo registry — no backend, no Games routing, no "Game not
 * found". Every casino slug resolves; Play launches into the casino play route.
 */
export default function CasinoDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const g = demoGameDetail(slug);
  const related = relatedDemoGames(slug, 12);
  const players = playersFor(g.id);

  return (
    <div className="min-h-full">
      <header className="glass-strong sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border/60 px-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/casino">
            <ChevronLeft className="h-4 w-4" /> Casino
          </Link>
        </Button>
        <span className="flex items-center gap-2 font-display font-semibold text-foreground">
          <Spade className="h-5 w-5 text-primary" /> {g.name}
        </span>
        <div className="w-20" />
      </header>

      <main className="mx-auto max-w-6xl space-y-10 px-4 py-8">
        {/* Hero */}
        <section className="relative overflow-hidden rounded-3xl border border-black/10 shadow-elevated">
          <div className="absolute inset-0">
            <div className="bg-aurora absolute inset-0 opacity-60" />
            <div className="bg-grid absolute inset-0 opacity-30" />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/40" />
          </div>

          <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[360px_1fr] lg:p-10">
            {/* Cover art */}
            <div className="group relative aspect-[3/4] overflow-hidden rounded-2xl border border-black/10 shadow-glow">
              <GameCover name={g.name} seed={g.id} hint={g.category?.slug} showTitle={false} sizes="360px" />
              <FavoriteButton gameId={g.id} className="absolute right-3 top-3 z-10" />
              <div className="absolute bottom-3 left-3 z-10 flex items-center gap-1.5 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald" />
                <Users className="h-3.5 w-3.5" />
                <AnimatedNumber value={players} live className="tabular-nums" /> playing
              </div>
            </div>

            {/* Info */}
            <div className="flex flex-col justify-center space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                {g.isNew ? <Badge variant="new">NEW</Badge> : null}
                {g.isTrending ? <Badge variant="hot">🔥 HOT</Badge> : null}
                {g.isFeatured ? <Badge variant="featured">FEATURED</Badge> : null}
                {g.category ? <Badge variant="neon">{g.category.name}</Badge> : null}
                <Badge variant="outline">{g.ageRating}</Badge>
              </div>

              <div className="space-y-2">
                <h1 className="font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
                  <span className="text-gradient-gold text-glow">{g.name}</span>
                </h1>
                {g.provider?.name ? (
                  <p className="text-sm uppercase tracking-widest text-muted-foreground">{g.provider.name}</p>
                ) : null}
              </div>

              <div className="flex items-center gap-1.5 text-sm">
                <Star className="h-4 w-4 fill-gold text-gold" />
                <span className="font-semibold tabular-nums">{g.ratingAverage.toFixed(1)}</span>
                <span className="text-muted-foreground">({g.ratingCount.toLocaleString('en-US')})</span>
              </div>

              <div className="flex flex-wrap gap-3">
                {g.rtp !== null ? <StatChip icon={Gauge} label="RTP" value={`${g.rtp}%`} tone="text-emerald" /> : null}
                {g.volatility ? <StatChip icon={Flame} label="Volatility" value={g.volatility} tone="text-pink" /> : null}
                <StatChip icon={Coins} label="Min bet" value={g.minBet} tone="text-accent" />
                <StatChip icon={Coins} label="Max bet" value={g.maxBet} tone="text-gold" />
              </div>

              {g.description ? (
                <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{g.description}</p>
              ) : null}

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button asChild variant="gold" size="xl" className="sheen shadow-glow-gold">
                  <Link href={`/casino/${slug}/play`}>
                    <Play className="h-5 w-5 fill-current" /> Play now
                  </Link>
                </Button>
                <Button asChild variant="glass" size="xl">
                  <Link href="/casino">Back to lobby</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Related casino games — stay inside the casino experience */}
        {related.length > 0 ? (
          <GameShelf
            title="More casino games"
            icon={<Spade className="h-5 w-5 text-primary" />}
            games={related}
            hrefBase="/casino"
          />
        ) : null}
      </main>
    </div>
  );
}

function StatChip({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: string; tone: string }) {
  return (
    <div className="glass flex items-center gap-2 rounded-xl px-3 py-2">
      <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg bg-black/5', tone)}>
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={cn('font-mono text-sm font-bold tabular-nums', tone)}>{value}</p>
      </div>
    </div>
  );
}
