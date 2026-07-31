'use client';

import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';

import { PlinkoBoard } from '@/components/games/plinko/PlinkoBoard';

/**
 * Plinko lobby route (Game Expansion v2.0, Sprint 1). A thin page that mounts the
 * Plinko board; all gameplay runs through the FROZEN GameRuntime via `usePlinko`.
 */
export default function PlinkoPage() {
  return (
    <div className="h-full overflow-auto">
      <header className="glass-strong sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border/40 px-4">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Dashboard
        </Link>
        <span className="text-sm font-semibold">Plinko</span>
      </header>
      <main className="p-4">
        <PlinkoBoard />
      </main>
    </div>
  );
}
