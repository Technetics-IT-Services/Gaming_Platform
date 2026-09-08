'use client';

import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  buildBuyRequest,
  buyTicket,
  getCurrentDraw,
  getLotteryConfig,
  getMainWallet,
  getMyTickets,
  quickPick as genQuickPick,
} from '@/lib/lottery-money-api';

/** Normalize an API/network error into a user-facing message (mobile-friendly, actionable). */
export function normalizeError(e: unknown): string {
  const err = e as { response?: { status?: number; data?: { message?: string } }; message?: string; code?: string };
  const status = err?.response?.status;
  const raw = err?.response?.data?.message ?? err?.message ?? 'Something went wrong';
  if (status === 401) return 'Session expired — please log in again.';
  if (status === 409) return 'Request already in progress — please wait.';
  if (err?.code === 'ECONNABORTED') return 'Network timeout — check your connection and try again.';
  if (String(raw).toLowerCase().includes('insufficient')) return 'Insufficient balance for this ticket.';
  return String(raw);
}

/**
 * Real-money Number-Lottery hook (Phase 2C.3). The player picks numbers (manual or quick-pick)
 * and buys a ticket into the SHARED scheduled draw; the winning numbers, prize and wallet balance
 * are ALWAYS the authoritative server values (no demo wallet). A fresh idempotency key per purchase
 * prevents duplicate submission.
 */
export function useLotteryMoney() {
  const qc = useQueryClient();
  const configQ = useQuery({ queryKey: ['lottery-money', 'config'], queryFn: getLotteryConfig, staleTime: 60_000 });
  const drawQ = useQuery({ queryKey: ['lottery-money', 'draw'], queryFn: getCurrentDraw, refetchInterval: 15_000 });
  const walletQ = useQuery({ queryKey: ['lottery-money', 'wallet'], queryFn: getMainWallet });
  const ticketsQ = useQuery({ queryKey: ['lottery-money', 'tickets'], queryFn: getMyTickets });

  const pool = configQ.data?.pool ?? 49;
  const pick = configQ.data?.pick ?? 6;

  const [picks, setPicks] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback((n: number) => {
    setError(null);
    setPicks((prev) => {
      if (prev.includes(n)) return prev.filter((x) => x !== n);
      if (prev.length >= pick) return prev; // cap at `pick`
      return [...prev, n].sort((a, b) => a - b);
    });
  }, [pick]);
  const quickPick = useCallback(() => { setError(null); setPicks(genQuickPick(pool, pick)); }, [pool, pick]);
  const clear = useCallback(() => { setError(null); setPicks([]); }, []);

  const buyM = useMutation({
    mutationFn: () => buyTicket(buildBuyRequest({ picks, currency: 'INR', drawId: drawQ.data?.drawId })),
    onSuccess: () => {
      setPicks([]);
      setError(null);
      void qc.invalidateQueries({ queryKey: ['lottery-money', 'tickets'] });
      void walletQ.refetch();
    },
    onError: (e) => setError(normalizeError(e)),
  });

  const buy = useCallback(() => {
    if (buyM.isPending || picks.length !== pick) return; // guard taps + require a full pick
    setError(null);
    buyM.mutate();
  }, [buyM, picks.length, pick]);

  return {
    config: configQ.data ?? null,
    draw: drawQ.data ?? null,
    balance: walletQ.data?.available ?? null,
    tickets: ticketsQ.data ?? [],
    loading: configQ.isLoading || walletQ.isLoading || drawQ.isLoading,
    pool, pick,
    picks, toggle, quickPick, clear,
    complete: picks.length === pick,
    buy, buying: buyM.isPending,
    error,
  };
}
