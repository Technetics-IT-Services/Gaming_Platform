# Phase 2D.9 — Security & Attack Tests

All results below come from **live HTTP against the running backend** (`:4100`) and direct queries
against the real Postgres instance. Nothing is mocked.

Two harnesses were run: **83/83** (referral, promotions, event pipeline) and **38/38** (engagement,
partner report) — **121 live checks, 0 failures**.

---

## 1. Authentication and authorization

| # | Attack | Result |
|---|---|---|
| 1 | Unauthenticated `GET /referral` | **401** |
| 2 | Unauthenticated `GET /promotions` | **401** |
| 3 | Unauthenticated `GET /admin/promotions` | **401** |
| 4 | Unauthenticated `GET /analytics/engagement` | **401** |
| 5 | Unauthenticated `GET /partner/report` | **401** |
| 6 | Player → `GET /admin/promotions` | **403** |
| 7 | Moderator → `GET /admin/promotions` | **403** |
| 8 | Player → `GET /admin/referrals` | **403** |
| 9 | Player → `GET /analytics/engagement` | **403** |
| 10 | Plain player → `GET /partner/report` | **403** |
| 11 | Plain player → `GET /partner/report.csv` | **403** |
| 12 | Admin **without 2FA** → `GET /admin/promotions` | **403**, and the refusal names the second factor — `AdminTwoFactorGuard` refuses before permissions are even considered |
| 13 | Admin **with 2FA**, holding `settings:read` → `GET /admin/promotions` | **200** |
| 14 | The same 2FA-verified admin → `POST /admin/promotions` | **403** (needs `settings:write`, super-admin only) |
| 15 | The same admin → `POST /admin/promotions/:id/status` | **403** |
| 16 | Moderator (holds `users:read`) → `GET /admin/referrals` | **200** — the read is genuinely permission-scoped, not blanket-denied |

The read/write split had to be tested on a **2FA-enrolled** admin: an un-enrolled admin is refused
by the 2FA guard first, which would have made a permission test meaningless. The harness enrols the
account through the real `/auth/2fa/setup` → `/enable` → login → `/verify` flow.

---

## 2. Ownership isolation / IDOR

| # | Attack | Result |
|---|---|---|
| 17 | Player B reads `/referral` — can they see player A's referral list? | **No.** B's `totalReferred` is 0; A's list is A's alone |
| 18 | An unrelated player sees nothing of either party | **Confirmed** |
| 19 | Partner A reads `/partner/report` | Resolves to **A** |
| 20 | Partner B reads `/partner/report` | Resolves to **B** |
| 21 | B's report contains A's share change (`4.25`) | **Absent** |
| 22 | `GET /partner/report?partnerId=<A's id>` as partner B | **400** — the field does not exist; there is no route that would accept it |
| 23 | Does A's report leak the acting operator's user id? | **No** — `IDENTITY_KEYS` strips it |
| 24 | Does it leak a fellow member's user id? | **No** |

Isolation is structural in both areas: the referral summary and the partner report both resolve the
subject from the authenticated user id, and that id is placed inside the where clause. There is no
post-load ownership check that could be forgotten.

---

## 3. Mass assignment

| # | Attack | Result |
|---|---|---|
| 25 | `POST /referral/claim` with `{ code, userId: <victim> }` | **400** (`forbidNonWhitelisted`) |
| 26 | `POST /referral/claim` with `{ code, status: 'REWARDED' }` | **400** |
| 27 | `POST /admin/promotions` with `status: 'ACTIVE'` | **400** — a client cannot publish in one step |
| 28 | `POST /admin/promotions` with `amount: '500'` | **400** — there is no award field to set |
| 29 | `POST /admin/promotions` with `currentRedemptions: 99` | **400** — redemption counts are server state |

No endpoint added in this phase accepts a user id, role, permission, balance, payout, status or
redemption count from the client.

---

## 4. Replay, idempotency and concurrency

| # | Scenario | Result |
|---|---|---|
| 30 | Claim the same referral code twice | **200 + `alreadyClaimed`**, still exactly **1** row in `referral_history` |
| 31 | Claim a *different* code after attribution | **400**, and the existing referrer is unchanged in the database |
| 32 | Two concurrent claims (integration) | Exactly **1** row survives; the loser returns the winner's result |
| 33 | Self-referral | **400**, and **0** rows created |
| 34 | Unknown code vs. valid code — different messages? | **Identical message** — no existence oracle |
| 35 | Replayed deposit (same idempotency key) | Same deposit row **and** the event count does not double |
| 36 | Re-emitting the same activity event 3× | **1** row; DAU and event count both unchanged |
| 37 | Two concurrent promotion status changes (integration) | Only one wins; the loser is told to reload |
| 38 | Invalid transition `ACTIVE → DRAFT` | **400**, and the database status is unchanged |
| 39 | `ENDED → ACTIVE` | **400** — terminal |
| 40 | Editing an `ENDED` promotion | **400** |

---

## 5. Credential and secret leakage

| # | Check | Result |
|---|---|---|
| 41 | Any `user_activities.metadata` matching `password\|token\|secret\|seed\|backup_code\|jwt\|refresh` | **0 rows** |
| 42 | Any event row containing `Bearer ` | **0 rows** |
| 43 | Recursive metadata stripping at depth (integration) | Nested credential-shaped keys are removed at every level |
| 44 | Partner report JSON contains the operator's user id | **No** |

---

## 6. Range / input safeguards

| # | Check | Result |
|---|---|---|
| 45 | `GET /analytics/engagement` with a 26-year window | **400** — refused, explicitly *not* truncated |
| 46 | Inverted window (`from` after `to`) on engagement | **400** |
| 47 | Inverted window on the partner report | **400** |
| 48 | `maxRedemptions` lowered below redemptions already recorded | **400** |
| 49 | Raising `maxRedemptions` above the recorded count | **200** |

A silently narrowed range would return real numbers for a period the caller did not ask about, with
no way for them to know. It is rejected instead.

---

## 7. CSV safety (PA-07 export)

| # | Check | Result |
|---|---|---|
| 50 | `Content-Type: text/csv` + `X-Content-Type-Options: nosniff` | **Present** |
| 51 | Header row | `recorded_at,action,changed_fields,summary` — no money column |
| 52 | Any cell beginning `=`, `+` or `@` | **None** |
| 53 | A plain player downloading it | **403** |

The writer is the same injection-safe implementation certified in 2D.7 (38/38 CSV safety tests).

---

## 8. Money integrity of the new surfaces

| # | Check | Result |
|---|---|---|
| 54 | Ledger fingerprint before/after **all** referral operations | **Identical** |
| 55 | Ledger fingerprint before/after **all** promotion operations | **Identical** |
| 56 | `wallet_transactions` mentioning "referral" | **0** |
| 57 | `wallet_transactions` mentioning "promotion" | **0** |
| 58 | `referral_history` rows with a reward recorded | **0** |
| 59 | Promotion services holding a wallet collaborator | **None exists** |

---

## 9. Client-shell authorization (mobile certification)

A player was pointed at `/admin/promotions` at 375, 390 and 412 px:

- the shell renders `admin-forbidden` and the console does not mount, **and**
- the same session calling `/api/v1/admin/promotions`, `/api/v1/analytics/engagement` and
  `/api/v1/partner/report` directly from the page receives **401/403** for each.

The shell is cosmetic; the server is the authority, and both were verified separately.
