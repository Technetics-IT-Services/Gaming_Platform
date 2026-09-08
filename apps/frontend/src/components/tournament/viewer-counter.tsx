'use client';

import { cn } from '@gaming-platform/ui';
import { Eye } from 'lucide-react';
import { useEffect, useState } from 'react';

import { viewerCount } from '@/lib/competition';

/**
 * Reusable live-viewers indicator (spectator experience). Deterministic base
 * from the seed; drifts gently client-side to feel live, suppressed under
 * reduced motion. Renders a stable seeded number on the server, so no
 * hydration mismatch.
 */
export function ViewerCounter({
  seed,
  className,
  label = 'watching',
}: {
  seed: string;
  className?: string;
  label?: string;
}) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const reduced =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.classList.contains('reduce-motion');
    if (reduced) return;
    const id = window.setInterval(() => setPhase((p) => p + 1), 4000);
    return () => window.clearInterval(id);
  }, []);

  const count = viewerCount(seed, phase);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-xs font-semibold text-destructive ring-1 ring-inset ring-destructive/30',
        className,
      )}
    >
      <span className="relative flex h-2 w-2" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-70" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
      </span>
      <Eye className="h-3.5 w-3.5" aria-hidden />
      <span className="tabular-nums">{count.toLocaleString('en-US')}</span>
      <span className="font-normal text-destructive">{label}</span>
    </span>
  );
}
