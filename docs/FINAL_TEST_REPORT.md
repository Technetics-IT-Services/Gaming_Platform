# Final Test Report

**2026-09-08, after Phase 2D.12.** Every figure from a run performed during this phase.

## Totals

| Suite | Passed | Failed | Skipped | Files/Suites |
|---|---|---|---|---|
| Backend (unit + integration + stress, `RUN_DB_IT=1 RUN_STRESS=1`) | **801** | **0** | **0** | 63 |
| Frontend | **1074** | **0** | **0** | 76 |
| Live HTTP security/workflow probes | **218** | **0** | — | 4 harnesses |
| Mobile certification (375 / 390 / 412) | **24** | **0** | — | 8 tests × 3 viewports |

Typecheck **PASS** (backend + frontend) · Lint **PASS** (0 errors) · Production build **PASS**.

## Added in Phase 2D.12

| Suite | Count | Covers |
|---|---|---|
| `operator-consoles.test.ts` | 28 | Cashier, KYC, users and expenses clients + structural honesty of each screen |
| `p2d12-operator-consoles.spec.ts` | 8 × 3 viewports | Mobile + UI → API → DB for the new consoles |
| Live harness `2d12_live.js` | 46 | Deposit credited end-to-end, withdrawal held/rejected/refunded, RBAC split, money integrity |

## Live workflow verification (the important one)

The deposit rail was **unreachable through the product** before this phase. Verified live:

| Step | Result |
|---|---|
| Player requests a ₹2,500 deposit | `PENDING`, **no money moved** |
| Operator sees it in the queue | Present, with the amount **from the request** |
| Finance role tries to credit it | **403** — reading a queue is not authority to move money |
| Player tries to credit it | **403** |
| Authorised operator credits it | **200**; balance **+2500 exactly** |
| Ledger before vs after | **identical, difference 0** |
| Action audited | **Yes**, as an `admin_action` naming the operator |
| Withdrawal: request → hold → reject | Held funds **refunded exactly**; ledger balanced |

## Test honesty

- `describe.skip` occurrences in product suites: **24**, all the same environment gate
  (`RUN_DB_IT`); runs use `RUN_DB_IT=1`, so all execute. Jest reports **0 skipped**.
- `.only(`: **0**.
- No assertion weakened, no retry added to mask a failure, no throttle disabled, no timeout raised
  to hide a problem.

### One assertion was changed, and why it is not a weakening

`finance-ops-api.test.ts` pinned the exact key list of a read-only client. Phase 2D.12 added
`cashierQueue`, a **read**. The list was updated **and the test strengthened**: it now also asserts
the client issues no `post`/`put`/`patch`/`delete` at all — a direct check of the property the key
list was only proxying for.

### Known flakes — reproduced, measured, unmodified

| Test | Assertion | Isolated | Classification |
|---|---|---|---|
| `game-money-baccarat-blackjack:140` | `payoutZero >= 1` — at least one of ten random hands loses | **4 runs, 4 passes** | Statistical, over random deals |
| `wallet-concurrency.stress:162` | `failed === 0` — no round unrecoverable | **3 runs, 3 passes** | Shared-DB contention: other suites' live recovery schedulers race this test's own recovery loop |

Money assertions inside both tests (`balance >= 0`, `ledgerBalanced`) pass in **every** run,
including runs where the statistical assertion failed. Neither was converted to a pass.

## A real defect found by the tests

The Phase 2D.12 live harness caught a genuine bug **in code written during this phase**: the cashier
queue was oldest-first with a cap and no pagination, so once the backlog exceeded the cap a
newly-created request was **silently invisible** — an operator could not find the very work they
needed to action.

Fixed with real pagination returning the full `total`, and the mobile suite now asserts that a large
backlog is paged rather than truncated. A queue that hides work is worse than no queue.
