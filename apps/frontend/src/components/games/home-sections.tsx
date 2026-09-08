'use client';

import { useQuery } from '@tanstack/react-query';
import { Clock, Flame, Layers, Sparkles, Star, TrendingUp } from 'lucide-react';
import Link from 'next/link';

import { useRealSession } from '@/hooks/use-real-session';
import { gamesApi } from '@/lib/games-api';
import { FeaturedCarousel } from './featured-carousel';
import { GameShelf } from './game-shelf';

export function HomeSections() {
  // User-scoped shelves need a REAL backend session; a demo session would 401 (Phase 2C.15).
  const realSession = useRealSession();

  const featured = useQuery({ queryKey: ['shelf', 'featured'], queryFn: () => gamesApi.featured() });
  const trending = useQuery({ queryKey: ['shelf', 'trending'], queryFn: () => gamesApi.trending() });
  const popular = useQuery({ queryKey: ['shelf', 'popular'], queryFn: () => gamesApi.popular() });
  const recent = useQuery({ queryKey: ['shelf', 'recent'], queryFn: () => gamesApi.recentlyAdded() });
  const categories = useQuery({ queryKey: ['categories'], queryFn: gamesApi.categories });
  const collections = useQuery({ queryKey: ['collections'], queryFn: () => gamesApi.collections() });

  const recommended = useQuery({
    queryKey: ['shelf', 'recommended'],
    queryFn: () => gamesApi.recommended(),
    enabled: realSession,
  });
  const recentlyPlayed = useQuery({
    queryKey: ['shelf', 'recently-played'],
    queryFn: () => gamesApi.recentlyPlayed(),
    enabled: realSession,
  });

  return (
    <div className="space-y-12">
      <FeaturedCarousel games={featured.data ?? []} />

      {/* Category chips */}
      {categories.data && categories.data.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {categories.data.map((c) => (
            <Link
              key={c.id}
              href={`/games?category=${c.slug}`}
              className="group inline-flex items-center gap-2 rounded-full border border-black/10 bg-card/50 px-4 py-1.5 text-sm font-medium backdrop-blur transition-all hover:border-primary/60 hover:bg-primary/10 hover:text-foreground hover:shadow-glow-sm"
            >
              {c.name}
              <span className="rounded-full bg-black/5 px-1.5 text-xs text-muted-foreground group-hover:text-accent">
                {c.gameCount}
              </span>
            </Link>
          ))}
        </div>
      ) : null}

      {realSession ? (
        <GameShelf
          title="Continue playing"
          icon={<Clock className="h-5 w-5 text-accent" />}
          games={recentlyPlayed.data}
          loading={recentlyPlayed.isLoading}
        />
      ) : null}

      <GameShelf
        title="Trending now"
        icon={<TrendingUp className="h-5 w-5 text-warning" />}
        games={trending.data}
        loading={trending.isLoading}
        viewAllHref="/games?sort=trending"
      />

      {realSession ? (
        <GameShelf
          title="Recommended for you"
          icon={<Star className="h-5 w-5 text-primary" />}
          games={recommended.data}
          loading={recommended.isLoading}
        />
      ) : null}

      <GameShelf
        title="Popular games"
        icon={<Flame className="h-5 w-5 text-destructive" />}
        games={popular.data}
        loading={popular.isLoading}
        viewAllHref="/games?sort=popular"
      />

      <GameShelf
        title="Recently added"
        icon={<Sparkles className="h-5 w-5 text-accent" />}
        games={recent.data}
        loading={recent.isLoading}
        viewAllHref="/games?sort=newest"
      />

      {/* Collections */}
      {collections.data && collections.data.length > 0 ? (
        <section className="space-y-4">
          <h2 className="flex items-center gap-2 font-display text-xl font-bold tracking-tight md:text-2xl">
            <Layers className="h-5 w-5 text-violet" />
            Collections
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {collections.data.map((col) => (
              <Link key={col.id} href={`/collections/${col.slug}`} className="group">
                <div className="card-premium sheen flex items-center justify-between p-5">
                  <div>
                    <p className="font-display font-semibold transition-colors group-hover:text-accent">
                      {col.name}
                    </p>
                    <p className="text-sm text-muted-foreground">{col.gameCount} games</p>
                  </div>
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/5 text-accent transition-transform group-hover:translate-x-1">
                    →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
