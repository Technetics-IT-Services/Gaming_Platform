'use client';

import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';

import { RealMoneyGuard } from '@/components/auth/real-money-guard';
import { BlackjackMoneyBoard } from '@/components/games/blackjack-money/BlackjackMoneyBoard';

/** Real-money Blackjack route (Phase 2C.4) — authenticated, wallet/ledger-backed via the money bridge. */
export default function BlackjackMoneyPage() {
  return (
    <div className="h-full overflow-auto">
      <header className="glass-strong sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border/40 px-4">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Dashboard
        </Link>
        <span className="text-sm font-semibold">Blackjack · Real Money</span>
      </header>
      <main className="p-4">
        <RealMoneyGuard>
          <BlackjackMoneyBoard />
        </RealMoneyGuard>
      </main>
    </div>
  );
}
