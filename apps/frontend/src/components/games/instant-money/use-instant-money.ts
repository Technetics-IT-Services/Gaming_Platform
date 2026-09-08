'use client';

import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  buildInstantRequest,
  getInstantConfig,
  getMainWallet,
  playInstant,
  type InstantConfig,
  type InstantGame,
  type InstantResult,
  type InstantSelection,
} from '@/lib/instant-money-api';

/** Normalize an API/network error into a mobile-friendly, actionable message. */
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
 * Shared real-money instant-game hook (Phase 2C.7) for Limbo · Coin Flip · Wheel. Single-shot: the
 * outcome, multiplier, payout and balance are ALWAYS the authoritative server values (no demo wallet).
 * A fresh idempotency key per play prevents duplicate submission. The board passes its game-specific
 * selection to `play(...)`.
 */
export function useInstantMoney<C extends InstantConfig = InstantConfig>(game: InstantGame) {
  const qc = useQueryClient();
  const configQ = useQuery({ queryKey: ['instant-money', game, 'config'], queryFn: () => getInstantConfig(game), staleTime: 60_000 });
  const walletQ = useQuery({ queryKey: ['instant-money', game, 'wallet'], queryFn: getMainWallet });

  const [stake, setStake] = useState('10');
  const [lastResult, setLastResult] = useState<InstantResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const playM = useMutation({
    mutationFn: (selection: InstantSelection) => playInstant(game, buildInstantRequest(selection, stake, 'INR')),
    onSuccess: (res) => {
      setLastResult(res);
      setError(null);
      qc.setQueryData(['instant-money', game, 'wallet'], (w: { available: string; total: string; currencyId: string } | null | undefined) =>
        w ? { ...w, available: res.balance.available, total: res.balance.total } : w);
    },
    onError: (e) => setError(normalizeError(e)),
  });

  const play = useCallback((selection: InstantSelection) => { if (playM.isPending) return; setError(null); playM.mutate(selection); }, [playM]);
  const newRound = useCallback(() => { setLastResult(null); setError(null); }, []);

  return {
    config: (configQ.data ?? null) as C | null,
    balance: walletQ.data?.available ?? null,
    loading: configQ.isLoading || walletQ.isLoading,
    stake, setStake,
    play, playing: playM.isPending,
    lastResult, newRound,
    error,
  };
}
