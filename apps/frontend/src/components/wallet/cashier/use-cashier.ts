'use client';

import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  buildCashierRequest,
  cancelWithdrawal,
  createDeposit,
  createWithdrawal,
  getCashierConfig,
  getMainWallet,
  listDeposits,
  listWithdrawals,
} from '@/lib/cashier-api';

/** Normalize an API/network error into a mobile-friendly, actionable message. */
export function normalizeError(e: unknown): string {
  const err = e as { response?: { status?: number; data?: { message?: string } }; message?: string; code?: string };
  const status = err?.response?.status;
  const raw = err?.response?.data?.message ?? err?.message ?? 'Something went wrong';
  if (status === 401) return 'Session expired — please log in again.';
  if (status === 409) return 'Request already in progress — please wait.';
  if (err?.code === 'ECONNABORTED') return 'Network timeout — check your connection and try again.';
  if (String(raw).toLowerCase().includes('insufficient')) return 'Insufficient balance for this amount.';
  return String(raw);
}

/**
 * Cashier hook (Phase 2C.9). Server-authoritative: after any deposit/withdraw/cancel the balance and
 * request lists are refetched from the server (never computed locally). Deposits stay PENDING (no fake
 * credit); withdrawals hold funds immediately. No demo wallet.
 */
export function useCashier(kind: 'deposit' | 'withdrawal') {
  const qc = useQueryClient();
  const configQ = useQuery({ queryKey: ['cashier', 'config'], queryFn: getCashierConfig, staleTime: 60_000 });
  const walletQ = useQuery({ queryKey: ['cashier', 'wallet'], queryFn: getMainWallet });
  const depositsQ = useQuery({ queryKey: ['cashier', 'deposits'], queryFn: () => listDeposits(20), enabled: kind === 'deposit' });
  const withdrawalsQ = useQuery({ queryKey: ['cashier', 'withdrawals'], queryFn: () => listWithdrawals(20), enabled: kind === 'withdrawal' });

  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['cashier', 'wallet'] });
    void qc.invalidateQueries({ queryKey: ['cashier', kind === 'deposit' ? 'deposits' : 'withdrawals'] });
    // Keep the shared wallet/lobby balance in sync too.
    void qc.invalidateQueries({ queryKey: ['wallet-balances'] });
    void qc.invalidateQueries({ queryKey: ['lobby', 'wallet'] });
  }, [qc, kind]);

  const depositM = useMutation({
    mutationFn: () => createDeposit(buildCashierRequest(amount)),
    onSuccess: () => { setError(null); setAmount(''); setNotice('Deposit requested — pending confirmation.'); refresh(); },
    onError: (e) => setError(normalizeError(e)),
  });
  const withdrawM = useMutation({
    mutationFn: () => createWithdrawal(buildCashierRequest(amount)),
    onSuccess: () => { setError(null); setAmount(''); setNotice('Withdrawal requested — under review. Funds are on hold.'); refresh(); },
    onError: (e) => setError(normalizeError(e)),
  });
  const cancelM = useMutation({
    mutationFn: (id: string) => cancelWithdrawal(id),
    onSuccess: () => { setError(null); setNotice('Withdrawal cancelled — funds refunded.'); refresh(); },
    onError: (e) => setError(normalizeError(e)),
  });

  const submit = useCallback(() => {
    setNotice(null);
    if (kind === 'deposit') { if (!depositM.isPending) depositM.mutate(); }
    else if (!withdrawM.isPending) withdrawM.mutate();
  }, [kind, depositM, withdrawM]);

  return {
    config: configQ.data ?? null,
    balance: walletQ.data?.available ?? null,
    deposits: depositsQ.data ?? [],
    withdrawals: withdrawalsQ.data ?? [],
    amount, setAmount,
    submit,
    submitting: depositM.isPending || withdrawM.isPending,
    cancel: (id: string) => cancelM.mutate(id),
    cancelling: cancelM.isPending,
    error, notice,
  };
}
