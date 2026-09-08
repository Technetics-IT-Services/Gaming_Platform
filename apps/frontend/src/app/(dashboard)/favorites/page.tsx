'use client';

import { Button, Spinner } from '@gaming-platform/ui';
import { useQuery } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import Link from 'next/link';

import { GameGrid } from '@/components/games/game-grid';
import { GameGridSkeleton } from '@/components/games/game-card-skeleton';
import { gamesApi } from '@/lib/games-api';
import { useAuthStore } from '@/stores/auth-store';

function FavoritesHero() {
  return (
    <section className="relative mb-8 overflow-hidden rounded-3xl border border-black/10 p-8 sm:p-10">
      <div className="bg-aurora absolute inset-0 opacity-60" />
      <div className="bg-grid absolute inset-0 opacity-30" />
      <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-pink/20 blur-3xl" />
      <div className="relative space-y-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-black/5 px-3 py-1 text-xs uppercase tracking-widest text-pink backdrop-blur">
          <Heart className="h-3.5 w-3.5 fill-pink" /> Your Collection
        </div>
        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
          <span className="text-gradient">Favorites</span>
        </h1>
        <p className="max-w-xl text-muted-foreground">Your saved games.</p>
      </div>
    </section>
  );
}

export default function FavoritesPage() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isDemoSession = useAuthStore((s) => s.isDemoSession);
  const initialized = useAuthStore((s) => s.initialized);
  const favorites = useQuery({
    queryKey: ['favorites'],
    queryFn: () => gamesApi.favorites(),
    enabled: isAuthenticated && !isDemoSession,
  });

  if (initialized && !isAuthenticated) {
    return (
      <div>
        <FavoritesHero />
        <div className="card-premium flex flex-col items-center justify-center gap-4 py-20 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-pink/10 text-pink shadow-glow-pink">
            <Heart className="h-8 w-8" />
          </span>
          <p className="text-sm text-muted-foreground">Sign in to save and view your favorites.</p>
          <Button asChild variant="gradient" className="sheen">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <FavoritesHero />
      {favorites.isLoading ? (
        <GameGridSkeleton />
      ) : favorites.data && favorites.data.items.length > 0 ? (
        <GameGrid games={favorites.data.items} />
      ) : (
        <div className="card-premium flex flex-col items-center justify-center gap-3 py-20 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-pink/10 text-pink shadow-glow-pink">
            <Heart className="h-8 w-8" />
          </span>
          <p className="font-display text-lg font-semibold">No favorites yet</p>
          <p className="text-sm text-muted-foreground">
            Tap the heart on any game to save it here.
          </p>
          {favorites.isError ? <Spinner /> : null}
        </div>
      )}
    </div>
  );
}
