'use client';

import { Badge, Button, Input, Spinner } from '@gaming-platform/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Search, Sparkles, Trophy, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { useRealSession } from '@/hooks/use-real-session';
import { aiApi, type RecGame, type SearchResult } from '@/lib/ai-api';

export default function DiscoverPage() {
  // `/ai/for-you` is user-scoped (recommendations + recently played) — real sessions only.
  const realSession = useRealSession();
  const forYou = useQuery({ queryKey: ['ai-for-you'], queryFn: aiApi.forYou, enabled: realSession });
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult | null>(null);

  const search = useMutation({
    mutationFn: () => aiApi.search(query),
    onSuccess: (data) => setResults(data),
  });

  return (
    <div className="space-y-10">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl border border-black/10 p-8 sm:p-10">
        <div className="bg-aurora absolute inset-0 opacity-60" />
        <div className="bg-grid absolute inset-0 opacity-30" />
        <div className="absolute -left-16 -top-16 h-64 w-64 rounded-full bg-violet/20 blur-3xl" />
        <div className="relative space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-black/5 px-3 py-1 text-xs uppercase tracking-widest text-accent backdrop-blur">
            <Sparkles className="h-3.5 w-3.5" /> AI Powered
          </div>
          <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
            <span className="text-gradient">Discover</span>
          </h1>
          <p className="max-w-xl text-muted-foreground">
            AI-powered recommendations and smart search.
          </p>
        </div>
      </section>

      {/* Smart search */}
      <div className="glass-strong sheen rounded-2xl p-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Sparkles className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-accent animate-glow-pulse" />
            <Input
              className="h-11 border-black/10 bg-black/5 pl-9 backdrop-blur"
              placeholder='Try "card games with high rtp" or "tournaments today"'
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && query && search.mutate()}
              aria-label="Smart search"
            />
          </div>
          <Button
            variant="gradient"
            size="lg"
            className="sheen"
            disabled={!query || search.isPending}
            onClick={() => search.mutate()}
          >
            {search.isPending ? <Spinner size={16} /> : <Search className="h-4 w-4" />}
            Search
          </Button>
        </div>
        {results ? (
          <div className="mt-4">
            <p className="mb-2 text-xs text-muted-foreground">
              Interpreted as <Badge variant="neon">{results.intent.entity}</Badge>
              {results.intent.sort ? <> · sorted by {results.intent.sort}</> : null} ·{' '}
              <span className="font-mono tabular-nums">{results.results.length}</span> result(s)
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(results.results as RecGame[]).slice(0, 12).map((r, i) => (
                <ResultRow key={i} item={r} />
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {forYou.isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      ) : forYou.data ? (
        <>
          <Shelf title="Continue playing" games={forYou.data.continuePlaying} />
          <Shelf title="Recommended for you" games={forYou.data.recommended} icon={<Sparkles className="h-5 w-5 text-accent" />} />
          <Shelf title="Trending now" games={forYou.data.trending} icon={<TrendingUp className="h-5 w-5 text-pink" />} />
          <Shelf title="Recently played" games={forYou.data.recentlyPlayed} />

          {forYou.data.tournaments.length > 0 ? (
            <section>
              <h2 className="mb-4 flex items-center gap-2 font-display text-2xl font-bold">
                <Trophy className="h-5 w-5 text-gold" /> Tournaments for you
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {forYou.data.tournaments.map((t) => (
                  <Link key={t.id} href={`/tournaments/${t.id}`}>
                    <div className="card-premium sheen flex items-center justify-between p-4 transition-all hover:-translate-y-0.5">
                      <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gold/10 text-gold shadow-glow-gold">
                          <Trophy className="h-5 w-5" />
                        </span>
                        <span className="font-display font-semibold">{t.name}</span>
                      </div>
                      <Badge variant="gold">{t.prizePool}</Badge>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Shelf({ title, games, icon }: { title: string; games: RecGame[]; icon?: React.ReactNode }) {
  if (games.length === 0) return null;
  return (
    <section>
      <h2 className="mb-4 flex items-center gap-2 font-display text-2xl font-bold">
        {icon} {title}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {games.map((g) => (
          <GameCard key={g.id} game={g} />
        ))}
      </div>
    </section>
  );
}

function GameCard({ game }: { game: RecGame }) {
  return (
    <Link href={`/games/${game.slug}`}>
      <div className="card-premium sheen h-full p-4 transition-all hover:-translate-y-0.5">
        <div className="mb-2 flex items-center justify-between">
          <Badge variant="neon">{game.category}</Badge>
          {game.isTrending ? <Badge variant="hot">🔥 hot</Badge> : null}
        </div>
        <p className="truncate font-display font-semibold transition-colors group-hover:text-accent">
          {game.name}
        </p>
        {game.rtp ? (
          <p className="font-mono text-xs tabular-nums text-emerald">RTP {game.rtp}%</p>
        ) : null}
      </div>
    </Link>
  );
}

function ResultRow({ item }: { item: RecGame }) {
  return (
    <Link href={item.slug ? `/games/${item.slug}` : '#'}>
      <div className="flex items-center justify-between rounded-xl border border-black/10 bg-black/5 p-2.5 text-sm transition-all hover:-translate-y-0.5 hover:border-accent/50 hover:bg-black/5">
        <span className="truncate">{item.name ?? JSON.stringify(item).slice(0, 30)}</span>
        {item.rtp ? (
          <span className="font-mono text-xs tabular-nums text-emerald">RTP {item.rtp}%</span>
        ) : null}
      </div>
    </Link>
  );
}
