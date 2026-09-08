'use client';

import { useQuery } from '@tanstack/react-query';
import { Coins, Plus, Wallet } from 'lucide-react';
import Link from 'next/link';

import { useIsDemoSession } from '@/hooks/use-real-session';
import { walletApi } from '@/lib/wallet-api';
import { useAuthStore } from '@/stores/auth-store';
import { useDemoWallet } from '@/stores/demo-wallet';

/** Wallet balance chip shown in the top bar for signed-in players (Phase 1.2). */
export function BalancePill() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  // The DEMO SESSION — not the build-time demo flag — decides this: a real login in development is a
  // real session and must show the real, server-authoritative balance (Phase 2C.15).
  const isDemoSession = useIsDemoSession();
  const demoBalance = useDemoWallet((s) => s.balance);

  // In demo mode we never hit the backend wallet — show the demo balance so
  // there are never balance errors or empty states.
  const { data } = useQuery({
    queryKey: ['wallet', 'balances'],
    queryFn: () => walletApi.balances(),
    enabled: isAuthenticated && !isDemoSession,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  if (!isAuthenticated) return null;

  const primary =
    data?.wallets?.find((w) => w.type === 'main' || w.type === 'cash') ?? data?.wallets?.[0];
  const amount = isDemoSession ? demoBalance : primary ? Number(primary.available) : null;
  const formatted =
    amount === null
      ? '—'
      : amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <div
      aria-label="Wallet balance"
      className="flex items-center rounded-full border border-black/10 bg-white/70 p-1 pl-3 shadow-soft backdrop-blur"
    >
      {isDemoSession ? (
        <Coins className="mr-1.5 h-4 w-4 text-gold" />
      ) : (
        <Wallet className="mr-2 h-4 w-4 text-accent" />
      )}
      <span className="font-mono text-sm font-bold tabular-nums text-foreground">₹{formatted}</span>
      <Link
        href="/deposit"
        aria-label="Deposit"
        title="Deposit funds"
        className="ml-2 flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-gold to-warning text-gold-foreground shadow-glow-gold transition-transform hover:scale-105 active:scale-95"
      >
        <Plus className="h-4 w-4" strokeWidth={3} />
      </Link>
    </div>
  );
}
