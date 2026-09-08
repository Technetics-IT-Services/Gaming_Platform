'use client';

import { useCallback, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { useRealSession } from '@/hooks/use-real-session';
import { walletApi, type WalletHistoryFilters } from '@/lib/wallet-api';

/** Normalize an API/network error into a mobile-friendly, actionable message. */
export function normalizeError(e: unknown): string {
  const err = e as { response?: { status?: number; data?: { message?: string } }; message?: string; code?: string };
  const status = err?.response?.status;
  const raw = err?.response?.data?.message ?? err?.message ?? 'Something went wrong';
  if (status === 401) return 'Session expired — please log in again.';
  if (err?.code === 'ECONNABORTED') return 'Network timeout — check your connection and try again.';
  return String(raw);
}

const LIMIT = 20;

/**
 * Server-authoritative wallet transaction history (Phase 2C.4). Every value (amount, balanceBefore,
 * balanceAfter, reference) comes straight from the backend — nothing is computed here and there is
 * NO demo wallet dependency. Filter by type / currency / ISO date range; paginate with prev/next.
 */
export function useWalletHistory() {
  const [filters, setFilters] = useState<WalletHistoryFilters>({});
  const [page, setPage] = useState(1);

  const realSession = useRealSession(); // demo sessions have no server-side ledger

  const query = useQuery({
    queryKey: ['wallet-history', filters, page],
    queryFn: () => walletApi.history({ ...filters, page, limit: LIMIT }),
    placeholderData: keepPreviousData,
    enabled: realSession,
  });

  const setFilter = useCallback((patch: Partial<WalletHistoryFilters>) => {
    setPage(1);
    setFilters((f) => ({ ...f, ...patch }));
  }, []);
  const clearFilters = useCallback(() => { setPage(1); setFilters({}); }, []);

  const data = query.data;
  const items = data?.items ?? [];
  const pages = data?.pages ?? 0;

  return {
    items,
    total: data?.total ?? 0,
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
    refetch: query.refetch,
  };
}
