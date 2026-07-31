'use client';

import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';

import { PokerTable } from '@/components/games/poker/PokerTable';

/** Texas Hold'em Poker lobby route (Sprint 5). Gameplay runs through the FROZEN GameRuntime. */
export default function PokerPage() {
  return (
    <div className="h-full overflow-auto">
      <header className="glass-strong sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border/40 px-4">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Dashboard
        </Link>
        <span className="text-sm font-semibold">Texas Hold&apos;em Poker</span>
      </header>
      <main className="p-4">
        <PokerTable />
      </main>
    </div>
  );
}
