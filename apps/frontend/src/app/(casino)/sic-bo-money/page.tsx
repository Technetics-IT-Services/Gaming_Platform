'use client';

import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';

import { RealMoneyGuard } from '@/components/auth/real-money-guard';
import { SicBoMoneyBoard } from '@/components/games/sic-bo-money/SicBoMoneyBoard';

/** Real-money Sic Bo route (Phase 2C.3) — authenticated, wallet/ledger-backed via the money bridge. */
export default function SicBoMoneyPage() {
  return (
    <div className="h-full overflow-auto">
      <header className="glass-strong sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border/40 px-4">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Dashboard
        </Link>
        <span className="text-sm font-semibold">Sic Bo · Real Money</span>
      </header>
      <main className="p-4">
        <RealMoneyGuard>
          <SicBoMoneyBoard />
        </RealMoneyGuard>
      </main>
    </div>
  );
}
