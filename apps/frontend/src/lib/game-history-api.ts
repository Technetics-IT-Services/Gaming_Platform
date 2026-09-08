import { apiClient, unwrap } from './api-client';

/**
 * Server-authoritative game-history + round-traceability client (Phase 2C.4). Read-only. Every
 * value comes straight from the backend (round, reservation, transactions, ledger) — nothing is
 * computed on the client and there is NO demo wallet dependency.
 */

export interface GameHistoryItem {
  roundId: string;
  gameKey: string;
  betType: string;
  stake: string;
  payout: string;
  netResult: string;
  status: string;
  createdAt: string;
  settledAt: string | null;
  reference: string;
}

export interface GameHistoryPage {
  items: GameHistoryItem[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface GameHistoryFilters {
  page?: number;
  limit?: number;
  gameKey?: string;
  status?: string;
  from?: string;
  to?: string;
}

export interface LedgerEntryView {
  id: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: string;
  balanceAfter: string | null;
  status: string;
  walletId?: string;
}

export interface RoundTransactionView {
  id: string;
  type: string;
  status: string;
  amount: string;
  fee: string;
  balanceBefore: string;
  balanceAfter: string;
  currency: string;
  reference: string;
  description: string | null;
  createdAt: string;
}

export interface RoundDetails {
  round: {
    id: string;
    gameKey: string;
    variant: string;
    betType: string;
    stake: string;
    payout: string;
    netResult: string;
    status: string;
    idempotencyKey: string;
    result: unknown;
    fairness: unknown;
    createdAt: string;
    settledAt: string | null;
    reference: string;
  };
  reservation: { id: string; amount: string; status: string; reason: string | null; createdAt: string; releasedAt: string | null } | null;
  settlement: RoundTransactionView | null;
  walletTransactions: RoundTransactionView[];
  ledger: Array<{ id: string; reference: string; status: string; postedAt: string; entries: LedgerEntryView[] }>;
}

function qs(params: GameHistoryFilters): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && q.set(k, String(v)));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const gameHistoryApi = {
  /** The caller's game rounds (paginated, filterable). */
  list: (params: GameHistoryFilters = {}) => unwrap<GameHistoryPage>(apiClient.get(`/games/history${qs(params)}`)),
  /** Full traceability for one of the caller's rounds. */
  round: (roundId: string) => unwrap<RoundDetails>(apiClient.get(`/games/history/${roundId}`)),
};
