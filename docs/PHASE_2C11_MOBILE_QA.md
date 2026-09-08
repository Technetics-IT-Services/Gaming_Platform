# Phase 2C.11 — Mobile QA

Targets: **375×812 · 390×844 · 412×915**. **What was actually tested** is stated honestly below; a
headless browser/device-emulation E2E was **not** available in this environment.

## Method (honest)
- **Production build** (`next build`) — every route compiles; **93 static pages**, all 26 `-money` +
  account/wallet/lobby/history routes present.
- **Route reachability** — all 28 core routes exist as page files (0 missing); security = `/settings/
  security`.
- **Responsive-by-construction review** — every phase-2C.8–2C.11 surface uses a mobile-first shell:
  single column, `max-width` 460–520, fluid grids, wrap-flex chips, horizontal-scroll rails/filters
  inside their own overflow containers, `<details>` accordions, no desktop tables. Bottom nav is
  `md:hidden` with `env(safe-area-inset-bottom)`; the casino/dashboard shells add `max-md:pb-24` so
  content clears the nav. No fixed pixel widths that exceed 375px.
- **`data-testid` hooks** present across lobby, all money boards, cashier, and account screens for a
  future automated device-matrix E2E.

## Route checklist (build + reachability + layout review)

| Route | Build | No fixed-width > 375 | Notes |
|-------|:----:|:----:|------|
| /login | ✅ | ✅ | real auth + demo guest affordance (demo mode) |
| /lobby | ✅ | ✅ | sticky balance, search, chips, 2-col grid |
| /dice-money … /teen-patti-money (15) | ✅ | ✅ | `max-width:460`, sticky balance, big CTA |
| /game-history, /wallet/history | ✅ | ✅ | mobile cards |
| /wallet | ✅ | ✅ | authoritative balance |
| /deposit, /withdraw | ✅ | ✅ | CashierForm, quick chips, big CTA |
| /transactions | ✅ | ✅ | server-authoritative cards + filters |
| /profile | ✅ | ✅ | account center, ≥56px rows |
| /settings/security | ✅ | ✅ | password/2FA/sessions/devices |
| /verification | ✅ | ✅ | honest status cards |
| /responsible-gaming | ✅ | ✅ | self-monitoring + real limits |
| /support | ✅ | ✅ | FAQ accordions + contact |

## Bottom navigation
`Home · Play · History · Wallet · Profile` — `md:hidden`, safe-area inset, ~60px touch targets, active
across all `-money` routes. Content padded so nothing hides behind it.

## Accessibility (static review)
- Buttons/links have text or `aria-label` (e.g. Wallet/Profile icon links, tile buttons).
- Inputs have `aria-label`/labels (amount, stake, search); `aria-pressed` on chip toggles.
- Disabled states use `disabled` (semantic) on CTAs.
- Focus-visible ring on the bottom nav. Color choices use high-contrast (light text on dark surfaces).
- Touch targets ≥44px on chips, ≥56px on account rows, full-width primary CTAs.

## Honest limitation — **PARTIAL**
No headless browser/device-emulation run in this environment: horizontal-overflow, tap-through,
back-navigation, and login-flash were verified by **production build + responsive-by-construction review
+ route reachability + `data-testid` presence**, not by an executed browser E2E. This is reported as
PARTIAL and is the single QA gate not fully automatable here.
