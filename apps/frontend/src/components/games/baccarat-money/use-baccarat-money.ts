'use client';

import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  buildBaccaratRequest,
  getBaccaratConfig,
  getMainWallet,
  playBaccarat,
  totalStake,
  type BaccaratBet,
  type BaccaratResult,
} from '@/lib/baccarat-money-api';

/** Normalize an API/network error into a user-facing message (mobile-friendly, actionable). */
export function normalizeError(e: unknown): string {
  const err = e as { response?: { status?: number; data?: { message?: string } }; message?: string; code?: string };
  const status = err?.response?.status;
  const raw = err?.response?.data?.message ?? err?.message ?? 'Something went wrong';
  if (status === 401) return 'Session expired — please log in again.';
  if (status === 409) return 'Request already in progress — please wait.';
  if (err?.code === 'ECONNABORTED') return 'Network timeout — check your connection and try again.';
  if (String(raw).toLowerCase().includes('insufficient')) return 'Insufficient balance for this bet.';
  return String(raw);
}

/**
 * Real-money Baccarat hook (Phase 2C.4). Bets are collected client-side then submitted as ONE deal;
 * the cards, winning side, payout and wallet balance are ALWAYS the authoritative server values (no
 * demo wallet). A fresh idempotency key per deal prevents duplicate submission.
 */
export function useBaccaratMoney() {
  const qc = useQueryClient();
  const configQ = useQuery({ queryKey: ['baccarat-money', 'config'], queryFn: getBaccaratConfig, staleTime: 60_000 });
  const walletQ = useQuery({ queryKey: ['baccarat-money', 'wallet'], queryFn: getMainWallet });

  const [chip, setChip] = useState('10');
  const [bets, setBets] = useState<BaccaratBet[]>([]);
  const [lastResult, setLastResult] = useState<BaccaratResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const total = useMemo(() => totalStake(bets), [bets]);

  const place = useCallback((type: string) => {
    setError(null);
    setBets((prev) => {
      const idx = prev.findIndex((b) => b.type === type);
      if (idx >= 0) { const next = [...prev]; next[idx] = { type, amount: String(Number(next[idx]!.amount) + Number(chip)) }; return next; }
      return [...prev, { type, amount: chip }];
    });
  }, [chip]);
  const removeBet = useCallback((type: string) => setBets((prev) => prev.filter((b) => b.type !== type)), []);
  const clearBets = useCallback(() => setBets([]), []);

  const dealM = useMutation({
    mutationFn: () => playBaccarat(buildBaccaratRequest({ bets, currency: 'INR' })),
    onSuccess: (res) => {
      setLastResult(res);
      setError(null);
      setBets([]);
      qc.setQueryData(['baccarat-money', 'wallet'], (w: { available: string; total: string; currencyId: string } | null | undefined) =>
        w ? { ...w, available: res.balance.available, total: res.balance.total } : w);
    },
    onError: (e) => setError(normalizeError(e)),
  });

  const deal = useCallback(() => {
    if (dealM.isPending || bets.length === 0) return; // guard rapid double-taps + empty deals
    setError(null);
    dealM.mutate();
  }, [dealM, bets.length]);

  const staked = (type: string) => bets.find((b) => b.type === type)?.amount;

  return {
    config: configQ.data ?? null,
    balance: walletQ.data?.available ?? null,
    loading: configQ.isLoading || walletQ.isLoading,
    chip, setChip,
    bets, place, removeBet, clearBets, total, staked,
    deal, dealing: dealM.isPending,
    lastResult,
    error,
  };
}
