'use client';

import { cn } from '@gaming-platform/ui';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

/**
 * Shared rank-movement indicator: green up / red down / muted flat with the
 * magnitude of the change. Reused by the leaderboards ranked list and any
 * surface that shows rank deltas. Fixed width keeps rows aligned.
 */
export function TrendArrow({ delta, className }: { delta: number; className?: string }) {
  if (delta > 0) {
    return (
      <span
        className={cn('flex w-9 items-center gap-0.5 text-[11px] font-semibold text-emerald', className)}
        aria-label={`up ${delta}`}
      >
        <ArrowUp className="h-3.5 w-3.5" />
        {delta}
      </span>
    );
  }
  if (delta < 0) {
    return (
      <span
        className={cn('flex w-9 items-center gap-0.5 text-[11px] font-semibold text-destructive', className)}
        aria-label={`down ${Math.abs(delta)}`}
      >
        <ArrowDown className="h-3.5 w-3.5" />
        {Math.abs(delta)}
      </span>
    );
  }
  return (
    <span
      className={cn('flex w-9 items-center gap-0.5 text-[11px] font-semibold text-muted-foreground', className)}
      aria-label="no change"
    >
      <Minus className="h-3.5 w-3.5" />
    </span>
  );
}
