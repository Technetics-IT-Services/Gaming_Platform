'use client';

import { Badge, Button, Spinner, cn } from '@gaming-platform/ui';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Flame, Radio, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { AnimatedNumber } from '@/components/marketing/animated-number';
import { BetSlip } from '@/components/sports/bet-slip';
import { ResponsiveMatchCard as MatchCard } from '@/components/sports/mobile-match-card';
import { SportsSelect } from '@/components/sports/sports-select';
import type { Match, SportDefinition } from '@/lib/sports-api';
import { sportsApi } from '@/lib/sports-api';
import { MOCK_SPORTS, mockMatches } from '@/lib/sports-mock';
import { useAuthStore } from '@/stores/auth-store';

type Tab = 'live' | 'upcoming' | 'mybets';

export default function SportsbookPage() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isDemoSession = useAuthStore((s) => s.isDemoSession);
  const [sport, setSport] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('upcoming');
  // Stable per-mount reference time so mock fixtures don't jitter across renders.
  const [now] = useState(() => Date.now());

  // Persist the selected sport across refreshes (client-only; presentation).
  useEffect(() => {
    const saved = window.localStorage.getItem('sb-sport');
    if (saved) setSport(saved);
  }, []);
  useEffect(() => {
    if (sport) window.localStorage.setItem('sb-sport', sport);
    else window.localStorage.removeItem('sb-sport');
  }, [sport]);

  const sports = useQuery({ queryKey: ['sb-sports'], queryFn: sportsApi.sports });
  const matches = useQuery({
    queryKey: ['sb-matches', tab, sport],
    queryFn: () =>
      tab === 'live'
        ? sportsApi.matches({ status: 'live', sportKey: sport ?? undefined })
        : sportsApi.matches({ status: 'scheduled', sportKey: sport ?? undefined }),
    enabled: tab !== 'mybets',
  });
  const myBets = useQuery({
    queryKey: ['sb-mybets'],
    queryFn: () => sportsApi.bets(),
    enabled: tab === 'mybets' && isAuthenticated && !isDemoSession,
  });

  // ---- Fallback wiring -----------------------------------------------------
  // Prefer live data; when the API returns nothing, fall back to the demo set.
  const sportList: SportDefinition[] =
    sports.data && sports.data.length > 0 ? sports.data : MOCK_SPORTS;

  const status = tab === 'live' ? 'live' : 'scheduled';
  const liveMatches: Match[] = useMemo(() => {
    if (tab === 'mybets') return [];
    const real = matches.data;
    if (real && real.length > 0) return real;
    return mockMatches({ status, sportKey: sport ?? undefined, now });
  }, [tab, matches.data, status, sport, now]);

  // For the lobby header stats / "Live Now" strip we always know what's live.
  const allLive = useMemo(() => mockMatches({ status: 'live', now }), [now]);

  // Per-sport fixture counts + live flags for the Sports dropdown (presentation).
  const allUpcoming = useMemo(() => mockMatches({ status: 'scheduled', now }), [now]);
  const fixtureCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of [...allUpcoming, ...allLive]) c[m.sportKey] = (c[m.sportKey] ?? 0) + 1;
    return c;
  }, [allUpcoming, allLive]);
  const liveSet = useMemo(() => new Set(allLive.map((m) => m.sportKey)), [allLive]);
  const totalFixtures = allUpcoming.length + allLive.length;
  const liveStripe = (matches.data && matches.data.some((m) => m.status === 'live'))
    ? matches.data.filter((m) => m.status === 'live')
    : tab === 'live'
      ? liveMatches.filter((m) => m.status === 'live')
      : allLive.filter((m) => !sport || m.sportKey === sport);

  const featured = liveMatches.slice(0, 2);
  const rest = liveMatches.slice(2);

  return (
    <div className="relative h-full w-full min-w-0 overflow-y-auto overflow-x-hidden">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-10" />
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-black/10 glass-strong px-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/">
            <ChevronLeft className="h-4 w-4" /> Dashboard
          </Link>
        </Button>
        <span className="flex items-center gap-2 font-display font-bold text-foreground">
          <Trophy className="h-5 w-5 text-gold" /> <span className="text-gradient">Sportsbook</span>
        </span>
        <div className="w-24" />
      </header>

      <main className="relative mx-auto grid w-full min-w-0 max-w-[1600px] gap-6 px-4 py-6 max-md:max-w-none max-md:gap-4 max-md:py-4 sm:px-6 lg:grid-cols-[1fr_340px] xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-5 max-md:space-y-3">
          {/* Hero banner — compact on mobile so betting starts faster */}
          <div className="card-premium relative overflow-hidden rounded-2xl p-5 max-md:p-4">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/25 via-violet/10 to-accent/15" />
            <div className="sheen pointer-events-none absolute inset-0" />
            <div className="relative flex flex-wrap items-end justify-between gap-4 max-md:gap-2">
              <div>
                <h1 className="font-display text-2xl font-extrabold text-gradient max-md:text-xl">Live Sports Betting</h1>
                <p className="mt-1 text-sm text-muted-foreground max-md:hidden">
                  Football, cricket, tennis, NBA, kabaddi, esports & more — in-play and pre-match.
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="flex items-center justify-end gap-1 text-[11px] uppercase tracking-wider text-destructive">
                    <Radio className="h-3 w-3" /> Live now
                  </p>
                  <AnimatedNumber
                    value={liveStripe.length}
                    className="font-mono text-2xl font-extrabold tabular-nums text-foreground"
                  />
                </div>
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-wider text-accent">Markets</p>
                  <AnimatedNumber
                    value={liveMatches.reduce((n, m) => n + m.markets.length, 0) || 120}
                    live
                    className="font-mono text-2xl font-extrabold tabular-nums text-gradient-gold"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Sport navigation — one premium searchable dropdown on every device
              (replaces the horizontal sport-chip bar). Sticky under the header on
              mobile so it stays reachable while scrolling the feed. */}
          <div className="flex items-center max-md:sticky max-md:top-14 max-md:z-30 max-md:-mx-4 max-md:bg-background/90 max-md:px-4 max-md:py-2 max-md:backdrop-blur">
            <SportsSelect
              sportList={sportList}
              sport={sport}
              setSport={setSport}
              counts={fixtureCounts}
              liveSet={liveSet}
              totalCount={totalFixtures}
            />
          </div>

          {/* Tabs */}
          <div className="flex gap-1 rounded-xl glass p-1">
            {(['upcoming', 'live', 'mybets'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'flex-1 rounded-lg px-3 py-2 text-sm font-semibold capitalize transition-all max-md:min-h-[44px]',
                  tab === t
                    ? 'bg-gradient-to-r from-primary to-violet text-primary-foreground shadow-glow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t === 'mybets' ? 'My Bets' : t}
              </button>
            ))}
          </div>

          {/* Content */}
          {tab === 'mybets' ? (
            !isAuthenticated ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Sign in to view your bets.</p>
            ) : myBets.isLoading ? (
              <Spinner />
            ) : myBets.data && myBets.data.length > 0 ? (
              <div className="space-y-2">
                {myBets.data.map((b) => (
                  <div key={b.betId} className="card-premium rounded-2xl p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-display text-sm font-bold capitalize text-foreground">{b.type}</span>
                      <Badge
                        variant={
                          b.status === 'won'
                            ? 'success'
                            : b.status === 'lost'
                              ? 'destructive'
                              : b.status === 'void'
                                ? 'outline'
                                : 'secondary'
                        }
                      >
                        {b.status}
                      </Badge>
                    </div>
                    <div className="space-y-0.5">
                      {b.selections.map((s) => (
                        <p key={s.selectionId} className="truncate text-xs text-muted-foreground">
                          {s.selectionName} <span className="font-mono tabular-nums text-accent">@ {s.odds.toFixed(2)}</span> · {s.matchName}
                        </p>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="font-mono tabular-nums text-muted-foreground">
                        Stake {b.stake} · odds {b.combinedOdds.toFixed(2)}
                      </span>
                      <span className="font-mono font-bold tabular-nums text-gradient-gold">
                        Return {b.potentialReturn}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">No bets yet.</p>
            )
          ) : matches.isLoading ? (
            <Spinner />
          ) : liveMatches.length > 0 ? (
            <div className="space-y-6">
              {/* Live Now strip (only shown on Upcoming tab, when live games exist) */}
              {tab === 'upcoming' && liveStripe.length > 0 ? (
                <section>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="flex items-center gap-1.5 font-display text-sm font-bold text-destructive">
                      <span className="inline-block h-2 w-2 animate-ping rounded-full bg-destructive" />
                      Live Now
                    </span>
                    <Badge variant="hot">{liveStripe.length}</Badge>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {liveStripe.slice(0, 4).map((m) => (
                      <MatchCard key={m.id} match={m} />
                    ))}
                  </div>
                </section>
              ) : null}

              {/* Featured / Popular */}
              {featured.length > 0 ? (
                <section>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="flex items-center gap-1.5 font-display text-sm font-bold text-foreground">
                      <Flame className="h-4 w-4 text-pink" /> Popular Bets
                    </span>
                    <Badge variant="featured">Featured</Badge>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {featured.map((m) => (
                      <MatchCard key={m.id} match={m} featured />
                    ))}
                  </div>
                </section>
              ) : null}

              {/* All / Upcoming */}
              <section>
                <p className="mb-2 font-display text-sm font-bold text-foreground">
                  {tab === 'live' ? 'In-Play' : 'Upcoming'}
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  {(featured.length > 0 ? rest : liveMatches).map((m) => (
                    <MatchCard key={m.id} match={m} />
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <div className="card-premium flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-accent/15 text-accent">
                <Trophy className="h-8 w-8" />
              </span>
              <div>
                <p className="font-display text-base font-bold text-foreground">No matches available</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {sport ? 'No fixtures for this sport right now.' : `No ${tab} matches right now — check back soon.`}
                </p>
              </div>
              {sport ? (
                <Button variant="gradient" size="sm" className="sheen mt-1" onClick={() => setSport(null)}>
                  View All Sports
                </Button>
              ) : null}
            </div>
          )}
        </div>

        <div className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <BetSlip />
        </div>
      </main>
    </div>
  );
}
