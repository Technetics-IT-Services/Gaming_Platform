'use client';

import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  buildPlinkoRequest,
  getMainWallet,
  getPlinkoConfig,
  playPlinko,
  type PlinkoResult,
  type PlinkoRisk,
} from '@/lib/plinko-money-api';

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
 * Real-money Plinko hook (Phase 2C.6). Single-shot drop; the landing bin, multiplier, payout and
 * balance are ALWAYS the authoritative server values (no demo wallet). Multiplier tables come from
 * the config endpoint. A fresh idempotency key per drop prevents duplicate submission.
 */
export function usePlinkoMoney() {
  const qc = useQueryClient();
  const configQ = useQuery({ queryKey: ['plinko-money', 'config'], queryFn: getPlinkoConfig, staleTime: 60_000 });
  const walletQ = useQuery({ queryKey: ['plinko-money', 'wallet'], queryFn: getMainWallet });

  const [rows, setRows] = useState(16);
  const [risk, setRisk] = useState<PlinkoRisk>('medium');
  const [stake, setStake] = useState('10');
  const [lastResult, setLastResult] = useState<PlinkoResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const table = useMemo(() => {
    const board = configQ.data?.boards.find((b) => b.rows === rows && b.risk === risk);
    return board?.multipliers ?? [];
  }, [configQ.data, rows, risk]);

  const playM = useMutation({
    mutationFn: () => playPlinko(buildPlinkoRequest({ rows, risk, stake, currency: 'INR' })),
    onSuccess: (res) => {
      setLastResult(res);
      setError(null);
      qc.setQueryData(['plinko-money', 'wallet'], (w: { available: string; total: string; currencyId: string } | null | undefined) =>
        w ? { ...w, available: res.balance.available, total: res.balance.total } : w);
    },
    onError: (e) => setError(normalizeError(e)),
  });

  const play = useCallback(() => { if (playM.isPending) return; setError(null); playM.mutate(); }, [playM]);

  return {
    config: configQ.data ?? null,
    balance: walletQ.data?.available ?? null,
    loading: configQ.isLoading || walletQ.isLoading,
    rows, setRows,
    risk, setRisk,
    stake, setStake,
    table,
    play, playing: playM.isPending,
    lastResult,
    error,
  };
}
