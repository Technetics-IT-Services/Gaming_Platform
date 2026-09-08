'use client';

import { cn } from '@gaming-platform/ui';

import { RARITY_TEXT, type Rarity } from '@/lib/cosmetics';

/** Small, reusable rarity pill using the shared rarity palette. */
export function RarityBadge({ rarity, className }: { rarity: Rarity; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full bg-card px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ring-inset ring-black/5',
        RARITY_TEXT[rarity],
        className,
      )}
    >
      {rarity}
    </span>
  );
}
