'use client';

import { useCallback, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { useRealSession } from '@/hooks/use-real-session';
import { gameHistoryApi, type GameHistoryFilters } from '@/lib/game-history-api';

/** Normalize an API/network error into a mobile-friendly, actionable message. */
export function normalizeError(e: unknown): string {
  const err = e as { response?: { status?: number; data?: { message?: string } }; message?: string; code?: string };
  const status = err?.response?.status;
  const raw = err?.response?.data?.message ?? err?.message ?? 'Something went wrong';
  if (status === 401) return 'Session expired — please log in again.';
  if (status === 403) return 'You do not have access to this round.';
  if (status === 404) return 'Round not found.';
  if (err?.code === 'ECONNABORTED') return 'Network timeout — check your connection and try again.';
  return String(raw);
}

const LIMIT = 20;

/**
 * Server-authoritative game history (Phase 2C.4). Rounds + stake/payout/netResult come straight from
 * the backend; no client calculation, no demo wallet dependency. Filter by game / status / ISO date
 * range; paginate with prev/next.
 */
export function useGameHistory() {
  const [filters, setFilters] = useState<GameHistoryFilters>({});
  const [page, setPage] = useState(1);

  const realSession = useRealSession(); // demo sessions have no server-side round history

  const query = useQuery({
    queryKey: ['game-history', filters, page],
    queryFn: () => gameHistoryApi.list({ ...filters, page, limit: LIMIT }),
    placeholderData: keepPreviousData,
    enabled: realSession,
  });

  const setFilter = useCallback((patch: Partial<GameHistoryFilters>) => { setPage(1); setFilters((f) => ({ ...f, ...patch })); }, []);
  const clearFilters = useCallback(() => { setPage(1); setFilters({}); }, []);

  const items = query.data?.items ?? [];
  const pages = query.data?.pages ?? 0;

  return {
    items,
    total: query.data?.total ?? 0,
    page,
    pages,
    filters,
    setFilter,
    clearFilters,
    next: useCallback(() => setPage((p) => (p < pages ? p + 1 : p)), [pages]),
    prev: useCallback(() => setPage((p) => Math.max(1, p - 1)), []),
    loading: query.isLoading,
    fetching: query.isFetching,
    error: query.isError ? normalizeError(query.error) : null,
    isEmpty: useMemo(() => !query.isLoading && items.length === 0, [query.isLoading, items.length]),
  };
}

/** Fetch the full traceability bundle for one round (only when `roundId` is set). */
export function useRoundDetails(roundId: string | null) {
  const realSession = useRealSession();
  const query = useQuery({
    queryKey: ['round-details', roundId],
    queryFn: () => gameHistoryApi.round(roundId!),
    enabled: !!roundId && realSession,
  });
  return {
    details: query.data ?? null,
    loading: query.isLoading && !!roundId,
    error: query.isError ? normalizeError(query.error) : null,
  };
}
