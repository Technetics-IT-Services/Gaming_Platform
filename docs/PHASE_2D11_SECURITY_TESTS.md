# Phase 2D.11 — Security Test Results

**172 live HTTP probes, 0 failures** (83 + 38 + 51 across three harnesses), plus 13 new in-suite
regression tests and a backend-wide route/guard inventory.

---

## 1. The exploit is dead — reproduced, fixed, re-reproduced

Rule 21 of the brief: *every security finding must be reproduced before being declared fixed.*

| Stage | Result |
|---|---|
| **Before the fix** (2D.10) | `user`-role account created **₹1,000,000** withdrawable in two calls |
| **After the fix** — identical probe, same script, live server | **404 at the first call** |
| Route in the running server's route table | **absent** |
| The 9 sibling `wallet-engine` routes | **all still mapped and working** |

```
=== PROBE: can an ordinary PLAYER grant themselves a bonus? ===
player            : probe782301310@t.local
roles             : ["user"]
grant-bonus status: 404
RESULT: the endpoint REFUSED a player. Hypothesis disproved.
```

### The regression test is proven non-vacuous

The vulnerable route was **temporarily reinstated** and the suite re-run:

| With the route restored | With the route removed |
|---|---|
| 3 failed, 10 passed | **13 passed** |

Exactly the three exploit assertions turn red, and only those. A test that could not detect the
original defect would be worthless as a guard.

---

## 2. `grant-bonus-regression.integration.spec.ts` — 13/13

Authentication is **real**: every request carries a token minted by the same `TokenService`
production uses, so the full guard chain runs (JwtAuth → Roles → Permissions → AdminTwoFactor).

| # | Test | Result |
|---|---|---|
| 1 | Player replays the original attack shape | **404** |
| 2 | Route gone for *every* principal, including super-admin | **404** |
| 3 | The attack creates no bonus wallet and no ledger movement | **confirmed** |
| 4 | Player → the operator bonus route | **403** |
| 5 | Authorized operator grants to a **named** player | **200**, recipient ≠ actor |
| 6 | A legitimate grant makes exactly one movement — and it is *not* a ledger entry | **confirmed** |
| 7 | Idempotency: replaying a grant does not grant twice | **1 bonus wallet** |
| 8 | Mass assignment: `status`, `balance`, `wageringProgress`, `id` | **400 each** |
| 9 | IDOR: grant to a non-existent user id | **404** |
| 10 | Privilege escalation: `finance` role (rich in reads, no `wallets:adjust`) | **403** |
| 11 | Sibling wallet-engine routes not collaterally removed | **200** |
| 12 | Convert still refuses an unmet wagering requirement | **400** |
| 13 | Ledger exactly balanced after every attack above | **difference 0** |

---

## 3. Backend-wide route and guard inventory

The brief: *do not stop at the known grant-bonus defect.* Every route in the codebase was
enumerated and classified by machine.

```
TOTAL ROUTES: 481
  with @RequirePermissions / @Roles : 214
  explicitly @Public                :  72
  authenticated-only                : 195
```

| Category | Finding |
|---|---|
| **A. Admin routes with no permission or role** | **NONE** |
| **B. Mutating money-shaped routes, authenticated-only** | 30 — all verified below |
| **C. Public routes** | 72 — auth entry points, provably-fair verification, public catalogue |

*(An earlier version of the detector reported two category-A hits. Both were false positives: it
missed class decorators written **above** `@Controller` and assumed one controller per file. The
detector was fixed rather than the findings hand-waved, and category A is genuinely empty.)*

### The invariant `grant-bonus` violated, checked across all 77 money-shaped mutating routes

`grant-bonus` was **not** an IDOR — it correctly used `@CurrentUser`. Its defect was that it
**credited the caller from client-supplied input with no counterparty**. So the property checked was:

| Property | Result |
|---|---|
| Routes accepting a **client-supplied `userId`** (the IDOR shape) | **0** |
| Routes that **credit / grant / award** the caller | **0** |
| Routes not taking their actor from the token | 10 — **all verified benign** |

The 10:

- `dice`, `crash`, `roulette`, `card` → `play` and `verify-*`: the **stateless provably-fair
  engines**. Verified: each engine has **0** wallet/ledger references and none of these controllers
  imports `GameMoneyBridge` or `WalletEngineService`. They compute an outcome from a seed and
  persist nothing. Distinct from the real-money `/games/*/play` in `gaming-money`.
- `game-money.controller.ts` → `recovery/sweep`, `recovery/:roundId`: operator routes carrying
  `@RequirePermissions(WALLETS_ADJUST)`, with no per-user subject — correctly no `@CurrentUser`.

**Conclusion: the `grant-bonus` shape was unique, and it is gone.**

---

## 4. Live probes re-run after the fix — 172/172

| Harness | Coverage | Result |
|---|---|---|
| 2D.9 (83) | Referral attribution, promotions lifecycle, event pipeline, isolation, mass assignment, idempotency, credential stripping | **83/83** |
| 2D.9b (38) | Engagement/DAU-MAU, partner report, CSV safety, partner isolation | **38/38** |
| 2D.10 (51) | Finance role least-privilege, cash flow, transaction search, bonus admin, blanket admin audit, partner team, **the fixed exploit** | **51/51** |

Selected results:

| Attack | Result |
|---|---|
| Player → `/admin/finance/*`, `/admin/bonuses`, `/admin/promotions` | **403** |
| Moderator → finance / bonuses | **403** |
| `finance` role → grant a bonus / credit a wallet | **403** (holds no `wallets:adjust` — verified 0 rows in the database) |
| Admin without 2FA → any admin route | **403**, refusal names the second factor |
| Partner B reads partner A's data | **isolated** |
| `?partnerId=` injected by a partner | **400** — the field does not exist |
| Replay a deposit / a bonus grant / an activity event | **recorded once** |
| Concurrent promotion status change | **one writer wins** |
| Credential-shaped field in any audit or event row | **0** |
| Over-wide or inverted analytics window | **400 — refused, not truncated** |
| CSV cell beginning `=`, `+`, `@` | **none** |

---

## 5. Financial forensics after every attack

| Check | Result |
|---|---|
| `SUM(CREDIT) − SUM(DEBIT)` over **82,120** entries | **0.000000000000000000** |
| Individually unbalanced ledgers | **0** |
| Negative wallet balances | **0** |
| Duplicate `wallet_transactions` idempotency keys | **0** |
| Duplicate `game_rounds` idempotency keys | **0** |
| ACTIVE bonus wallets held by a non-test account | **0** |
| Users in more than one partner | **0** |
| Partners with share > 100 | **0** |

### Every `BONUS_CREDIT` posting in the database, accounted for

Exactly **one** exists: the 2D.10 security probe (`probe777355260@t.local`, ₹1,000,000). It carries a
matching `PENALTY` reversal — *"Phase 2D.10 security-probe artifact reversal"* — applied through the
audited `POST /admin/wallet/debit` path rather than by deleting ledger rows, which would have
unbalanced the books.

```
probe account balance now                      : 0.000000000000000000
combined net position of all probe accounts     : 0.000000000000000000
```

**137 bonus grants** exist via the operator path, every one audited to the operator who made it.

### Test-account identification

Disposable accounts are prefixed `it_`, `p9`, `p10`, `p11`, `q9`, `m9`, `r10`, `probe`. **64
non-terminal game rounds** exist, and all 64 belong to `it_*` integration-test accounts —
partially-played interactive hands and rounds the chaos/recovery specs deliberately fail. None
belongs to a real user, and the ledger balances exactly.

---

## 6. Nothing was weakened

- No test skipped, no assertion loosened, no retry added to hide a failure.
- The login throttle engaged repeatedly during mobile certification. Each time the window was waited
  out and the tests re-run — **the throttle was never touched**.
- Two statistical/contention flakes were reproduced, measured and left **unmodified** (see the final
  delivery report §Tests).
- One assertion **was** changed: the 2D.10 harness check that asserted *"the defect is still open"*.
  It now asserts the fixed state. That is correcting an expectation that had become obsolete, not
  weakening a test — and the corrected version is strictly stronger.
