'use client';

import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';

import { RealMoneyGuard } from '@/components/auth/real-money-guard';
import { RouletteMoneyBoard } from '@/components/games/roulette-money/RouletteMoneyBoard';

/** Real-money Roulette route (Phase 2C.2) — authenticated, wallet/ledger-backed via the money bridge. */
export default function RouletteMoneyPage() {
  return (
    <div className="h-full overflow-auto">
      <header className="glass-strong sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border/40 px-4">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Dashboard
        </Link>
        <span className="text-sm font-semibold">Roulette · Real Money</span>
      </header>
      <main className="p-4">
        <RealMoneyGuard>
          <RouletteMoneyBoard />
        </RealMoneyGuard>
      </main>
    </div>
  );
}
