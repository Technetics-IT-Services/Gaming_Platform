'use client';

import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  buildCardRequest,
  getCardConfig,
  getMainWallet,
  playCard,
  type CardResult,
  type CardVariant,
} from '@/lib/card-money-api';

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
 * Shared real-money card-game hook (Phase 2C.7) for Dragon Tiger · Andar Bahar · Teen Patti. Single
 * bet-key selection + a stake; one round places one bet. The dealt hands, winner, payout and balance
 * are ALWAYS the authoritative server values (no demo wallet). A fresh idempotency key per play
 * prevents duplicate submission.
 */
export function useCardMoney(variant: CardVariant) {
  const qc = useQueryClient();
  const configQ = useQuery({ queryKey: ['card-money', variant, 'config'], queryFn: () => getCardConfig(variant), staleTime: 60_000 });
  const walletQ = useQuery({ queryKey: ['card-money', variant, 'wallet'], queryFn: getMainWallet });

  const bets = useMemo(() => configQ.data?.bets ?? [], [configQ.data]);
  const [betKey, setBetKey] = useState<string | null>(null);
  const [stake, setStake] = useState('10');
  const [lastResult, setLastResult] = useState<CardResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Default the selected bet to the first option once config loads.
  const selectedBet = betKey ?? bets[0]?.key ?? null;

  const playM = useMutation({
    mutationFn: (key: string) => playCard(variant, buildCardRequest([{ type: key, amount: stake }], 'INR')),
    onSuccess: (res) => {
      setLastResult(res);
      setError(null);
      qc.setQueryData(['card-money', variant, 'wallet'], (w: { available: string; total: string; currencyId: string } | null | undefined) =>
        w ? { ...w, available: res.balance.available, total: res.balance.total } : w);
    },
    onError: (e) => setError(normalizeError(e)),
  });

  const play = useCallback(() => { if (playM.isPending || !selectedBet) return; setError(null); playM.mutate(selectedBet); }, [playM, selectedBet]);

  return {
    config: configQ.data ?? null,
    bets,
    balance: walletQ.data?.available ?? null,
    loading: configQ.isLoading || walletQ.isLoading,
    betKey: selectedBet, setBetKey,
    stake, setStake,
    play, playing: playM.isPending,
    lastResult,
    error,
  };
}
