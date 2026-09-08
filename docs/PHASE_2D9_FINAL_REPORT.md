# Phase 2D.9 — Final Report

**Date:** 2026-09-07 · **Client delivery deadline:** 2026-09-10 · **Commits made:** none (as instructed)

---

## 1. Starting requirement matrix

The brief quoted `GREEN 25 / AMBER 10 / RED 9 / BLOCKED 11` out of **54**. Recounting from the
requirement IDs themselves found **two errors**, both corrected (details in `PHASE_2D9_AUDIT.md` §1):

| | Quoted | **Actual** |
|---|---|---|
| TOTAL | 54 | **58** (P-01…18, PA-01…10, AD-01…12, F-01…10, X-01…08) |
| GREEN | 25 | **28** — the matrix's own GREEN list contained 28 IDs |
| AMBER | 10 | 10 ✓ |
| RED | 9 | 9 ✓ |
| BLOCKED | 11 | 11 ✓ |

28 + 10 + 9 + 11 = 58 ✓. The old numbers did not reconcile with the enumeration; these do.

---

## 2. Exact changes made

Five requirement areas, each a full vertical slice — database → service → authorization → API →
frontend → validation → tests → live verification.

| Area | What shipped | What was deliberately left out |
|---|---|---|
| **X-02** event pipeline | Durable, deduplicated `UserActivity` writer wired to login, deposit and real-money play | — |
| **X-02** DAU/MAU | `GET /analytics/engagement` + admin panel, definitions in the payload, no-backfill caveat stated | Retention, LTV, session time, bounce rate — each declared with the specific missing input |
| **P-17** referral | Code, link, one-time claim, attribution, both dashboard directions, history, admin read | Qualifying deposit, reward, earnings (undefined); leaderboard (ranking criterion unspecified) |
| **AD-08** promotions | Full CRUD, table-driven status lifecycle, scheduling, redemption cap, real player offers page | Awarding — no rule defines payment, trigger, audience or accounting |
| **PA-07** partner reports | The partner's own recorded activity report + injection-safe CSV | Financial reports (blocked on F-02) |

---

## 3. Requirement-by-requirement before → after

| ID | Before | After | Evidence |
|---|---|---|---|
| **AD-08** Promotions admin CRUD | RED | **GREEN** | 27 integration + 30 live checks + 24 mobile; UI → API → DB → player list proven at all three viewports |
| **P-17** Referral | RED | **AMBER** | Attribution GREEN and live-proven; reward half BLOCKED with the named missing rule |
| **PA-07** Partner reports | RED | **AMBER** | Activity report GREEN and isolation-proven; financial half blocked by F-02 |
| **X-02** Analytics events | RED | **AMBER** | Pipeline + DAU/MAU GREEN and SQL-verified; retention/LTV/session/bounce declared |
| P-14, P-15, P-16, P-18, F-05 | RED | RED | Unchanged — each needs a client business decision (§14) |
| All GREEN / BLOCKED items | — | Unchanged | No regression; prior-phase mobile specs re-run green |

**Post-2D.9: TOTAL 58 · GREEN 29 · AMBER 13 · RED 5 · BLOCKED 11** (29+13+5+11 = 58 ✓).

---

## 4. Files changed

**New — backend**
```
modules/events/activity-event.service.ts        modules/events/events.module.ts
modules/referral/referral.service.ts            modules/referral/referral.controller.ts
modules/referral/referral.module.ts             modules/referral/referral.integration.spec.ts
modules/promotions/promotions.service.ts        modules/promotions/promotions.controller.ts
modules/promotions/promotions.module.ts         modules/analytics/engagement.integration.spec.ts
```

**Modified — backend**
```
app.module.ts                                   (registers the three new modules)
modules/analytics/analytics.service.ts          (engagement(); refreshed stale dau/mau/retention/ltv reasons)
modules/analytics/analytics.controller.ts       (GET /analytics/engagement)
modules/auth/services/account-security.service.ts  (LOGIN event)
modules/wallet/cashier.service.ts               (DEPOSIT event)
modules/gaming-money/game-money.controller.ts   (GAME_PLAY event — at the controller, not the bridge)
modules/partner/partner.service.ts              (myActivityReport, describeChange, IDENTITY_KEYS)
modules/partner/partner.controller.ts           (GET /partner/report and /partner/report.csv)
```

**New — frontend**
```
app/(dashboard)/referral/page.tsx    app/(dashboard)/offers/page.tsx    app/admin/promotions/page.tsx
lib/referral-api.ts                  lib/promotions-api.ts
lib/referral-api.test.ts             lib/promotions-api.test.ts
tests/mobile-cert/p2d9-referral-promotions.spec.ts
```

**Modified — frontend**
```
lib/analytics-api.ts + .test.ts      lib/partner-api.ts + .test.ts
lib/api-client.ts                    (adds /referral and /promotions to DEMO_BLOCKED_PATHS)
lib/demo-auth-isolation.test.ts      components/shared/navigation.ts
app/admin/analytics/page.tsx         app/partner/page.tsx
```

**Pre-existing dirty state (NOT this phase).** The working tree already carried 68 modified and 269
untracked paths when this phase began — the accumulated, uncommitted output of Phases 2C.x–2D.8
(whole module directories such as `modules/gaming-money/`, `modules/partner/`, `modules/settings/`
and `modules/finance/` are untracked in their entirety). The lists above are this phase's
contribution only; every other dirty path predates it.

---

## 5. Database changes

**None.** No migration, no schema edit, no new model, no new column.

- Referral uses the existing `User.referralCode` and `ReferralHistory` — whose `referredId` is
  **already UNIQUE**, which is what makes duplicate attribution impossible at the database level.
- Promotions use the existing `Promotion` model.
- The event pipeline writes the existing `user_activities` table (0 rows and 0 writers before this
  phase).
- The partner report reads the existing `audit_trails`.

`packages/database/prisma/schema/` is byte-identical to its pre-phase state.

---

## 6. API changes

| Method | Route | Authorization |
|---|---|---|
| GET | `/referral` | authenticated player (own data only) |
| POST | `/referral/claim` | authenticated player |
| GET | `/admin/referrals` | `users:read` (read-only) |
| GET | `/promotions` | authenticated player — genuinely ACTIVE offers only |
| GET | `/admin/promotions`, `/admin/promotions/:id` | `settings:read` |
| POST | `/admin/promotions`, `/:id/update`, `/:id/status` | `settings:write` (super-admin only) |
| GET | `/analytics/engagement` | `analytics:read` |
| GET | `/partner/report`, `/partner/report.csv` | `partners:read_own` (caller's own organisation) |

**No new permission was invented.** Everything reuses the existing RBAC vocabulary.

---

## 7. Frontend changes

Three new pages (`/referral`, `/offers`, `/admin/promotions`), two extended pages (admin analytics
engagement panel, partner activity report), two new API clients, two extended clients, navigation
entries for both the player and admin shells, and two new demo-blocked paths.

`/offers` is deliberately a **separate route** from the pre-existing fictional `/promotions` demo
showcase — the same pattern 2C.8 used when the real `/lobby` was added beside the demo `/games`
lobby. The demo page was not silently repurposed, and it is not presented as real.

---

## 8. Security verification

**121 live HTTP checks, 0 failures.** Full detail in `PHASE_2D9_SECURITY_TESTS.md`.

- **Authorization:** 16 checks — unauthenticated 401, player 403, moderator 403, admin-without-2FA
  403 (refusal names the second factor), 2FA admin read 200 / write 403, super-admin write 200.
- **IDOR / isolation:** 8 checks — referral and partner data both resolve from the authenticated
  user id placed inside the where clause; a supplied `partnerId` is rejected as an unknown field.
- **Mass assignment:** 5 checks — `userId`, `status`, `amount`, `currentRedemptions` all rejected.
- **Replay / idempotency / concurrency:** 11 checks — duplicate claims, concurrent claims, replayed
  deposits, re-emitted events, concurrent promotion status changes.
- **Credential leakage:** 4 checks — 0 rows in `user_activities` match any credential-shaped term.
- **Range safeguards:** 5 checks — over-wide and inverted windows refused, never truncated.
- **CSV safety:** 4 checks — nosniff, no money column, no formula-lead cell, player 403.

**Nothing was weakened.** The login throttle caused two transient mobile failures during
back-to-back runs; the window was waited out and the tests re-run — the throttle was not touched.

---

## 9. Mobile verification

`playwright.mobile.config.ts` against a **production build** (demo off, same-origin backend).

| Viewport | 2D.9 spec | Result |
|---|---|---|
| 375 × 812 | 8 tests | **8 passed** |
| 390 × 844 | 8 tests | **8 passed** |
| 412 × 915 | 8 tests | **8 passed** |

**24/24.** Each viewport verifies: no horizontal overflow, ≥44 px touch targets, loading/error/empty
states, and a real end-to-end chain — the referral claim reaches a database row and survives a
reload; an operator status change reaches the database and the player offers list follows it.

**Regression:** the prior-phase analytics and partner mobile specs were re-run with real
credentials — **12/12 passed**, confirming the analytics and partner page edits caused no regression.

---

## 10. Test results

| Gate | Result |
|---|---|
| Backend suite (`RUN_DB_IT=1 RUN_STRESS=1`, `--runInBand`) | **769 passed / 61 suites / 0 failed / 0 skipped** (was 728 / 59) |
| Frontend suite | **1008 passed / 73 files / 0 failed / 0 skipped** (was 962 / 71) |
| Backend typecheck | **PASS** |
| Frontend typecheck | **PASS** |
| Backend lint | **PASS** (0 errors, 0 warnings) |
| Frontend lint | **PASS** (0 errors; 4 pre-existing warnings, none in new files) |
| Backend production build | **PASS** |
| Frontend production build | **PASS** (101 static pages; `/referral`, `/offers`, `/admin/promotions` all emitted) |
| Live HTTP verification | **121 / 121** |
| Mobile certification | **24 / 24** (+ 12/12 regression) |

**Zero tests were skipped, weakened, retried or disabled.**

### One flake, reported as a flake

`game-money-plinko-mines.integration.spec.ts` → *"PLINKO: 10 real drops"* failed once during a full
serial run on `expect(wins).toBeGreaterThanOrEqual(1)` — a statistical assertion that at least one of
ten random 16-row plinko drops pays above stake. Measured in isolation: **5 runs, 5 passes.** The
money assertions in the same test (the per-drop balance invariant and `ledgerBalanced`) passed on
every run, including the failing one, and this spec exercises `bridge.playPlinko` directly, bypassing
the controller this phase edited. **Reported as FLAKY, not as PASS. The assertion was not modified** —
the brief forbids altering statistical assertions unless proven invalid, and it is not invalid.

---

## 11. Financial reconciliation

Run directly against Postgres after all implementation and testing:

| Check | Result |
|---|---|
| `SUM(CREDIT) − SUM(DEBIT)` across 54,006 ledger entries | **0.000000000000000000** |
| Individually unbalanced ledgers | **0** |
| Negative wallet balances | **0** |
| Duplicate `wallet_transactions` idempotency keys | **0** |
| Duplicate `game_rounds` idempotency keys | **0** |
| Users belonging to more than one partner | **0** |
| Partners with share > 100 | **0** |
| Total ACTIVE allocated share | 23.5000 (≤ 100 ✓) |
| `wallet_transactions` mentioning referral | **0** |
| `wallet_transactions` mentioning promotion | **0** |
| `referral_history` rows with a reward recorded | **0** |
| `user_activities` rows matching any credential term | **0** |

**Non-terminal game rounds — stated honestly rather than omitted.** 29 rounds created today are not
in a terminal state (21 `RESERVED`, 8 `RECOVERY_FAILED`). **All 29 belong to `it_*` integration-test
accounts** — partially-played interactive blackjack hands and rounds the chaos/recovery specs
deliberately fail to prove the recovery path. None belongs to a real user or to any of this phase's
live-harness accounts, and the ledger balances to exactly zero with zero unbalanced ledgers, so no
money is unaccounted for. This is pre-existing test residue, not a leak introduced here.

---

## 12. Remaining RED (5)

| ID | Requirement | Why it is not built |
|---|---|---|
| P-14 | Daily/weekly/monthly/seasonal rewards, lucky spin | Every item is a **reward amount**; none is defined |
| P-15 | VIP levels 1–5 + progression | **Tier thresholds** are the requirement and are undefined |
| P-16 | VIP periodic/birthday rewards, higher withdrawal limit | Needs P-15's thresholds **and** the reward amounts |
| P-18 | Referral wallet | Nothing to hold until a reward exists; would also touch the **frozen** wallet schema |
| F-05 | Daily settlement / financial close | Requires the accounting semantics of a close (blocked by F-02). The factual daily aggregates already ship in 2D.7's reports |

All five are blocked on client business decisions, not on engineering effort.

## 13. Remaining BLOCKED (11)

F-02 (revenue definition), F-04 (profit), PA-03 (partner profit), PA-04 (partner balance),
PA-06 (partner withdrawal), PA-10 (daily profit distribution) — all downstream of **one** missing
definition. Plus F-09 (FX source), F-10 (banking provider), X-03 (SMTP), X-04 (SMS/push),
X-05 (payment gateway).

---

## 14. Exact client decisions required

1. **What "revenue" means for this platform.** One definition unblocks F-02, F-04, PA-03, PA-04,
   PA-06, PA-10 and the partner financial reports — 6 requirement IDs from one answer.
2. **The large-withdrawal escalation threshold** (AD-06) — a single number and currency. The control
   is built and disabled while unset.
3. **VIP tier thresholds** (P-15) and **VIP reward amounts** (P-16).
4. **Referral qualification rule** — what makes a deposit "qualifying": amount, currency, window —
   **and the reward amount** (P-17, P-18).
5. **Promotion award rule** — what a promotion pays, on what trigger, to whom, and how it is
   accounted for (AD-08 awarding).
6. **Retention cohort definition** — which event starts a cohort and at which day boundaries
   retention is measured (X-02).
7. **Periodic reward amounts** for daily/weekly/monthly/seasonal rewards (P-14).
8. **Financial close semantics** (F-05) — what is locked, by whom, and what a closed period asserts.

## 15. Exact external credentials / providers required

| Requirement | Needed |
|---|---|
| X-03 Email | SMTP host, port, credentials, sender identity |
| X-04 SMS / push | Provider account + API credentials |
| X-05 Payment gateway | Provider account, API keys, webhook secret |
| F-09 FX totals | An exchange-rate source (`exchange_rates` is empty) |
| F-10 Bank settlement | Banking partner + settlement file format/credentials |
| P-12 KYC file upload | Object storage (bucket + credentials). The metadata lifecycle and review are complete and working |

No fake provider was built. Nothing returns a success it did not receive.

---

## 16. Frozen surfaces

**Untouched.** Verified by modification time and by diff:

- `modules/wallet-engine/**` — no file modified
- `modules/runtime/**`, `modules/games/**` (engines, registry) — no file modified
- `game-money-bridge.service.ts` — last modified **2026-08-21**, i.e. before this phase
- `packages/database/prisma/schema/**` — no file modified

The one place needing care: the `GAME_PLAY` event is emitted in `game-money.controller.ts`
**after** the bridge returns, using the round id the bridge produced. The frozen bridge was neither
called differently nor modified. **No `FROZEN_CHANGE_PROPOSAL` was required**, because no frozen
change was necessary.

---

## 17. September 10 delivery readiness — honest GO / NO-GO

### Verdict: **CONDITIONAL GO**

**What the client can receive on 10 September as a working production system:**

29 of 58 requirements fully GREEN — registration/login with 2FA and refresh-token rotation, the
wallet and double-entry ledger, 15 real-money games with reservations, settlement, idempotency and
provable fairness, deposits and withdrawals, transaction history, profile and security, notifications,
responsible-gaming enforcement, KYC lifecycle, support ticketing, analytics and CSV reporting,
partner principal with proven isolation and configurable ownership share, expenses, admin settings,
and — new this phase — promotions administration with a real player-facing offers page. A further 13
are AMBER: substantially built, each with a named and disclosed missing part.

**What makes it CONDITIONAL, and it is not an engineering shortfall:**

1. **All 5 remaining RED and all 11 BLOCKED items are waiting on the client**, not on development.
   Six of them collapse the moment someone defines "revenue".
2. **No payment gateway.** Deposits are operator-credited. This is correct and deliberate — a fake
   gateway would be worse — but it is a real operational constraint on day one.
3. **No email, SMS or push delivery.** Notifications are durable and in-app; nothing leaves the
   platform.
4. **KYC document file bytes cannot be stored** (no object storage). The review lifecycle works on
   metadata.
5. **AD-06 large-withdrawal escalation is built but disabled** until the client supplies the
   threshold. This is the one compliance control currently inert.
6. **DAU/MAU history starts now.** The pipeline has no backfill; every surface says so rather than
   drawing a flat line through a period that was never instrumented.

**Not blocking, but stated:** physical-device testing was never executed (emulation only), and HTTPS
could not be exercised in this environment — both carried forward unchanged from the 2C.15 go/no-go.

**Recommendation.** Ship what is GREEN and AMBER on 10 September; it is a genuinely working
real-money platform with the money core verified to `difference: 0`. Put items §14.1 and §14.2 in
front of the client this week — one definition and one number unblock more requirements than any
remaining engineering task.
