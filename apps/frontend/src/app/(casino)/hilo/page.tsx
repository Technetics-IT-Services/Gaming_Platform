'use client';

import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';

import { HiLoBoard } from '@/components/games/hilo/HiLoBoard';

/** Hi-Lo lobby route (Sprint 2). Gameplay runs through the FROZEN GameRuntime. */
export default function HiLoPage() {
  return (
    <div className="h-full overflow-auto">
      <header className="glass-strong sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border/40 px-4">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Dashboard
        </Link>
        <span className="text-sm font-semibold">Hi-Lo</span>
      </header>
      <main className="p-4">
        <HiLoBoard />
      </main>
    </div>
  );
}
