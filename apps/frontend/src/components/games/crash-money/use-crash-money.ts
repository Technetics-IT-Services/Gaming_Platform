'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  buildCrashPlayRequest,
  cashoutCrash,
  getCrashConfig,
  getCrashState,
  getMainWallet,
  multiplierAt,
  playCrash,
  type CrashRound,
} from '@/lib/crash-money-api';

/** Normalize an API/network error into a user-facing message (mobile-friendly, actionable). */
export function normalizeError(e: unknown): string {
  const err = e as { response?: { status?: number; data?: { message?: string } }; message?: string; code?: string };
  const status = err?.response?.status;
  const raw = err?.response?.data?.message ?? err?.message ?? 'Something went wrong';
  if (status === 401) return 'Session expired — please log in again.';
  if (status === 409) return 'Round already in progress — please wait.';
  if (status === 404) return 'No active round to cash out.';
  if (err?.code === 'ECONNABORTED') return 'Network timeout — check your connection and try again.';
  if (String(raw).toLowerCase().includes('insufficient')) return 'Insufficient balance for this stake.';
  return String(raw);
}

/**
 * Real-money Crash hook (Phase 2C.2). The rising multiplier is animated CLIENT-SIDE for display
 * only (mirrors the server curve); the crash point, payout and balance are ALWAYS taken from the
 * authoritative server response. Play reserves the stake; Cash Out settles at the server multiplier.
 */
export function useCrashMoney() {
  const qc = useQueryClient();
  const configQ = useQuery({ queryKey: ['crash-money', 'config'], queryFn: getCrashConfig, staleTime: 60_000 });
  const walletQ = useQuery({ queryKey: ['crash-money', 'wallet'], queryFn: getMainWallet });
  // Resume an already-running round after a reload (server is the source of truth).
  const stateQ = useQuery({ queryKey: ['crash-money', 'state'], queryFn: getCrashState, staleTime: 0 });

  const [stake, setStake] = useState('10');
  const [autoCashout, setAutoCashout] = useState<string>('');
  const [round, setRound] = useState<CrashRound | null>(null);
  const [lastResult, setLastResult] = useState<CrashRound | null>(null);
  const [liveMultiplier, setLiveMultiplier] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Adopt a running round discovered on mount.
  useEffect(() => {
    if (!round && stateQ.data && stateQ.data.running) setRound(stateQ.data);
  }, [stateQ.data, round]);

  // Animate the multiplier while a round is running.
  useEffect(() => {
    if (!round?.running) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
    const tick = () => setLiveMultiplier(multiplierAt(Date.now() - round.startedAtMs, round.growthRatePerSecond, configQ.data?.minMultiplier ?? 1, round.maxMultiplier || Infinity));
    tick();
    timer.current = setInterval(tick, 60);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [round, configQ.data?.minMultiplier]);

  const syncBalance = useCallback((r: CrashRound) => {
    qc.setQueryData(['crash-money', 'wallet'], (w: { available: string; total: string; currencyId: string } | null | undefined) =>
      w ? { ...w, available: r.balance.available, total: r.balance.total } : w);
  }, [qc]);

  const playM = useMutation({
    mutationFn: () => playCrash(buildCrashPlayRequest({ variant: configQ.data?.variant ?? 'crash', stake, currency: 'INR', autoCashout: autoCashout ? Number(autoCashout) : undefined })),
    onSuccess: (r) => { setLastResult(null); setRound(r); setLiveMultiplier(1); setError(null); syncBalance(r); },
    onError: (e) => setError(normalizeError(e)),
  });

  const cashoutM = useMutation({
    mutationFn: (roundId: string) => cashoutCrash(roundId),
    onSuccess: (r) => { setRound(null); setLastResult(r); setError(null); syncBalance(r); },
    onError: (e) => setError(normalizeError(e)),
  });

  const play = useCallback(() => { if (playM.isPending || cashoutM.isPending || round?.running) return; setError(null); playM.mutate(); }, [playM, cashoutM.isPending, round]);
  const cashout = useCallback(() => { if (!round?.running || cashoutM.isPending) return; setError(null); cashoutM.mutate(round.roundId); }, [round, cashoutM]);

  return {
    config: configQ.data ?? null,
    balance: walletQ.data?.available ?? null,
    loading: configQ.isLoading || walletQ.isLoading,
    stake, setStake,
    autoCashout, setAutoCashout,
    round,
    running: !!round?.running,
    liveMultiplier,
    lastResult,
    play, playing: playM.isPending,
    cashout, cashingOut: cashoutM.isPending,
    error,
  };
}
