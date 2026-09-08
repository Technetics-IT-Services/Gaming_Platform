'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useRealSession } from '@/hooks/use-real-session';
import { apiClient } from '@/lib/api-client';
import { gameHistoryApi } from '@/lib/game-history-api';
import { getCatalog, type GameDefinition } from '@/lib/games/catalog';
import { featuredGames, filterGames, type LobbyFilter } from '@/lib/games/filter';

async function getMainBalance(): Promise<string | null> {
  const res = await apiClient.get('/wallet');
  const wallets = (res.data.data ?? []) as Array<{ type: string; available: string }>;
  const main = wallets.find((w) => w.type === 'MAIN') ?? wallets[0];
  return main?.available ?? null;
}

/**
 * Mobile real-money lobby hook (Phase 2C.8). Server-authoritative catalog (`GET /catalog`) + the
 * authoritative wallet balance + recents derived from the caller's authenticated game history. Search
 * and category filtering are client-side over the canonical catalog. No demo wallet.
 */
export function useLobby() {
  // The catalog is PUBLIC and stays enabled for every visitor; the balance and recents are
  // user-scoped and require a real server session (Phase 2C.15).
  const realSession = useRealSession();
  const catalogQ = useQuery({ queryKey: ['lobby', 'catalog'], queryFn: getCatalog, staleTime: 60_000 });
  const walletQ = useQuery({ queryKey: ['lobby', 'wallet'], queryFn: getMainBalance, enabled: realSession });
  const historyQ = useQuery({ queryKey: ['lobby', 'recents'], queryFn: () => gameHistoryApi.list({ limit: 20 }), staleTime: 30_000, retry: false, enabled: realSession });

  const [filter, setFilter] = useState<LobbyFilter>('all');
  const [query, setQuery] = useState('');

  const games = useMemo(() => catalogQ.data ?? [], [catalogQ.data]);
  const filtered = useMemo(() => filterGames(games, { filter, query }), [games, filter, query]);
  const featured = useMemo(() => featuredGames(games), [games]);

  const recents = useMemo<GameDefinition[]>(() => {
    const items = historyQ.data?.items ?? [];
    const byKey = new Map(games.map((g) => [g.key, g]));
    const seen = new Set<string>();
    const out: GameDefinition[] = [];
    for (const it of items) {
      const g = byKey.get(it.gameKey);
      if (g && !seen.has(g.key)) { seen.add(g.key); out.push(g); }
      if (out.length >= 6) break;
    }
    return out;
  }, [historyQ.data, games]);

  return {
    games,
    filtered,
    featured,
    recents,
    loading: catalogQ.isLoading,
    balance: walletQ.data ?? null,
    filter, setFilter,
    query, setQuery,
  };
}
