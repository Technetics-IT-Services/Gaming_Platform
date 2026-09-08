'use client';

import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  buildPlayRequest,
  getDiceConfig,
  getMainWallet,
  playDice,
  type DicePlayResult,
} from '@/lib/dice-money-api';

/** Normalize an API/network error into a user-facing message (mobile-friendly, actionable). */
export function normalizeError(e: unknown): string {
  const err = e as { response?: { status?: number; data?: { message?: string } }; message?: string; code?: string };
  const status = err?.response?.status;
  const raw = err?.response?.data?.message ?? err?.message ?? 'Something went wrong';
  if (status === 401) return 'Session expired — please log in again.';
  if (status === 409) return 'Request already in progress — please wait.';
  if (err?.code === 'ECONNABORTED') return 'Network timeout — check your connection and try again.';
  if (String(raw).toLowerCase().includes('insufficient')) return 'Insufficient balance for this stake.';
  return String(raw);
}

/**
 * Real-money Dice hook (Phase 2B). Authoritative wallet balance comes from the server on
 * every play — never computed locally. Uses react-query for config/wallet + a guarded play
 * mutation (fresh idempotency key per play prevents duplicate submission).
 */
export function useDiceMoney() {
  const qc = useQueryClient();
  const configQ = useQuery({ queryKey: ['dice-money', 'config'], queryFn: getDiceConfig, staleTime: 60_000 });
  const walletQ = useQuery({ queryKey: ['dice-money', 'wallet'], queryFn: getMainWallet });

  const [stake, setStake] = useState('10');
  const [betType, setBetType] = useState('big');
  const [lastResult, setLastResult] = useState<DicePlayResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const playM = useMutation({
    mutationFn: () => playDice(buildPlayRequest({ variant: configQ.data?.variant ?? 'sic-bo', betType, stake, currency: 'INR' })),
    onSuccess: (res) => {
      setLastResult(res);
      setError(null);
      // Reconcile the local balance against the authoritative server response.
      qc.setQueryData(['dice-money', 'wallet'], (w: { available: string; total: string; currencyId: string } | null | undefined) =>
        w ? { ...w, available: res.balance.available, total: res.balance.total } : w,
      );
    },
    onError: (e) => setError(normalizeError(e)),
  });

  const play = useCallback(() => {
    if (playM.isPending) return; // guard rapid double-taps
    setError(null);
    playM.mutate();
  }, [playM]);

  return {
    config: configQ.data ?? null,
    balance: walletQ.data?.available ?? null,
    loading: configQ.isLoading || walletQ.isLoading,
    stake,
    setStake,
    betType,
    setBetType,
    play,
    playing: playM.isPending,
    lastResult,
    error,
    refetchWallet: walletQ.refetch,
  };
}
