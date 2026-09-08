'use client';

import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  blackjackAction,
  buildStartRequest,
  getBlackjackConfig,
  getMainWallet,
  startBlackjack,
  type BlackjackAction,
  type BlackjackHand,
} from '@/lib/blackjack-money-api';

/** Normalize an API/network error into a user-facing message (mobile-friendly, actionable). */
export function normalizeError(e: unknown): string {
  const err = e as { response?: { status?: number; data?: { message?: string } }; message?: string; code?: string };
  const status = err?.response?.status;
  const raw = err?.response?.data?.message ?? err?.message ?? 'Something went wrong';
  if (status === 401) return 'Session expired — please log in again.';
  if (status === 409) return 'Action already in progress — please wait.';
  if (status === 404) return 'Hand not found.';
  if (err?.code === 'ECONNABORTED') return 'Network timeout — check your connection and try again.';
  if (String(raw).toLowerCase().includes('insufficient')) return 'Insufficient balance for this stake.';
  return String(raw);
}

/**
 * Real-money Blackjack hook (Phase 2C.4). Interactive: start deals a hand (one reservation); HIT /
 * STAND / DOUBLE actions advance it. The cards, dealer play, result, payout and wallet balance are
 * ALWAYS the authoritative server values (no demo wallet). Actions are guarded against double-taps;
 * the server serializes them exactly-once.
 */
export function useBlackjackMoney() {
  const qc = useQueryClient();
  const configQ = useQuery({ queryKey: ['blackjack-money', 'config'], queryFn: getBlackjackConfig, staleTime: 60_000 });
  const walletQ = useQuery({ queryKey: ['blackjack-money', 'wallet'], queryFn: getMainWallet });

  const [stake, setStake] = useState('10');
  const [hand, setHand] = useState<BlackjackHand | null>(null);
  const [error, setError] = useState<string | null>(null);

  const syncBalance = useCallback((h: BlackjackHand) => {
    qc.setQueryData(['blackjack-money', 'wallet'], (w: { available: string; total: string; currencyId: string } | null | undefined) =>
      w ? { ...w, available: h.balance.available, total: h.balance.total } : w);
  }, [qc]);

  const startM = useMutation({
    mutationFn: () => startBlackjack(buildStartRequest({ stake, currency: 'INR' })),
    onSuccess: (h) => { setHand(h); setError(null); syncBalance(h); },
    onError: (e) => setError(normalizeError(e)),
  });

  const actionM = useMutation({
    mutationFn: (action: BlackjackAction) => blackjackAction(hand!.roundId, action),
    onSuccess: (h) => { setHand(h); setError(null); syncBalance(h); },
    onError: (e) => setError(normalizeError(e)),
  });

  const start = useCallback(() => { if (startM.isPending || (hand && hand.active)) return; setError(null); startM.mutate(); }, [startM, hand]);
  const act = useCallback((action: BlackjackAction) => { if (!hand?.active || actionM.isPending) return; setError(null); actionM.mutate(action); }, [hand, actionM]);
  const newHand = useCallback(() => { setHand(null); setError(null); }, []);

  return {
    config: configQ.data ?? null,
    balance: walletQ.data?.available ?? null,
    loading: configQ.isLoading || walletQ.isLoading,
    stake, setStake,
    hand,
    active: !!hand?.active,
    settled: !!hand && !hand.active,
    start, starting: startM.isPending,
    act, acting: actionM.isPending,
    newHand,
    error,
  };
}
