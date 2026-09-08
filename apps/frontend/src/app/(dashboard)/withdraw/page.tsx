'use client';

import { RealMoneyGuard } from '@/components/auth/real-money-guard';
import { CashierForm } from '@/components/wallet/cashier/CashierForm';

/**
 * Withdraw (Phase 2C.9) — server-authoritative cashier. Replaces the former demo-wallet page. Funds are
 * held immediately on request (via WalletEngineService) and refunded on cancel/reject. Mobile-first; no
 * demo wallet.
 */
export default function WithdrawPage() {
  return (
    <div className="py-3">
      <RealMoneyGuard>
        <CashierForm kind="withdrawal" />
      </RealMoneyGuard>
    </div>
  );
}
