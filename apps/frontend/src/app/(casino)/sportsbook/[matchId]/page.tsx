'use client';

import { Badge, Button, Spinner } from '@gaming-platform/ui';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';

import { BetSlip } from '@/components/sports/bet-slip';
import { CommentaryFeed } from '@/components/sports/commentary-feed';
import { LiveScoreboard } from '@/components/sports/live-scoreboard';
import { OddsButton, TeamCrest } from '@/components/sports/match-card';
import { MatchStats } from '@/components/sports/match-stats';
import type { Match } from '@/lib/sports-api';
import { sportsApi } from '@/lib/sports-api';
import { competitionMeta, mockMatchById } from '@/lib/sports-mock';

export default function MatchDetailsPage() {
  const params = useParams<{ matchId: string }>();
  const [now] = useState(() => Date.now());
  const match = useQuery({
    queryKey: ['sb-match', params.matchId],
    queryFn: () => sportsApi.match(params.matchId),
    // Mock ids never resolve on the backend — skip the request for them.
    enabled: !params.matchId?.startsWith('mock-'),
    retry: false,
  });

  // Prefer live data; fall back to the demo match (by id) when the API has none.
  const data: Match | undefined = useMemo(
    () => match.data ?? mockMatchById(params.matchId, now),
    [match.data, params.matchId, now],
  );

  const loading = match.isLoading && !data;
  const meta = data ? competitionMeta(data.competitionKey) : undefined;
  const isLive = data?.status === 'live';

  const home = data?.participants.find((p) => p.side === 'home') ?? data?.participants[0];
  const away = data?.participants.find((p) => p.side === 'away') ?? data?.participants[1];

  return (
    <div className="relative h-full w-full min-w-0 overflow-y-auto overflow-x-hidden">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-10" />
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-black/10 glass-strong px-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/sportsbook">
            <ChevronLeft className="h-4 w-4" /> Sportsbook
          </Link>
        </Button>
        <span className="truncate px-2 font-display font-bold text-gradient">{data?.name ?? '…'}</span>
        <div className="w-20" />
      </header>

      <main className="relative mx-auto grid w-full min-w-0 max-w-6xl gap-6 px-4 py-6 max-md:max-w-none lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          {loading ? (
            <Spinner />
          ) : data ? (
            <>
              {/* Competition line */}
              {meta ? (
                <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <span aria-hidden>{meta.flag}</span> {meta.name}
                  {meta.region ? <span className="text-muted-foreground"> · {meta.region}</span> : null}
                </p>
              ) : null}

              {isLive ? (
                <LiveScoreboard match={data} home={home} away={away} />
              ) : (
                <div className="card-premium relative overflow-hidden rounded-2xl p-5">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/25 via-violet/15 to-accent/15" />
                  <div className="sheen absolute inset-0" />
                  <div className="relative">
                    <div className="flex items-center justify-end">
                      <Badge variant="secondary">{new Date(data.startTime).toLocaleString('en-US')}</Badge>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-4">
                      {home ? (
                        <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
                          <TeamCrest participant={home} />
                          <span className="truncate font-display text-sm font-bold text-foreground">{home.name}</span>
                        </div>
                      ) : null}
                      <div className="shrink-0 text-center">
                        <span className="font-display text-xl font-bold text-muted-foreground">vs</span>
                      </div>
                      {away ? (
                        <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
                          <TeamCrest participant={away} />
                          <span className="truncate font-display text-sm font-bold text-foreground">{away.name}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              )}

              {/* Live enrichment: stats + timeline/commentary */}
              {isLive ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <MatchStats match={data} home={home} away={away} />
                  <CommentaryFeed match={data} />
                </div>
              ) : null}

              {data.markets.map((market) => (
                <div key={market.id} className="card-premium rounded-2xl p-4">
                  <div className="mb-2.5 flex items-center justify-between">
                    <p className="font-display text-sm font-bold text-foreground">{market.name}</p>
                    {market.status !== 'open' ? <Badge variant="warning">{market.status}</Badge> : null}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {market.selections.map((s) => (
                      <OddsButton key={s.id} match={data} market={market} selection={s} />
                    ))}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">Match not found.</p>
          )}
        </div>

        <div className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <BetSlip />
        </div>
      </main>
    </div>
  );
}
