# Phase 2D.11 — Final Delivery Report

**2026-09-07 · Delivery target 2026-09-10 · No commits made**

---

## 1. Executive summary

The critical security vulnerability that blocked delivery is **closed, re-probed and guarded by
tests that are proven to detect it**. A second, previously unknown defect — one that could crash the
entire backend on a momentary database blip — was found during this phase's regression runs and
fixed. Demo screens no longer appear anywhere in production navigation.

The platform now stands at **38 of 58 requirements complete and verified**, with **zero** requiring
engineering that could proceed without client input. Every remaining item waits on a business
decision or a vendor account.

**Verdict: CONDITIONAL GO.** The blocker that forced NO-GO yesterday is gone.

## 2. Starting state

`GREEN 38 · AMBER 4 · RED 0 · BLOCKED 16` of 58, with one CRITICAL open vulnerability, backend 787
tests, frontend 1041.

## 3. The security defect

`POST /wallet-engine/grant-bonus` carried no permission guard and bound the recipient to the caller,
with a client-supplied amount and wagering requirement. A `user`-role account created **₹1,000,000**
of withdrawable balance in two HTTP calls.

Reconciliation never caught it because the credit was a *correct* double-entry posting. **The ledger
was never wrong — the authorization was.** `PermissionsGuard` only acts where `@RequirePermissions`
exists; `AdminTwoFactorGuard` is scoped to `/admin/`; no frontend called the route, so no UI test
exercised it.

## 4. The exact fix

**Option A — remove the route.** Chosen after confirming the RBAC semantics were *not* ambiguous:
`wallets:adjust` is the platform's established permission for granting promotional credit, already
exercised by `POST /admin/bonuses` (guarded, idempotent, audited, grants to a **named** player).
Guarding the frozen route in place would have required changing its shape and would have duplicated
that endpoint — a second source of truth. A repository-wide search found **zero callers**.

Scope: **one file, one route handler, one import name.** No service, engine, ledger, settlement,
bridge, runtime, registry or schema change. Full record: `PHASE_2D11_SECURITY_FIX.md`.

**Second fix:** `setInterval(() => void this.sample(), …)` in the monitoring service discarded the
promise, so an unhandled rejection terminated the process. Now caught, counted and logged.

## 5. Requirement changes

**None.** 2D.11 was a security and hardening sprint. That is the honest result: the fix did not add
requirements, it made the existing 38 **safe to operate**, which they were not before.

`GREEN 38 · AMBER 4 · RED 0 · BLOCKED 16 = 58` ✓ — recomputed from IDs in
`PHASE_2D11_FINAL_REQUIREMENT_MATRIX.md`.

## 6. Client decisions required (8)

| ID | Decision | Unblocks | Effort after |
|---|---|---|---|
| **D-01** | **Revenue definition** | F-02, F-04, PA-03, PA-04, PA-06, PA-10 — **six** | ~1 day |
| **D-02** | **Large-withdrawal threshold** | AD-06 | **< 1 hour** |
| D-03 | VIP tiers + qualifying metric | P-15, P-16 | ~1 day |
| D-04 | Referral qualification + reward + leaderboard criterion | P-17, P-18 | ~half a day |
| D-05 | Reward amounts (daily/weekly/monthly/seasonal) | P-14, P-16 | ~1 day |
| D-06 | Retention cohort + promotion award rule | X-02, AD-08 award | ~1–2 days |
| D-07 | Financial close semantics | F-05 | ~2–3 days |
| D-08 | Gift-code redemption destination | P-13 | S |

Full multiple-choice sheet: `CLIENT_DECISION_QUESTIONNAIRE.md`.

## 7. External dependencies (6)

| Service | State | Without it |
|---|---|---|
| **SMTP** | **Code complete**, log-only until credentials | ⚠️ **No password-reset or verification email** |
| **Payment gateway** | No provider selected | ⚠️ Every deposit needs manual staff confirmation |
| **Object storage** | No abstraction | KYC review works; document images live outside the platform |
| SMS / push | No provider | In-app notifications only (complete) |
| FX feed | `exchange_rates` empty | Only INR in use — low impact |
| Banking | No partner | Manual payouts |

Detail: `EXTERNAL_DEPENDENCY_MATRIX.md`. **No fake provider exists anywhere in this codebase.**

## 8. Tests

| Suite | Result |
|---|---|
| Backend | **801 passed / 0 failed / 0 skipped** (63 suites) |
| Frontend | **1046 passed / 0 failed / 0 skipped** (75 files) |
| New this phase | 13 grant-bonus regression + 1 sampler + 5 demo-nav enforcement |

Two flakes reproduced, measured and **left unmodified** — a statistical blackjack assertion (4/4 in
isolation) and a shared-database recovery-contention assertion (3/3 in isolation). Money assertions
pass in both, in every run. Details in `PHASE_2D11_FINAL_RELEASE_AUDIT.md` §2.

## 9. Security results

**172 live probes, 0 failures.** The original exploit script now returns **404 at the first call**.

The regression test was **proven non-vacuous**: with the vulnerable route temporarily reinstated,
exactly 3 assertions turned red; with it removed, 13/13 pass.

**Backend-wide inventory — the brief said not to stop at the known defect:**

```
481 routes:  214 permission/role-guarded · 72 public · 195 authenticated-only
Admin routes with no permission or role ............ 0
Money routes accepting a client-supplied userId .... 0
Money routes that credit the caller ................ 0
```

The `grant-bonus` shape was unique, and it is gone. Full detail: `PHASE_2D11_SECURITY_TESTS.md`.

## 10. Financial integrity

`SUM(CREDIT) − SUM(DEBIT) = 0.000000000000000000` across **82,120** ledger entries · 0 unbalanced
ledgers · 0 negative balances · 0 duplicate settlements/credits/refunds · 0 unauthorised balance
creation.

The single `BONUS_CREDIT` posting in the database is this audit's own probe, reversed through the
audited admin-debit path; probe accounts' combined net position is **0**.

## 11. Mobile

**24/24** at 375 / 390 / 412 — no horizontal overflow, ≥44 px targets, loading/error/empty states,
and a real UI → API → database chain. The login throttle engaged during runs; the window was waited
out and tests re-run. **The throttle was never weakened.**

**Physical-device testing was NOT performed** — emulation only.

## 12. Production configuration

Required before go-live: `AUTH_COOKIE_SECURE=true` over HTTPS · production JWT secrets ·
`CORS_ORIGINS` · `DATABASE_URL` / `REDIS_URL` · schema via `prisma db push` ·
`CASHIER_LARGE_WITHDRAWAL_THRESHOLD` · SMTP credentials · `RECOVERY_FAILED` alert routing ·
automated backups. Full table: `PHASE_2D11_FINAL_RELEASE_AUDIT.md` §6.

## 13. Remaining blockers

**Engineering: none on the critical path.** Two deliberate, documented omissions:

1. **Page-view / session instrumentation** — ~1 day, unblocked, but session duration and bounce rate
   each need their own definition (D-06). Shipping capture that feeds nothing would be half a
   feature.
2. **Admin UI for expenses** — F-03's backend is complete and GREEN; a UI improves usability but
   changes no requirement status. First post-delivery task.

Everything else: 8 client decisions, 6 vendor accounts.

## 14. Deployment checklist

| # | Item | Status |
|---|---|---|
| 1 | `grant-bonus` fix applied and re-probed | ✅ **DONE** |
| 2 | `AUTH_COOKIE_SECURE=true` + HTTPS verified on staging | ⚠️ **REQUIRED — never exercisable here** |
| 3 | `NEXT_PUBLIC_DEMO_MODE=false` | ✅ DONE |
| 4 | `BACKEND_ORIGIN` set | ✅ DONE |
| 5 | Production JWT secrets (not dev values) | ⚠️ REQUIRED |
| 6 | `CORS_ORIGINS` = real domain only | ⚠️ REQUIRED |
| 7 | Production `DATABASE_URL` / `REDIS_URL` | ⚠️ REQUIRED |
| 8 | Schema applied (`prisma db push`) | ⚠️ REQUIRED |
| 9 | RBAC/currencies seeded at boot | ✅ verified |
| 10 | `CASHIER_LARGE_WITHDRAWAL_THRESHOLD` | ⚠️ **CLIENT** |
| 11 | SMTP credentials | ⚠️ **CLIENT** |
| 12 | Recovery sweeper running | ✅ verified |
| 13 | `RECOVERY_FAILED` alerting to a human | ⚠️ REQUIRED |
| 14 | Health endpoint monitored | ✅ verified |
| 15 | All admin accounts enrolled in 2FA | ⚠️ OPERATIONAL |
| 16 | Backup taken, restore rehearsed | ⚠️ REQUIRED |

## 15. Verdict

# CONDITIONAL GO

**Why not NO-GO:** the vulnerability is closed, re-probed live, and guarded by a test proven to catch
it. The backend-wide inventory found no second instance. All gates pass.

**Why not GO:** 16 requirements remain blocked on client decisions and vendor accounts, and three
deployment items cannot be verified in this environment — HTTPS with secure cookies above all.

**Conditions:**

1. Verify HTTPS + `AUTH_COOKIE_SECURE=true` on staging before go-live
2. Complete the environment configuration in §14
3. Client accepts the day-one limitations: manual deposit confirmation, no outbound email, KYC
   documents reviewed externally, large-withdrawal escalation off until D-02

## 16. Known limitations

- **Physical-device testing not performed** — emulation at three widths only
- **HTTPS / secure-cookie flow never exercised** — environment constraint, carried since 2C.15
- **DAU/MAU history begins 2026-09-07** — the pipeline has no backfill, and every surface says so
- Two statistical/contention test flakes, documented and unmodified
- Six demo pages remain as routes (unreachable from navigation, test-enforced)
- ~23k LOC of quarantined simulation remains in the tree (0 importers, test-enforced)
- No migration files — schema deploys via `prisma db push`, so rollback needs a database restore

## 17. Files changed

```
apps/backend/src/modules/wallet-engine/wallet-engine.controller.ts          FROZEN
apps/backend/src/modules/wallet-engine/grant-bonus-regression.integration.spec.ts   new
apps/backend/src/modules/operations/services/monitoring.service.ts
apps/backend/src/modules/operations/services/operations.spec.ts
apps/frontend/src/components/shared/navigation.ts
apps/frontend/src/components/layout/header.tsx
apps/frontend/src/components/layout/sidebar.tsx
apps/frontend/src/lib/orphaned-simulation.test.ts
docs/PHASE_2D11_*.md  (6 documents)
```

Everything else in the working tree predates this phase.

## 18. Frozen-surface exceptions

**One, explicitly authorised by this phase's brief.** `wallet-engine.controller.ts`: one route
handler and one import name removed, replaced by a comment recording the removal. Verified by
modification time that no other frozen file changed. No money-handling logic was altered — the fix
deletes an entry point, not a calculation, and reconciliation is identical before and after.
