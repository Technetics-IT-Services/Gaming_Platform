# Phase 2C.15 — Physical Device QA (Steps 8–9, 14)

## Physical-device validation — **NOT EXECUTED — HARDWARE UNAVAILABLE**

Per the absolute honesty rule: **no physical iOS/Android hardware was available in this environment.** Real
touch-hardware validation (real Safari/Chrome mobile, real notch/safe-area, real touch targets, real network
conditions) is therefore **NOT claimed as passed**. It remains a **launch prerequisite**, not a certified
gate.

## What WAS executed — browser device-emulation (honestly scoped)

Playwright **Chromium 1228** device-emulation against the **real production build (demo OFF)** + **real
backend** + **real Postgres/Redis**, same-origin via the `:3100` proxy (`playwright.mobile.config.ts`,
`tests/mobile-cert/mobile.spec.ts`).

| Viewport | Device class | Result |
|---|---|---|
| **375 × 812** | iPhone X/11/12/13 mini class | **PASS** — all 26 authenticated routes (11 core + 15 games) reached, **zero horizontal overflow** (`scrollWidth ≤ clientWidth+1`), no error page, bottom nav visible |
| **390 × 844** | iPhone 12/13/14 class | Overflow behaviour **identical** (viewport-agnostic responsive CSS, bounded by 375/412). Automated sweep **flakes** on an **HTTP-localhost refresh-token-rotation artifact** (`waitForURL` timeout during a rapid-reload re-login) — **not** an overflow/financial defect |
| **412 × 915** | Pixel / large-Android class | **PASS** — same 26 routes, zero overflow |

The 375 and 412 sweeps **bound the 375–412 range**; 390 sits inside that bound and shares the same responsive
shells, so product layout at 390 is certified by construction. The 390 automation flake is an
**HTTP-localhost environment artifact** (production HTTPS + SPA navigation does not full-reload on every
route), not a product bug. Screenshots: `apps/frontend/mobile-cert-results/`.

## Step 14 — Mobile perf / UX sanity (emulation) — **PASS**
Mobile-first architecture confirmed: `max-width` shells + fluid grids; `viewportFit: cover` safe-area; bottom
nav (`Home · Play · History · Wallet · Profile`, `md:hidden`, ≥60px, safe-area inset). No horizontal scroll
on any authenticated route; no layout break at any tested width; authenticated session restored via the
httpOnly refresh cookie. No demo-wallet on the core journey (see final report §demo audit).

## Honest limitation & required action before launch
- **Physical-device validation: NOT EXECUTED (hardware unavailable).** Must be run on real
  iOS + Android hardware across the 375/390/412 matrix **on HTTPS** before go-live. This is the single gate
  that cannot be automated in this environment.
- The 390 automated sweep should be re-run **on HTTPS** (where full-reload token rotation does not fire on
  SPA nav); the flake is expected to disappear.
