'use client';

import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  buildSpinRequest,
  getMainWallet,
  getRouletteConfig,
  playRoulette,
  totalStake,
  type RouletteBet,
  type RouletteResult,
} from '@/lib/roulette-money-api';

/** Normalize an API/network error into a user-facing message (mobile-friendly, actionable). */
export function normalizeError(e: unknown): string {
  const err = e as { response?: { status?: number; data?: { message?: string } }; message?: string; code?: string };
  const status = err?.response?.status;
  const raw = err?.response?.data?.message ?? err?.message ?? 'Something went wrong';
  if (status === 401) return 'Session expired — please log in again.';
  if (status === 409) return 'Request already in progress — please wait.';
  if (err?.code === 'ECONNABORTED') return 'Network timeout — check your connection and try again.';
  if (String(raw).toLowerCase().includes('insufficient')) return 'Insufficient balance for this spin.';
  return String(raw);
}

/**
 * Real-money Roulette hook (Phase 2C.2). Bets are collected client-side then submitted as ONE
 * spin; the winning pocket, per-bet outcome, payout and wallet balance are ALWAYS the authoritative
 * server values (no demo wallet). A fresh idempotency key per spin prevents duplicate submission.
 */
export function useRouletteMoney() {
  const qc = useQueryClient();
  const configQ = useQuery({ queryKey: ['roulette-money', 'config'], queryFn: getRouletteConfig, staleTime: 60_000 });
  const walletQ = useQuery({ queryKey: ['roulette-money', 'wallet'], queryFn: getMainWallet });

  const [chip, setChip] = useState('10');
  const [bets, setBets] = useState<RouletteBet[]>([]);
  const [lastResult, setLastResult] = useState<RouletteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const total = useMemo(() => totalStake(bets), [bets]);

  const place = useCallback((type: string, selection?: number[]) => {
    setError(null);
    setBets((prev) => [...prev, { type, amount: chip, ...(selection ? { selection } : {}) }]);
  }, [chip]);
  const removeBet = useCallback((i: number) => setBets((prev) => prev.filter((_, idx) => idx !== i)), []);
  const clearBets = useCallback(() => setBets([]), []);

  const spinM = useMutation({
    mutationFn: () => playRoulette(buildSpinRequest({ variant: configQ.data?.variant ?? 'european', bets, currency: 'INR' })),
    onSuccess: (res) => {
      setLastResult(res);
      setError(null);
      setBets([]);
      qc.setQueryData(['roulette-money', 'wallet'], (w: { available: string; total: string; currencyId: string } | null | undefined) =>
        w ? { ...w, available: res.balance.available, total: res.balance.total } : w);
    },
    onError: (e) => setError(normalizeError(e)),
  });

  const spin = useCallback(() => {
    if (spinM.isPending || bets.length === 0) return; // guard rapid double-taps + empty spins
    setError(null);
    spinM.mutate();
  }, [spinM, bets.length]);

  return {
    config: configQ.data ?? null,
    balance: walletQ.data?.available ?? null,
    loading: configQ.isLoading || walletQ.isLoading,
    chip, setChip,
    bets, place, removeBet, clearBets, total,
    spin, spinning: spinM.isPending,
    lastResult,
    error,
  };
}
