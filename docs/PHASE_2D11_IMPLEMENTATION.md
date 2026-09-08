# Phase 2D.11 — Implementation Record

A security and hardening sprint. **No new product features were built** — by design: the Phase B
audit found no requirement that engineering could complete without client input.

---

## 1. Security fixes

Both recorded in full in `PHASE_2D11_SECURITY_FIX.md`.

| # | Defect | Severity | Surface | Change |
|---|---|---|---|---|
| 1 | `POST /wallet-engine/grant-bonus` — any player could mint withdrawable money | **CRITICAL** | **FROZEN** (authorised by the 2D.11 brief) | One route handler + one import removed |
| 2 | `setInterval(() => void this.sample(), …)` — an unhandled rejection in the monitoring sampler terminates the process | **Medium** | `operations` (not frozen) | Rejection caught, counted, logged |

Defect 2 was found *because* of this phase's regression runs and is a genuine production risk: a
momentary database blip during a 5-second monitoring sample would have taken the whole API down.

---

## 2. Demo leakage removed (Phase E)

The 2D.10 audit reported *"DEMO/FAKE REACHING PRODUCTION: PARTIALLY"* — six demo-wallet-backed
screens remained reachable from player navigation.

### What was found

| Route | Backed by | In navigation? |
|---|---|---|
| `/promotions` | demo wallet | **Yes** — dashboard nav |
| `/vault` | demo wallet | **Yes** — dashboard nav |
| `/bets` | demo wallet | **Yes** — dashboard nav |
| `/store`, `/marketplace`, `/mailbox` | demo wallet | No — direct URL only |

The demo wallet initialises to `balance: 0, vault: 0`, so **no fabricated money was ever displayed**.
The problem was a production player being offered a "Vault" that can never hold anything.

### What was done

`NavItem` gained a `demoOnly` flag; the six destinations are marked; `visibleNav(items, demoMode)`
filters them out whenever demo mode is off — which is every production build
(`NEXT_PUBLIC_DEMO_MODE=false`). Both renderers (`header.tsx`, `sidebar.tsx`) apply it.

**The pages were deliberately not deleted.** They are working demo surfaces, the filter is
display-only, and **real equivalents already ship**: `/offers` (2D.9) replaces the demo
`/promotions`; `/wallet` and `/transactions` replace `/vault` and `/bets`. Hiding them removes no
capability — a point the tests assert directly.

### Enforcement, not documentation

Five new tests in `orphaned-simulation.test.ts`:

1. Every demo-wallet-backed destination is marked `demoOnly`
2. Production navigation contains **no** `demoOnly` entry, across all four nav sets
3. Demo mode ON still shows them — proving nothing was deleted
4. The **real equivalents** (`/offers`, `/wallet`, `/transactions`, `/referral`) remain in production nav
5. Both renderers actually call `visibleNav` with `clientConfig.demoMode`

---

## 3. Backend-wide security inventory

Two machine-checked audits, both read-only, both retained as scripts:

- **Route/guard inventory** — all 481 routes classified. Result: 0 admin routes without a permission
  or role.
- **Money-route invariant audit** — all 77 money-shaped mutating routes checked for the *precise*
  property `grant-bonus` violated. Result: 0 accept a client `userId`, 0 credit the caller.

Detail and the false-positive correction in `PHASE_2D11_SECURITY_TESTS.md` §3.

---

## 4. Why no new features were built

The brief's Phase C asks for every requirement implementable *without inventing a client business
rule or an external provider*. The Phase B reconciliation found:

- **38 requirements already complete**
- **16 blocked** on a client decision or a vendor account
- **4 amber**, each waiting on a decision

Two items are technically unblocked but were **deliberately not built**, with reasons:

| Item | Why not |
|---|---|
| **Page-view / session instrumentation** (X-02's last two metrics) | The instrumentation is ~1 day of unblocked work, but session duration and bounce rate *each need their own definition* (D-06). Shipping raw event capture that feeds nothing would be half a feature — precisely what the brief's "complete vertical slices" rule forbids — and it adds a per-navigation write path days before delivery. |
| **Admin UI for expenses** (F-03) | The backend, API, authorization, validation and audit are complete and GREEN. A UI would improve usability but changes no requirement status, and the release-critical work this phase was the security fix. Listed as the first post-delivery task. |

Both are recorded in the final report as known, deliberate omissions rather than quietly skipped.

---

## 5. Files changed

```
apps/backend/src/modules/wallet-engine/wallet-engine.controller.ts          FROZEN — 1 route removed
apps/backend/src/modules/wallet-engine/grant-bonus-regression.integration.spec.ts   new, 13 tests
apps/backend/src/modules/operations/services/monitoring.service.ts          rejection now caught
apps/backend/src/modules/operations/services/operations.spec.ts             + 1 regression test
apps/frontend/src/components/shared/navigation.ts                           demoOnly + visibleNav()
apps/frontend/src/components/layout/header.tsx                              applies visibleNav
apps/frontend/src/components/layout/sidebar.tsx                             applies visibleNav
apps/frontend/src/lib/orphaned-simulation.test.ts                           + 5 enforcement tests
```

**No database schema change. No frontend product page changed. No wallet, ledger, settlement,
bridge, engine, runtime or registry logic changed.**

## 6. Test count movement

| Suite | Before | After | Added |
|---|---|---|---|
| Backend | 787 | **801** | 13 grant-bonus regression + 1 sampler |
| Frontend | 1041 | **1046** | 5 demo-nav enforcement |

Both remain **0 failed, 0 skipped**.
