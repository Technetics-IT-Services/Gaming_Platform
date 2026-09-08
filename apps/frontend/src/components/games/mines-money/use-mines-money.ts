'use client';

import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  buildStartRequest,
  cashoutMines,
  getMainWallet,
  getMinesConfig,
  revealMine,
  startMines,
  type MinesRound,
} from '@/lib/mines-money-api';

/** Normalize an API/network error into a mobile-friendly, actionable message. */
export function normalizeError(e: unknown): string {
  const err = e as { response?: { status?: number; data?: { message?: string } }; message?: string; code?: string };
  const status = err?.response?.status;
  const raw = err?.response?.data?.message ?? err?.message ?? 'Something went wrong';
  if (status === 401) return 'Session expired — please log in again.';
  if (status === 409) return 'Action already in progress — please wait.';
  if (status === 404) return 'Round not found.';
  if (err?.code === 'ECONNABORTED') return 'Network timeout — check your connection and try again.';
  if (String(raw).toLowerCase().includes('insufficient')) return 'Insufficient balance for this stake.';
  return String(raw);
}

/**
 * Real-money Mines hook (Phase 2C.6). Interactive: start deals a hidden authoritative board; reveal
 * tiles to grow the multiplier; cash out to settle. The board, multiplier, payout and balance are
 * ALWAYS the authoritative server values (no demo wallet). Actions are guarded against double-taps;
 * the server serializes them exactly-once.
 */
export function useMinesMoney() {
  const qc = useQueryClient();
  const configQ = useQuery({ queryKey: ['mines-money', 'config'], queryFn: getMinesConfig, staleTime: 60_000 });
  const walletQ = useQuery({ queryKey: ['mines-money', 'wallet'], queryFn: getMainWallet });

  const [stake, setStake] = useState('10');
  const [mines, setMines] = useState(3);
  const [round, setRound] = useState<MinesRound | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sync = useCallback((r: MinesRound) => {
    setRound(r);
    setError(null);
    qc.setQueryData(['mines-money', 'wallet'], (w: { available: string; total: string; currencyId: string } | null | undefined) =>
      w ? { ...w, available: r.balance.available, total: r.balance.total } : w);
  }, [qc]);

  const startM = useMutation({ mutationFn: () => startMines(buildStartRequest({ stake, mines, currency: 'INR' })), onSuccess: sync, onError: (e) => setError(normalizeError(e)) });
  const revealM = useMutation({ mutationFn: (index: number) => revealMine(round!.roundId, index), onSuccess: sync, onError: (e) => setError(normalizeError(e)) });
  const cashoutM = useMutation({ mutationFn: () => cashoutMines(round!.roundId), onSuccess: sync, onError: (e) => setError(normalizeError(e)) });

  const start = useCallback(() => { if (startM.isPending || round?.active) return; setError(null); startM.mutate(); }, [startM, round]);
  const reveal = useCallback((index: number) => { if (!round?.active || revealM.isPending || round.revealed.includes(index)) return; setError(null); revealM.mutate(index); }, [round, revealM]);
  const cashout = useCallback(() => { if (!round?.active || cashoutM.isPending || round.revealed.length === 0) return; setError(null); cashoutM.mutate(); }, [round, cashoutM]);
  const newRound = useCallback(() => { setRound(null); setError(null); }, []);

  return {
    config: configQ.data ?? null,
    balance: walletQ.data?.available ?? null,
    loading: configQ.isLoading || walletQ.isLoading,
    stake, setStake,
    mines, setMines,
    round,
    active: !!round?.active,
    settled: !!round && !round.active,
    start, starting: startM.isPending,
    reveal, revealing: revealM.isPending,
    cashout, cashingOut: cashoutM.isPending,
    newRound,
    error,
  };
}
