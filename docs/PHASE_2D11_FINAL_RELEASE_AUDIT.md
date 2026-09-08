# Phase 2D.11 — Final Release Audit

Every figure produced by a run performed during this phase. 2026-09-07.

---

## 1. Gate results

| Gate | Result |
|---|---|
| Backend tests | **801 passed / 0 failed / 0 skipped** · 63 suites |
| Frontend tests | **1046 passed / 0 failed / 0 skipped** · 75 files |
| Backend typecheck | **PASS** |
| Frontend typecheck | **PASS** |
| Backend lint | **PASS** — 0 errors, 0 warnings |
| Frontend lint | **PASS** — 0 errors; 4 pre-existing warnings, none in changed files |
| Production build | **PASS** — 103 static pages |
| Live HTTP security probes | **172 / 172** |
| Mobile certification | **24 / 24** at 375 / 390 / 412 |
| Reconciliation | **PASS** — `difference: 0.000000000000000000` |
| **Critical security defect** | **CLOSED and re-probed** |

## 2. Test honesty (Phase J)

- `describe.skip` / `it.skip` / `test.skip` in product suites: **24 occurrences, all the same
  environment gate** — `const d = RUN ? describe : describe.skip` where `RUN = RUN_DB_IT === '1'`.
  Runs use `RUN_DB_IT=1`, so all execute. Jest confirms **0 skipped**.
- `.only(`: **0**.
- Mobile specs carry credential-conditional skips; credentials were supplied, so they ran.

### Two flakes — reproduced, measured, left unmodified

Across **five** full serial backend runs this phase:

| Run | Result |
|---|---|
| 1 | Process terminated — monitoring sampler (**a real defect; fixed, see §3**) |
| 2 | 800 passed, 0 failed |
| 3 | 1 failed — `game-money-baccarat-blackjack:140` |
| 4 | 2 failed — `wallet-concurrency.stress:162` |
| 5 | **801 passed, 0 failed** |
| 6 (final, recorded above) | **801 passed, 0 failed** |

**Flake A — `expect(payoutZero).toBeGreaterThanOrEqual(1)`** (blackjack, line 140): "at least one of
ten random hands must lose". Isolated: **4 runs, 4 passes**. A statistical assertion over random
deals, the same class as the documented Plinko flake. **Not modified** — it is not invalid, and the
brief forbids weakening statistical assertions.

**Flake B — `expect(failed).toBe(0)`** (wallet-concurrency stress, line 162): "no round is
unrecoverable". Isolated: **3 runs, 3 passes**. Cause: in a full serial run, other suites' live
`GameMoneyRecoveryScheduler` instances sweep rounds belonging to this test's users on the shared
database, racing its own recovery loop. The **money assertions in the same test pass in every run** —
`available >= 0` and `ledgerBalanced()`. Environment contention, not a product defect. **Not
modified.**

Neither flake was converted to a pass, and neither hides a money error.

## 3. Defects found and fixed this phase

| # | Defect | Severity | Status |
|---|---|---|---|
| 1 | `POST /wallet-engine/grant-bonus` — any player could mint withdrawable money | **CRITICAL** | **FIXED**, re-probed live (404), 13 regression tests, proven non-vacuous |
| 2 | Monitoring sampler's unhandled rejection terminates the process | Medium | **FIXED**, regression test added |

## 4. Financial forensics

| Check | Result |
|---|---|
| `SUM(CREDIT) − SUM(DEBIT)` over **82,120** entries | **0.000000000000000000** |
| Unbalanced individual ledgers | **0** |
| Negative balances | **0** |
| Duplicate settlement / credit / refund (idempotency keys) | **0** |
| Orphaned holds — non-terminal rounds | 64, **all owned by `it_*` test accounts** |
| Unauthorised balance creation | **0** — the sole `BONUS_CREDIT` is the security probe, fully reversed |
| Probe accounts' combined net position | **0.000000000000000000** |
| Operator bonus grants, all audited | 137 |
| Users in >1 partner · partners with share >100 | **0 · 0** |

## 5. Demo / fake forensics (Phase H)

| Check | Result |
|---|---|
| `NEXT_PUBLIC_DEMO_MODE` in the production build | **false** |
| Demo login path | Gated by `clientConfig.demoMode` — **cannot fire** in production |
| Demo destinations in production navigation | **0** — now filtered and **test-enforced** |
| Real-money pages touching the demo wallet | **0** — test-enforced |
| Quarantined simulation (~23k LOC, 12 dirs) | **0 importers** — test-enforced |
| `payments` / `ledger` simulation | Reachable **only** from the demo wallet — test-enforced |
| Fake providers (gateway, email, SMS, bank, storage, FX) | **None exist anywhere** |

**Does demo/fake functionality reach production? NO.** The six demo pages still exist as routes but
are unreachable from any production navigation, hold no money, and cannot reach a real-money
endpoint.

## 6. Production readiness

| Item | Status |
|---|---|
| `NEXT_PUBLIC_DEMO_MODE=false` | ✅ PASS |
| `BACKEND_ORIGIN` same-origin proxy | ✅ PASS — certified builds use it |
| Health endpoint (database, redis, heap) | ✅ PASS |
| RBAC — 214 guarded routes, 0 unguarded admin routes | ✅ PASS |
| Admin 2FA enforced at the admin boundary | ✅ PASS |
| Idle session enforcement | ✅ PASS |
| Refresh rotation + reuse detection + logout revocation | ✅ PASS (2C.5, re-certified) |
| Rate limiting / throttling | ✅ PASS — observed enforcing, never weakened |
| Audit logging — 17 entity types + blanket admin-action interceptor | ✅ PASS |
| Responsible-gaming enforcement before money moves | ✅ PASS |
| KYC state transitions · support IDOR · partner isolation | ✅ PASS |
| Analytics authorization · CSV injection safety | ✅ PASS |
| Settlement-recovery sweeper, restart-safe | ✅ PASS |
| Monitoring cannot crash the process | ✅ PASS *(fixed this phase)* |
| `AUTH_COOKIE_SECURE=true` over HTTPS | ⚠️ **CONFIGURATION REQUIRED** — not exercisable in this environment |
| `CASHIER_LARGE_WITHDRAWAL_THRESHOLD` | ⚠️ **CLIENT ACTION** — control disabled while unset |
| SMTP credentials | ⚠️ **CLIENT ACTION** — code complete, log-only until supplied |
| `RECOVERY_FAILED` alerting routed to a human | ⚠️ **CONFIGURATION REQUIRED** — service logs `ALERT: … MANUAL settlement recovery required` |
| Database backups automated | ⚠️ **OPS REQUIRED** — documented, not automated in-repo |
| Schema applied via `prisma db push` (no migration files) | ⚠️ **CONFIGURATION REQUIRED** |
| Production secrets, `CORS_ORIGINS`, `DATABASE_URL`, `REDIS_URL` | ⚠️ **CONFIGURATION REQUIRED** |

## 7. Frozen-surface exceptions

**Exactly one, explicitly authorised by this phase's brief.**

`apps/backend/src/modules/wallet-engine/wallet-engine.controller.ts` — one route handler and one
import name removed. Verified by modification time: no other file under `wallet-engine/`,
`gaming-money/`, `runtime/`, `games/` or `prisma/schema/` was touched, except the new regression spec
placed beside the controller it guards.

No wallet, ledger, settlement, bridge, engine, runtime, registry or schema **logic** was modified.
