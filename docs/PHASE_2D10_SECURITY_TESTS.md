# Phase 2D.10 — Security & Attack Tests

**50 live HTTP checks against the running backend, 0 failures**, plus the forensic findings below.
Combined with Phase 2D.9's 121 checks: **171 live probes, 0 failures.**

---

## 1. ⚠️ CRITICAL FINDING — `POST /wallet-engine/grant-bonus`

**The most important security result of this project.**

| | |
|---|---|
| **Severity** | CRITICAL — unauthorised creation of withdrawable funds |
| **Who can exploit** | Any registered, active player. No elevated role, no 2FA |
| **Reproduced** | Yes, live, 2026-09-07 |
| **Status** | **OPEN** — frozen surface; `FROZEN_CHANGE_PROPOSAL_2D10_GRANT_BONUS.md` awaits approval |

```
account roles     : ["user"]
POST /wallet-engine/grant-bonus { amount: "1000000", wageringRequirement: "0" }  → 200
POST /wallet-engine/bonus/<id>/convert                                           → 200
balance after     : 1,000,000.000000000000000000
ledger difference : 0.000000000000000000   ← the books balance perfectly
```

**Root cause:** the route carries no `@RequirePermissions`, no role check, no environment guard and
no amount cap, and it takes both the amount and the wagering requirement from the client. The
`@CurrentUser('id')` binding means the caller is always the recipient.

**Why every control missed it:**

| Control | Why it did not fire |
|---|---|
| Reconciliation | The credit is a correct double-entry posting. The ledger is not wrong — the *authorisation* is |
| `PermissionsGuard` | Only acts where `@RequirePermissions` is present; an undecorated route is allowed for any authenticated caller |
| `AdminTwoFactorGuard` | Path-scoped to `/admin/`; this route is `/wallet-engine/` |
| Frontend tests | No UI calls the route. `DEMO_BLOCKED_PATHS` is client-side and only affects demo sessions |
| Existing wallet suites | They test the *service*, which behaves correctly. The missing control is at the controller boundary |

**Exploitation check:** the only occurrence in the database is this audit's probe, reversed through
the audited `POST /admin/wallet/debit` path. Ledger difference confirmed `0` afterwards.

**Adjacent routes on the same controller — reviewed and clean:**

| Route | Verdict |
|---|---|
| `POST /wallet-engine/transfer` | Safe — moves the caller's own funds between their own wallet types; the engine enforces the balance |
| `POST /wallet-engine/bonus/:id/convert` | Safe in itself — scoped to the caller's own bonus, refuses until wagering is met (verified live: 400) |
| `POST /wallet-engine/reward/redeem` | Safe — verifies the points balance and only decrements points; credits no money |

---

## 2. Authorization — the new finance and bonus surfaces

| # | Attack | Result |
|---|---|---|
| 1 | Unauthenticated → `/admin/finance/cash-flow` | **401** |
| 2 | Unauthenticated → `/admin/bonuses` | **401** |
| 3 | Unauthenticated → `/partner/members` | **401** |
| 4 | Player → `/admin/finance/cash-flow` | **403** |
| 5 | Player → `/admin/bonuses` | **403** |
| 6 | Player → grant themselves a bonus via `/admin/bonuses` | **403** |
| 7 | Moderator → `/admin/finance/transactions` | **403** |
| 8 | Plain player → `/partner/members` | **403** |
| 9 | Finance role (2FA) → `/admin/finance/queues` | **200** — the role genuinely works |
| 10 | Finance role → `POST /admin/bonuses` | **403** — no `wallets:adjust` |
| 11 | Finance role → `POST /admin/wallet/credit` | **403** |
| 12 | `finance` role holds `wallets:adjust`? | **No** — 0 rows, verified in the database |

**The finance role is a real least-privilege principal, not a relabelled admin.** It can read money
and own the expense ledger; it cannot move a rupee.

## 3. Mass assignment

| # | Attack | Result |
|---|---|---|
| 13 | `POST /admin/bonuses` with `status: 'CLOSED'` | **400** |
| 14 | `POST /admin/bonuses` with an absurd amount (99,999,999) | **400** |
| 15 | Zero / negative amount | **400** (integration) |
| 16 | Unknown player id / unknown currency | **404 / 400** (integration) |

No new endpoint accepts a balance, status, redemption count or wagering progress from the client.

## 4. Idempotency and concurrency

| # | Scenario | Result |
|---|---|---|
| 17 | Replay a bonus grant with the same `reference` | Returns the **first** grant; **exactly 1** bonus wallet exists |
| 18 | Replay through the **UI** at three mobile widths | Still exactly 1 audit row per reference |
| 19 | Expire the same bonus twice | Second attempt **refused** |
| 20 | Conditional expiry under a concurrent change | Only one writer wins |

## 5. Audit coverage (AD-12)

| # | Check | Result |
|---|---|---|
| 21 | `POST /admin/wallet/credit` now recorded as an `admin_action` | **Yes** — the pre-existing gap is closed |
| 22 | The record names the operator | **Yes** |
| 23 | The record carries the route | `/api/v1/admin/wallet/credit` |
| 24 | A GET is recorded as an action | **No** — a read is not an action |
| 25 | Any credential-shaped field in an `admin_action` row | **0** |
| 26 | Bonus grant audited to the operator, with the reference | **Yes** |
| 27 | Distinct audited entity types in the live database | **17** |

**A false positive worth recording:** the first version of check 25 matched the substring `code`
anywhere in the row and flagged two records. Inspection showed the match was `currencyCode` — no
credential. The assertion was **sharpened to match credential-shaped keys**, and the interceptor was
independently hardened with a deny-list so the property does not depend on a survey.

## 6. Ownership isolation

| # | Attack | Result |
|---|---|---|
| 28 | Partner reads `/partner/members` | Resolves to **their own** organisation |
| 29 | Any user id exposed in that response | **None** |
| 30 | Partner activity report cross-partner probe (2D.9, re-run) | Isolated |

## 7. Money integrity of the new surfaces

| # | Check | Result |
|---|---|---|
| 31 | Ledger fingerprint before/after a bonus grant | **Identical** — a bonus is not money until converted |
| 32 | Convert before wagering is met | **400** |
| 33 | Negative balances platform-wide | **0** |
| 34 | Ledger difference | **0.000000000000000000** |
| 35 | Individually unbalanced ledgers | **0** |

## 8. Client-shell authorization (mobile, ×3 viewports)

A player pointed at `/admin/finance` and `/admin/bonuses` at 375, 390 and 412 px:

- the shell renders `admin-forbidden` and neither console mounts, **and**
- the same session calling `/api/v1/admin/finance/cash-flow`, `/api/v1/admin/bonuses` and
  `/api/v1/partner/members` directly from the page receives **401/403** for each.

The shell is cosmetic; the server is the authority, and both were verified independently.

## 9. Range and input safeguards

| # | Check | Result |
|---|---|---|
| 36 | Cash flow with a >366-day window | **400 — refused, explicitly not truncated** |
| 37 | Inverted window | **400** |
| 38 | Unknown `typeCode` filter | Matches **nothing** (total 0), rather than being ignored |

---

## 10. Nothing was weakened

- No test skipped, no assertion loosened, no retry added to mask a failure.
- The login throttle engaged repeatedly during mobile runs. Each time the window was waited out and
  the tests re-run — **the throttle was never touched**.
- The known Plinko statistical flake remains classified FLAKY and unmodified.
- No security control was disabled to make anything pass.
