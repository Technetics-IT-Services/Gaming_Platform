'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useRealSession } from '@/hooks/use-real-session';
import { gameHistoryApi } from '@/lib/game-history-api';
import { walletApi } from '@/lib/wallet-api';
import { useAuthStore } from '@/stores/auth-store';
import { useDemoWallet } from '@/stores/demo-wallet';

/**
 * Dashboard money source (Phase 2C.17, P0-1).
 *
 * The dashboard used to read `useDemoWallet` unconditionally, so a REAL ledger-funded player saw demo
 * balances and demo transactions on the page login lands on. This hook is the single place that
 * decides where dashboard money comes from:
 *
 *   REAL session → the existing server-authoritative APIs, nothing else:
 *       balance            ← GET /wallet-engine/balances  (`available`, rendered as returned)
 *       transactions       ← GET /wallet/history          (stored balanceBefore/After)
 *       bets / rounds      ← GET /games/history           (stored stake/payout/netResult)
 *   DEMO session → the demo store, and the consumer MUST label it as demo.
 *
 * No second wallet implementation, no new endpoint, and **no client-side balance arithmetic**: the
 * balance is the server's `available` string, converted for display only. The "today" figures are a
 * presentational roll-up of SERVER-RETURNED ROWS for today (fetched with the API's own `from` filter),
 * never a derived balance — and `todayTruncated` is surfaced honestly when the server reports more
 * rows for today than were fetched.
 */

/** A normalized transaction row for the dashboard, from either source. */
export interface DashboardTxn {
  id: string;
  label: string;
  ref: string;
  /** Signed display amount. Positive = credit. */
  amount: number;
  ts: number;
}

/** A normalized bet/round row for the dashboard, from either source. */
export interface DashboardBet {
  id: string;
  game: string;
  roundId: string;
  stake: number;
  net: number;
  win: boolean;
  ts: number;
}

export interface DashboardToday {
  deposit: number;
  withdraw: number;
  bet: number;
  win: number;
  rounds: number;
  wins: number;
  wagered: number;
  net: number;
}

export interface DashboardMoney {
  /** True when the figures below are server-authoritative. */
  isReal: boolean;
  /** True when the figures below are demo-only and MUST be labelled as such. */
  isDemo: boolean;
  loading: boolean;
  /** True when a server read failed — consumers must show an honest error, never a zero. */
  error: boolean;
  /** Server `available` for the MAIN wallet (real) or the demo balance. `null` = not known yet. */
  balance: number | null;
  /** Locked/held funds for a real session; the demo vault for a demo session. */
  vault: number | null;
  today: DashboardToday;
  /** True when the server reports more rows for today than were fetched (roll-up is a lower bound). */
  todayTruncated: boolean;
  transactions: DashboardTxn[];
  bets: DashboardBet[];
}

const TODAY_LIMIT = 100;
const RECENT_LIMIT = 5;

const EMPTY_TODAY: DashboardToday = { deposit: 0, withdraw: 0, bet: 0, win: 0, rounds: 0, wins: 0, wagered: 0, net: 0 };

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

const n = (v: string | null | undefined): number => {
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Classify a server wallet-history row into the dashboard's coarse buckets. */
function bucket(type: string): 'deposit' | 'withdraw' | 'bet' | 'win' | 'other' {
  const t = type.toUpperCase();
  if (t.includes('DEPOSIT')) return 'deposit';
  if (t.includes('WITHDRAW')) return 'withdraw';
  if (t.includes('BET') || t === 'GAME_BET') return 'bet';
  if (t.includes('WIN') || t === 'GAME_WIN') return 'win';
  return 'other';
}

/** Credits are positive on the dashboard; debits negative. Derived from the row TYPE, not from a guess. */
function signedAmount(type: string, amount: string): number {
  const magnitude = Math.abs(n(amount));
  const b = bucket(type);
  if (b === 'withdraw' || b === 'bet') return -magnitude;
  if (b === 'deposit' || b === 'win') return magnitude;
  // Unknown/other types: fall back to the server's own sign.
  return n(amount);
}

export function useDashboardMoney(): DashboardMoney {
  const isReal = useRealSession();
  const isDemo = useAuthStore((s) => s.isDemoSession);
  const from = useMemo(() => startOfTodayIso(), []);

  // ---- REAL session: server-authoritative reads (disabled entirely for demo sessions).
  const balancesQ = useQuery({
    queryKey: ['dashboard', 'balances'],
    queryFn: walletApi.balances,
    enabled: isReal,
    staleTime: 10_000,
  });
  const txnRecentQ = useQuery({
    queryKey: ['dashboard', 'wallet-recent'],
    queryFn: () => walletApi.history({ limit: RECENT_LIMIT }),
    enabled: isReal,
    staleTime: 10_000,
  });
  const txnTodayQ = useQuery({
    queryKey: ['dashboard', 'wallet-today', from],
    queryFn: () => walletApi.history({ from, limit: TODAY_LIMIT }),
    enabled: isReal,
    staleTime: 10_000,
  });
  const betsRecentQ = useQuery({
    queryKey: ['dashboard', 'rounds-recent'],
    queryFn: () => gameHistoryApi.list({ limit: RECENT_LIMIT }),
    enabled: isReal,
    staleTime: 10_000,
  });
  const betsTodayQ = useQuery({
    queryKey: ['dashboard', 'rounds-today', from],
    queryFn: () => gameHistoryApi.list({ from, limit: TODAY_LIMIT }),
    enabled: isReal,
    staleTime: 10_000,
  });

  // ---- DEMO session: the local demo store (hooks must run unconditionally).
  const demoBalance = useDemoWallet((s) => s.balance);
  const demoVault = useDemoWallet((s) => s.vault);
  const demoTxns = useDemoWallet((s) => s.transactions);
  const demoBets = useDemoWallet((s) => s.bets);

  return useMemo<DashboardMoney>(() => {
    if (!isReal) {
      const t0 = new Date(from).getTime();
      const today = { ...EMPTY_TODAY };
      for (const t of demoTxns) {
        if (t.ts < t0) continue;
        if (t.type === 'deposit') today.deposit += t.amount;
        else if (t.type === 'withdraw') today.withdraw += Math.abs(t.amount);
        else if (t.type === 'bet') today.bet += Math.abs(t.amount);
        else if (t.type === 'win') today.win += t.amount;
      }
      for (const b of demoBets) {
        if (b.ts < t0) continue;
        today.rounds += 1;
        if (b.win) today.wins += 1;
        today.wagered += b.stake;
        today.net += b.net;
      }
      return {
        isReal: false,
        isDemo,
        loading: false,
        error: false,
        balance: demoBalance,
        vault: demoVault,
        today,
        todayTruncated: false,
        transactions: demoTxns.slice(0, RECENT_LIMIT).map((t) => ({
          id: t.id, label: t.label, ref: t.ref, amount: t.amount, ts: t.ts,
        })),
        bets: demoBets.slice(0, RECENT_LIMIT).map((b) => ({
          id: b.id, game: b.game, roundId: b.roundId, stake: b.stake, net: b.net, win: b.win, ts: b.ts,
        })),
      };
    }

    const loading =
      balancesQ.isLoading || txnRecentQ.isLoading || txnTodayQ.isLoading || betsRecentQ.isLoading || betsTodayQ.isLoading;
    const error =
      balancesQ.isError || txnRecentQ.isError || txnTodayQ.isError || betsRecentQ.isError || betsTodayQ.isError;

    const wallets = balancesQ.data?.wallets ?? [];
    const main = wallets.find((w) => w.type?.toUpperCase() === 'MAIN') ?? wallets[0];

    const today = { ...EMPTY_TODAY };
    for (const row of txnTodayQ.data?.items ?? []) {
      const magnitude = Math.abs(n(row.amount));
      switch (bucket(row.type)) {
        case 'deposit': today.deposit += magnitude; break;
        case 'withdraw': today.withdraw += magnitude; break;
        case 'bet': today.bet += magnitude; break;
        case 'win': today.win += magnitude; break;
        default: break;
      }
    }
    for (const round of betsTodayQ.data?.items ?? []) {
      today.rounds += 1;
      const net = n(round.netResult);
      if (net > 0) today.wins += 1;
      today.wagered += Math.abs(n(round.stake));
      today.net += net;
    }

    const txnTotal = txnTodayQ.data?.total ?? 0;
    const betTotal = betsTodayQ.data?.total ?? 0;
    const todayTruncated =
      txnTotal > (txnTodayQ.data?.items.length ?? 0) || betTotal > (betsTodayQ.data?.items.length ?? 0);

    return {
      isReal: true,
      isDemo: false,
      loading,
      error,
      // Rendered straight from the server's `available` — never computed from transactions.
      balance: main ? n(main.available) : null,
      vault: main ? n(main.locked) : null,
      today,
      todayTruncated,
      transactions: (txnRecentQ.data?.items ?? []).map((t) => ({
        id: t.id,
        label: t.description || t.type.replace(/_/g, ' ').toLowerCase(),
        ref: t.reference,
        amount: signedAmount(t.type, t.amount),
        ts: new Date(t.createdAt).getTime(),
      })),
      bets: (betsRecentQ.data?.items ?? []).map((r) => ({
        id: r.roundId,
        game: r.gameKey.replace(/[-_]/g, ' '),
        roundId: r.reference,
        stake: Math.abs(n(r.stake)),
        net: n(r.netResult),
        win: n(r.netResult) > 0,
        ts: new Date(r.createdAt).getTime(),
      })),
    };
  }, [
    isReal, isDemo, from,
    demoBalance, demoVault, demoTxns, demoBets,
    balancesQ.data, balancesQ.isLoading, balancesQ.isError,
    txnRecentQ.data, txnRecentQ.isLoading, txnRecentQ.isError,
    txnTodayQ.data, txnTodayQ.isLoading, txnTodayQ.isError,
    betsRecentQ.data, betsRecentQ.isLoading, betsRecentQ.isError,
    betsTodayQ.data, betsTodayQ.isLoading, betsTodayQ.isError,
  ]);
}
