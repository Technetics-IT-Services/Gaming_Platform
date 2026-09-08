'use client';

import { Badge, Button, Spinner, cn } from '@gaming-platform/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Coins,
  Flame,
  Gamepad2,
  Gauge,
  MessageSquare,
  Play,
  Star,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { FavoriteButton } from '@/components/games/favorite-button';
import {
  GameAchievements,
  GameLeaderboard,
  GameLiveBand,
  GameScreenshots,
} from '@/components/games/game-detail-extras';
import { GameShelf } from '@/components/games/game-shelf';
import { demoGameDetail, relatedDemoGames } from '@/lib/demo-games';
import { gamesApi } from '@/lib/games-api';
import type { GameDetail } from '@gaming-platform/types';
import { useAuthStore } from '@/stores/auth-store';

export default function GameDetailPage() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isDemoSession = useAuthStore((s) => s.isDemoSession);
  const [myRating, setMyRating] = useState(0);

  // retry:false so a missing backend (demo mode) falls through to the registry
  // fallback immediately — no multi-second spinner before the page renders.
  const game = useQuery({ queryKey: ['game', slug], queryFn: () => gamesApi.detail(slug), retry: false });
  const related = useQuery({ queryKey: ['game-related', slug], queryFn: () => gamesApi.related(slug), retry: false });
  const reviews = useQuery({ queryKey: ['game-reviews', slug], queryFn: () => gamesApi.reviews(slug), retry: false });

  // Demo-safe: /games/[slug] must NEVER fail. Resolve real backend data when
  // present, otherwise fall back to the deterministic registry so every card
  // opens a playable, fully-populated page (no "Game not found").
  const g: GameDetail = game.data ?? demoGameDetail(slug);
  const relatedGames =
    related.data && related.data.length > 0 ? related.data : relatedDemoGames(slug, 12);

  const rate = useMutation({
    mutationFn: (rating: number) => gamesApi.rate(g.id, rating),
    onSuccess: () => toast.success('Thanks for rating!'),
    onError: (e: { message?: string }) => toast.error(e?.message ?? 'Unable to rate'),
  });

  /** Instant play — routes to the runtime (demo-safe, no backend required). */
  const play = () => {
    // recordPlay is user-scoped: only a real server session may write play history.
    if (isAuthenticated && !isDemoSession) void gamesApi.recordPlay(g.id).catch(() => undefined);
    router.push(`/play/${slug}`);
  };

  if (game.isLoading) {
    return (
      <div className="flex h-80 items-center justify-center">
        <Spinner size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <Button asChild variant="ghost" size="sm">
        <Link href="/games">
          <ArrowLeft className="h-4 w-4" /> Back to games
        </Link>
      </Button>

      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl border border-black/10">
        {/* banner / ambient background */}
        <div className="absolute inset-0">
          {g.bannerUrl ?? g.thumbnailUrl ? (
            <Image
              src={(g.bannerUrl ?? g.thumbnailUrl) as string}
              alt=""
              fill
              sizes="100vw"
              className="object-cover opacity-30 blur-sm"
              priority
            />
          ) : null}
          <div className="absolute inset-0 bg-aurora opacity-60" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/40" />
          <div className="bg-grid absolute inset-0 opacity-30" />
        </div>

        <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[320px_1fr] lg:p-10">
          {/* artwork */}
          <div className="group relative aspect-[3/4] overflow-hidden rounded-2xl border border-black/10 bg-muted shadow-elevated">
            {g.thumbnailUrl ? (
              <Image
                src={g.thumbnailUrl}
                alt={g.name}
                fill
                sizes="320px"
                className="object-cover transition-transform duration-500 group-hover:scale-105"
                priority
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/30 via-card to-accent/20">
                <Gamepad2 className="h-16 w-16 text-muted-foreground" />
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-background/80 to-transparent" />
            <FavoriteButton gameId={g.id} className="absolute right-3 top-3 z-10" />
          </div>

          {/* info */}
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
                <span className="text-gradient">{g.name}</span>
              </h1>
              {g.provider?.name ? (
                <p className="text-sm uppercase tracking-widest text-muted-foreground">
                  {g.provider.name}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm">
              {g.ratingCount > 0 ? (
                <span className="flex items-center gap-1.5 font-mono tabular-nums">
                  <Star className="h-4 w-4 fill-gold text-gold" />
                  <span className="font-semibold">{g.ratingAverage.toFixed(1)}</span>
                  <span className="text-muted-foreground">({g.ratingCount})</span>
                </span>
              ) : (
                <span className="text-muted-foreground">No ratings yet</span>
              )}
            </div>

            {/* stat chips */}
            <div className="flex flex-wrap gap-3">
              {g.rtp !== null ? (
                <StatChip
                  icon={<Gauge className="h-4 w-4" />}
                  label="RTP"
                  value={`${g.rtp}%`}
                  tone="emerald"
                />
              ) : null}
              {g.volatility ? (
                <StatChip
                  icon={<Flame className="h-4 w-4" />}
                  label="Volatility"
                  value={g.volatility}
                  tone="pink"
                />
              ) : null}
              <StatChip
                icon={<Coins className="h-4 w-4" />}
                label="Min bet"
                value={g.minBet}
                tone="accent"
              />
              <StatChip
                icon={<Coins className="h-4 w-4" />}
                label="Max bet"
                value={g.maxBet}
                tone="gold"
              />
            </div>

            {g.description ? (
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {g.description}
              </p>
            ) : null}

            {g.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {g.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-black/10 bg-black/5 px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-accent/50 hover:text-accent"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-4 pt-2">
              <Button
                variant="gradient"
                size="xl"
                className="sheen"
                disabled={g.maintenanceMode}
                onClick={play}
              >
                <Play className="h-5 w-5 fill-current" />
                {g.maintenanceMode ? 'In maintenance' : 'Play now'}
              </Button>

              {isAuthenticated ? (
                <div
                  className="flex items-center gap-1 rounded-full border border-black/10 bg-black/5 px-3 py-2 backdrop-blur"
                  aria-label="Rate this game"
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onMouseEnter={() => setMyRating(n)}
                      onMouseLeave={() => setMyRating(0)}
                      onClick={() => rate.mutate(n)}
                      aria-label={`Rate ${n} stars`}
                    >
                      <Star
                        className={cn(
                          'h-6 w-6 transition-colors',
                          n <= myRating ? 'fill-gold text-gold' : 'text-muted-foreground',
                        )}
                      />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* Live activity band */}
      <GameLiveBand game={g} />

      {/* Screenshots gallery */}
      <GameScreenshots game={g} />

      {/* Achievements + leaderboard */}
      <div className="grid gap-8 lg:grid-cols-2">
        <GameAchievements game={g} />
        <GameLeaderboard game={g} />
      </div>

      {relatedGames.length > 0 ? (
        <GameShelf title="You might also like" games={relatedGames} />
      ) : null}

      {/* Reviews */}
      <section className="space-y-4">
        <h2 className="flex items-center gap-2 font-display text-2xl font-bold">
          <MessageSquare className="h-5 w-5 text-accent" />
          Reviews
        </h2>
        <div className="card-premium p-6">
          <div className="space-y-4">
            {reviews.isLoading ? <Spinner /> : null}
            {reviews.data?.items.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent shadow-glow-sm">
                  <MessageSquare className="h-6 w-6" />
                </span>
                <p className="text-sm text-muted-foreground">No reviews yet. Be the first!</p>
              </div>
            ) : null}
            {reviews.data?.items.map((r) => (
              <div
                key={r.id}
                className="rounded-xl border border-black/10 bg-black/5 p-4 transition-colors hover:border-accent/40"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{r.author ?? 'Player'}</span>
                  {r.rating ? (
                    <span className="flex items-center gap-0.5 font-mono text-xs tabular-nums">
                      <Star className="h-3 w-3 fill-gold text-gold" />
                      {r.rating}
                    </span>
                  ) : null}
                </div>
                {r.title ? <p className="mt-1 text-sm font-semibold">{r.title}</p> : null}
                <p className="mt-1 text-sm text-muted-foreground">{r.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function StatChip({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: 'emerald' | 'pink' | 'accent' | 'gold';
}) {
  const toneClass = {
    emerald: 'text-emerald',
    pink: 'text-pink',
    accent: 'text-accent',
    gold: 'text-gold',
  }[tone];

  return (
    <div className="glass flex items-center gap-2.5 rounded-xl px-3.5 py-2.5">
      <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg bg-black/5', toneClass)}>
        {icon}
      </span>
      <div className="leading-tight">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={cn('font-mono text-sm font-bold tabular-nums', toneClass)}>{value}</p>
      </div>
    </div>
  );
}
