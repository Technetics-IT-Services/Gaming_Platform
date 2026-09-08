'use client';

/**
 * Explicit "these are demo funds" marker (Phase 2C.17, Phase G).
 *
 * Some legacy surfaces — the fun-play casino tables (`/dice`, `/crash`, `/roulette`) and the
 * `/promotions` reward widgets — still read the client-side demo wallet. That is allowed to remain
 * because those surfaces are isolated: they never call a real wallet endpoint and can never move real
 * money. What is NOT allowed is for demo funds to *masquerade* as real wallet state, so every one of
 * those surfaces carries this badge.
 *
 * The real-money journey (`/lobby`, `/wallet`, `/deposit`, `/withdraw`, `/transactions`,
 * `/game-history`, `/dashboard`, all `*-money` routes) has ZERO demo-wallet dependency and never
 * renders this.
 */
export function DemoFundsBadge({ className = '' }: { className?: string }) {
  return (
    <span
      data-testid="demo-funds-badge"
      title="Practice funds only — not your real balance"
      className={`inline-flex items-center gap-1 rounded-full bg-violet/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet ${className}`}
    >
      Demo funds
    </span>
  );
}
