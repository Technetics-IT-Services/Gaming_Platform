'use client';

import { RealMoneyGuard } from '@/components/auth/real-money-guard';
import { PageHeader } from '@/components/shared/page-header';
import { GameHistoryList } from '@/components/history/GameHistoryList';

/**
 * Game History (Phase 2C.4) — `/game-history`. Server-authoritative round history with full
 * traceability (round → reservation → transactions → ledger) on tap. No demo wallet.
 */
export default function GameHistoryPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Game History" description="Your rounds and exactly what happened to your money — straight from the ledger." />
      <RealMoneyGuard>
        <GameHistoryList />
      </RealMoneyGuard>
    </div>
  );
}
