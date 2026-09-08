'use client';

import { RealMoneyGuard } from '@/components/auth/real-money-guard';
import { CashierForm } from '@/components/wallet/cashier/CashierForm';

/**
 * Deposit (Phase 2C.9) — server-authoritative cashier. Replaces the former demo-wallet page. A deposit
 * is created PENDING and credited only when an operator completes it (no fake payment gateway).
 * Mobile-first; no demo wallet.
 */
export default function DepositPage() {
  return (
    <div className="py-3">
      <RealMoneyGuard>
        <CashierForm kind="deposit" />
      </RealMoneyGuard>
    </div>
  );
}
