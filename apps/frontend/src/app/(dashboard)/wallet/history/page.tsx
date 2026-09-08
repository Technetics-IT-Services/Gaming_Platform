'use client';

import { PageHeader } from '@/components/shared/page-header';
import { WalletHistoryList } from '@/components/history/WalletHistoryList';

/**
 * Wallet History (Phase 2C.4) — `/wallet/history`. Server-authoritative transaction history; every
 * value (amount, balanceBefore/After, reference) comes from the backend. No demo wallet. Additive:
 * the existing `/transactions` (demo) page is intentionally untouched.
 */
export default function WalletHistoryPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Wallet History" description="Every wallet movement — server-authoritative, double-entry ledgered." />
      <WalletHistoryList />
    </div>
  );
}
