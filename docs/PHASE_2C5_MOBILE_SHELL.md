# Phase 2C.5 — Mobile Application Shell

Small, targeted hardening of the authenticated mobile shell alongside the session-restoration fix. No
redesign, no new design system, no financial/game changes.

## Auth loading shell

While the session bootstraps (`status` BOOTSTRAPPING/REFRESHING), `AuthGuard` renders a lightweight,
centered shell instead of the bare full-screen spinner:

- `min-h-screen w-full … overflow-x-hidden px-6` — stable, no horizontal overflow, no layout shift.
- A spinner + "Restoring your session…" — clearly a load, not an error.
- `role="status" aria-live="polite" aria-busy` + `data-testid="auth-loading"` for a11y and testing.
- Renders **no** protected content and **no** login page, so there is no login flash on a valid
  session and no dashboard flash before auth resolves.

## Safe-area handling

The root `viewport` now sets `viewportFit: 'cover'` so `env(safe-area-inset-*)` resolves to the real
device insets (it returns 0 without it). This makes the existing safe-area padding actually apply:

- The fixed mobile bottom navigation (`bottom-nav.tsx`) already uses
  `fixed inset-x-0 bottom-0 z-40 pb-[env(safe-area-inset-bottom)] md:hidden` — now the home-bar inset
  is honoured on notched devices.
- The dashboard content region uses `max-md:pb-24`, so content never hides behind the fixed bottom
  nav.

## Bottom navigation

Unchanged, already mobile-appropriate: mobile-only (`md:hidden`), fixed, `min-h-[60px]` touch targets,
focus-visible rings, safe-area inset. Verified reachable and non-overlapping.

## Responsive container / overflow

The authenticated main uses `mx-auto w-full max-w-[1440px] … overflow-x-clip px-4 … max-md:pb-24`.
The new history/game-history/auth-loading views use fluid, capped layouts (no fixed-width ≥100 px, no
wide tables). Verified: no horizontal overflow at 375×812 / 390×844 / 412×915.

## Target viewports

375×812, 390×844, 412×915 — validated for no horizontal overflow, reachable bottom nav, a stable
loading shell (no login/empty flash), and a restored authenticated route.

## What was intentionally NOT changed

No redesign of navigation, header, or pages; no new component library; no game UI, math, settlement,
wallet or ledger changes. This phase is infrastructure (auth/session) + shell reliability only.

## Known limitations

Headless authenticated *browser* rendering can still be gated by the environment's SPA form-login
timing (documented across earlier phases); the session-restoration fix itself is verified via the
real login endpoint + cookie + `/auth/refresh` restoration path and HTTP-level evidence.
