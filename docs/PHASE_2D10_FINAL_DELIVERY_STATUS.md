# Phase 2D.10 — Final Delivery Status

**Audited 2026-09-07 · Delivery target 2026-09-10**
Every figure below was produced by a run performed during this audit, not carried forward.

---

## 1. Requirement totals

| Status | Count | % |
|---|---|---|
| **GREEN** — complete and verified | **38** | 65.5% |
| **AMBER** — implemented, one named part outstanding | **4** | 6.9% |
| **RED** — engineering work remains | **0** | 0% |
| **BLOCKED** — needs client input or a vendor | **16** | 27.6% |
| **TOTAL** | **58** | 100% |

`38 + 4 + 0 + 16 = 58` ✓ · Full per-requirement detail: `PHASE_2D10_REQUIREMENT_MATRIX_FINAL.md`.

**AMBER (4):** P-13 (gift-code redemption), P-17 (referral leaderboard + reward), AD-06
(threshold value), X-02 (retention / LTV / session / bounce).

**Two counting corrections are included and flagged, not hidden:** the total is 58 (not 54), and the
five items previously labelled RED are reclassified BLOCKED under the brief's own definitions
because each needs a client business definition. **The remaining work did not change — only the
label.**

---

## 2. Verification results

| Gate | Result |
|---|---|
| Backend tests | **787 passed / 0 failed / 0 skipped** · 62 suites |
| Frontend tests | **1041 passed / 0 failed / 0 skipped** · 75 files |
| Typecheck (backend + frontend) | **PASS** |
| Lint (backend + frontend) | **PASS** — 0 errors; 4 pre-existing frontend warnings, none in new code |
| Production build | **PASS** — 120 routes emitted |
| Live HTTP security probes | **171 / 171 PASS** (121 in 2D.9 + 50 in 2D.10) |
| Mobile certification | **PASS** — 24/24 this phase at 375/390/412, plus prior-phase regression |
| Reconciliation | **PASS** — difference `0.000000000000000000` |
| Financial forensics | **PASS** — see §4 |

*The brief quoted 769 backend / 1008 frontend. Those were the counts before this phase's tests were
added; the current truthful counts are **787** and **1041**.*

### Test honesty audit (Phase J)

- `describe.skip` / `it.skip` / `test.skip` occurrences in product suites: **23**, and **all 23 are
  the same environment gate** — `const d = RUN ? describe : describe.skip` where
  `RUN = process.env.RUN_DB_IT === '1'`. Runs are executed with `RUN_DB_IT=1`, so all of them run.
  Jest confirms **0 skipped**.
- `.only(` occurrences: **0**.
- No assertion was weakened, no retry added, no throttle disabled, no security check removed.
- **Mobile specs do carry credential-conditional skips.** With credentials supplied they run — and
  they did. Where credentials were absent in a regression sample, the runner reported them as
  *skipped*, and that is reported as skipped, never as passed.

### Known flake — still classified FLAKY, not PASS

`game-money-plinko-mines.integration.spec.ts` → *"PLINKO: 10 real drops"* asserts
`wins >= 1` across ten random 16-row plinko drops. It failed once during a full serial run in the
previous phase; measured **5 runs / 5 passes** in isolation, and it passed in both full runs during
this phase. The money assertions in the same test (per-drop balance invariant and `ledgerBalanced`)
passed on every run including the failing one. **The assertion has not been modified.**

---

## 3. ⚠️ CRITICAL — the finding that governs this verdict

**`POST /wallet-engine/grant-bonus` has no permission guard.** Any authenticated player can grant
themselves an arbitrary bonus and convert it into withdrawable main-wallet funds.

**Reproduced live on 2026-09-07** with a freshly registered `user`-role account:

```
grant-bonus  { amount: "1000000", wageringRequirement: "0" }  → 200
convert                                                        → 200
balance after: 1,000,000.000000000000000000
ledger difference before and after: 0.000000000000000000
```

**Why every existing control missed it:** the credit is a correct double-entry posting, so
reconciliation balances perfectly — the ledger is not wrong, the authorisation is. `PermissionsGuard`
only acts where `@RequirePermissions` is present, and this route has none. `AdminTwoFactorGuard` is
scoped to `/admin/` paths. No frontend code calls the route, so no UI test exercised it.

**Status: NOT FIXED.** The route is on a frozen surface. Per the standing instruction, a
`FROZEN_CHANGE_PROPOSAL` was raised instead of a silent edit —
`FROZEN_CHANGE_PROPOSAL_2D10_GRANT_BONUS.md`. The proposed change is one route deletion; nothing
in the repository calls it, and the operator bonus surface built this phase (`POST /admin/bonuses` —
permission-guarded, idempotent, audited) is the correct replacement.

**Exploitation check:** the only occurrence in the database is this audit's own probe, reversed
immediately through the audited `POST /admin/wallet/debit` path. Ledger difference confirmed `0`
afterwards.

**Adjacent routes checked and clean:** `transfer` (own funds only), `bonus/:id/convert` (own bonus,
wagering enforced), `reward/redeem` (verifies the points balance, credits no money).

---

## 4. Financial forensics (run at the end of this audit)

| Check | Result |
|---|---|
| `SUM(CREDIT) − SUM(DEBIT)` over 56,828 entries | **0.000000000000000000** |
| Individually unbalanced ledgers | **0** |
| Negative wallet balances | **0** |
| Duplicate `wallet_transactions` idempotency keys | **0** |
| Duplicate `game_rounds` idempotency keys | **0** |
| Users in more than one partner | **0** |
| Partners with share > 100 | **0** |
| Total ACTIVE allocated share | 15.5000 (≤ 100 ✓) |
| `wallet_transactions` mentioning referral / promotion | **0 / 0** |
| `referral_history` rows with a reward recorded | **0** |
| `user_activities` rows matching any credential term | **0** |

**Non-terminal rounds, stated rather than omitted:** 32 game rounds created today are not in a
terminal state. **All 32 belong to `it_*` integration-test accounts** — partially-played interactive
blackjack hands and rounds the chaos/recovery specs deliberately fail. None belongs to a real user.
The ledger balances exactly, so no money is unaccounted for.

---

## 5. Demo / fake-data forensics (Phase H)

`NEXT_PUBLIC_DEMO_MODE=false` is set in `.env.production.local` and the certified production build
uses it.

| Finding | Classification |
|---|---|
| Demo login (any credentials sign in a Demo User) | **DEVELOPMENT ONLY** — gated by `clientConfig.demoMode`, which is `false` in the production build. Cannot fire |
| `src/lib/{analytics,operations,partners,tenancy,…}` ~23k LOC simulation, 12 directories | **DEVELOPMENT ONLY, now quarantined by an enforcing test** — 0 importers, and `orphaned-simulation.test.ts` fails the build if anything imports them |
| `src/lib/payments`, `src/lib/ledger` | **DEVELOPMENT ONLY, reachable from the demo wallet only** — asserted by test; no real-money page touches them |
| `/vault`, `/bets`, `/store`, `/marketplace`, `/mailbox`, `/promotions` (demo showcase) | **DEVELOPMENT ONLY, but reachable from production player navigation.** The demo wallet initialises to **balance 0 / vault 0**, so no fabricated money is displayed — these are inert screens, not lies about funds |
| Real-money routes (`/deposit`, `/withdraw`, `/wallet`, `/cashier`, `/offers`, `/referral`) | **REAL PRODUCT** — asserted by test to contain no demo-wallet usage |
| Backend fake providers | **None exist.** No fake gateway, no fake email send, no fake SMS, no fake bank settlement, no fabricated KYC storage |

**Does demo/fake functionality reach production? Partially — and precisely:** six inert demo
*screens* remain linked in the player navigation. They display zeros, move no real money and cannot
reach a real-money endpoint. **No fabricated balance or fake business figure is displayed anywhere.**
Removing or hiding those navigation entries is the one piece of engineering left that needs no
client input (§7).

---

## 6. The nine questions

### 1. Can the system honestly be called COMPLETE today?

**No.** Two reasons, in order of severity:

1. **A live privilege defect lets any player mint withdrawable money** (§3). Until it is closed the
   platform is not safely deliverable at any completeness percentage.
2. 16 of 58 requirements genuinely depend on a client decision or a vendor account that has not been
   supplied.

What *can* honestly be said: **every requirement that is fully specified and does not require an
external party is implemented, tested and live-verified.**

### 2. What prevents COMPLETE status?

| # | Blocker | Kind |
|---|---|---|
| 1 | `grant-bonus` privilege defect | **Frozen change awaiting approval** |
| 2 | Revenue definition | Client decision (blocks 6) |
| 3 | Large-withdrawal threshold | Client decision |
| 4 | VIP tiers and amounts | Client decision |
| 5 | Referral qualification and reward | Client decision |
| 6 | Promotion award rule | Client decision |
| 7 | Retention cohort definition | Client decision |
| 8 | Financial close semantics | Client decision |
| 9 | Gift-code redemption destination | Client decision |
| 10 | SMTP, gateway, storage, SMS/push, FX, banking | External vendors |
| 11 | Page-view / session instrumentation | **Engineering** |
| 12 | Six inert demo screens in player navigation | **Engineering** |

### 3. Which blockers are client decisions?

**Eight (D-01 … D-08).** D-01 revenue alone unblocks six requirements. Full text and multiple-choice
options: `CLIENT_DECISION_QUESTIONNAIRE.md`.

### 4. Which blockers are external vendors?

**Six:** payment gateway (X-05), SMTP (X-03), object storage (P-12 upload), SMS/push (X-04), FX
source (F-09), banking (F-10). Detail: `EXTERNAL_DEPENDENCY_MATRIX.md`.

### 5. Which blockers are engineering?

**Three, and all are small:**
1. Apply the approved frozen change (§3) — **under 2 hours including full re-verification**
2. Page-view / session instrumentation for X-02's last two metrics — **~1 day**
3. Remove or role-gate the six inert demo navigation entries — **~2 hours**

### 6. What can be completed within 24 hours of receiving decisions?

| Received | Delivered within 24h |
|---|---|
| Security-fix approval | Route removed, full suite + live probes + reconciliation re-run |
| Large-withdrawal threshold | AD-06 → GREEN (< 1 hour) |
| SMTP credentials | X-03 → GREEN (< 1 hour) |
| Revenue definition | F-02, F-04 and the partner-profit chain in progress; F-02/F-04 realistically GREEN inside 24h |
| Retention definition | X-02 retention (~half a day) |
| Referral reward rule | P-17 reward + P-18 (~half a day) |
| Referral leaderboard choice | P-17 leaderboard (~2 hours) |

### 7. What cannot be completed by September 10 even with immediate decisions?

- **Payment gateway (X-05)** — 3–5 days, and needs a merchant account plus sandbox testing
- **Bank settlement (F-10)** — depends on the bank's file specification
- **Full partner money chain (PA-03 → PA-04 → PA-06 → PA-10)** — sequential; revenue → profit →
  balance → withdrawal → distribution is more than three days of work even starting today
- **Financial close (F-05)** — 2–3 days after D-07
- **X-02 retention with meaningful numbers** — the calculation is quick, but the pipeline has no
  backfill and only began recording on 7 September; the figures need roughly a month of live traffic
- **Physical-device mobile testing** — emulation only in this environment
- **HTTPS end-to-end verification** — not exercisable here

### 8. What must the client provide immediately?

1. **Approval to apply the security fix** — one word, gates everything
2. **The large-withdrawal threshold** — a compliance control currently switched off
3. **SMTP credentials** — without them no password-reset email can be sent
4. **The revenue definition** — six requirements
5. **Confirmation of launch-day scope** — which optional features are in or out on 10 September

### 9. Absolute minimum production deployment checklist

| # | Item | Status |
|---|---|---|
| 1 | Apply the approved `grant-bonus` fix, re-run tests + reconciliation | ⚠️ **BLOCKING — awaiting approval** |
| 2 | `AUTH_COOKIE_SECURE=true` and serve over HTTPS | **CONFIGURATION REQUIRED** (the `Boolean('false')` bug was fixed in 2C.13) |
| 3 | `NEXT_PUBLIC_DEMO_MODE=false` | ✅ **PASS** — already set and built with |
| 4 | `BACKEND_ORIGIN` set for same-origin cookie flow | ✅ **PASS** — certified builds use it |
| 5 | Strong `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | **CONFIGURATION REQUIRED** — validated at boot, must not be dev values |
| 6 | `CORS_ORIGINS` set to the real domain only | **CONFIGURATION REQUIRED** |
| 7 | `DATABASE_URL`, `REDIS_URL` for production instances | **CONFIGURATION REQUIRED** |
| 8 | Schema applied (`prisma db push` — no migration files exist) | **CONFIGURATION REQUIRED** |
| 9 | Currencies + transaction types + RBAC seeded | ✅ **PASS** — `RbacBootstrapService` seeds roles/permissions at boot, verified this phase (`finance` role auto-seeded with 6 permissions) |
| 10 | `CASHIER_LARGE_WITHDRAWAL_THRESHOLD` | ⚠️ **CLIENT ACTION** — control disabled while unset |
| 11 | Settlement-recovery sweeper running | ✅ **PASS** — `GameMoneyRecoveryScheduler`, restart-safe |
| 12 | `RECOVERY_FAILED` alerting | **CONFIGURATION REQUIRED** — the service logs `ALERT: … MANUAL settlement recovery required`; route that log line to a pager |
| 13 | Health endpoint monitored | ✅ **PASS** — `/api/v1/health` reports database, redis and heap |
| 14 | Rate limiting / throttling | ✅ **PASS** — global throttler plus per-route limits; observed enforcing repeatedly |
| 15 | Admin accounts enrolled in 2FA | ⚠️ **OPERATIONAL** — admin API is refused until each admin enrols |
| 16 | Audit logging | ✅ **PASS** — 17 entity types plus blanket admin-action interceptor |
| 17 | Idle-session enforcement | ✅ **PASS** — `SESSION_IDLE_TIMEOUT_MINUTES` |
| 18 | Responsible-gaming enforcement | ✅ **PASS** — enforced before money moves |
| 19 | Reconciliation monitored | ✅ **PASS** — `/admin/wallet/reconcile`; schedule a periodic check |
| 20 | Database backups | **ENGINEERING/OPS REQUIRED** — documented in `DISASTER_RECOVERY.md`, not automated in-repo |
| 21 | SMTP configured | ⚠️ **CLIENT ACTION** |
| 22 | Rollback plan | **OPS REQUIRED** — no migration files, so schema rollback needs a database restore |

---

## 7. Engineering items still possible without client input

1. Apply the frozen `grant-bonus` fix **once approved** (approval is a client action; the work is ours)
2. Page-view / session instrumentation for X-02
3. Remove or role-gate the six inert demo navigation entries
4. Admin UI for expenses (F-03 backend is complete; only a screen is missing)
5. Delete the 23k LOC of quarantined simulation — optional, safest after handover

## 8. Engineering items blocked by the client

Referral reward and leaderboard (D-04/Q7) · promotion awarding (D-06) · VIP tiers, progression and
benefits (D-03/D-05) · periodic rewards (D-05) · gift-code redemption (D-08) · profit, partner
profit, partner balance, partner withdrawal, daily distribution (D-01) · financial close (D-07) ·
retention (D-06) · large-withdrawal threshold (D-02).

---

## 9. September 10 delivery plan

### DAY 1 — Monday 8 September

**Morning — the gate**
- Obtain approval for the frozen change. **Nothing else on this plan matters until this is done.**
- Apply it (delete the route), then run: full backend suite, full frontend suite, 171 live probes,
  reconciliation, mobile certification.
- Re-run the exploit probe and confirm it now fails at the first call.

**Afternoon — cheap wins, only if the answers arrive**
- Set `CASHIER_LARGE_WITHDRAWAL_THRESHOLD` → AD-06 GREEN
- Configure SMTP and send a real test email → X-03 GREEN
- Begin F-02/F-04 if the revenue definition has arrived

**In parallel, needing no client input**
- Role-gate the six demo navigation entries
- Prepare the production environment file and confirm every variable in §6.9

### DAY 2 — Tuesday 9 September

- Finish F-02/F-04, then PA-03 partner profit if the revenue answer is in
- Retention (X-02) if the cohort definition is in; referral reward/leaderboard if those are in
- Full regression: backend, frontend, typecheck, lint, production build, mobile at all three widths
- Financial forensics re-run; reconciliation must read `difference: "0"`
- Deploy to a staging environment over **HTTPS** with `AUTH_COOKIE_SECURE=true` and verify the real
  login cookie flow — the one thing this environment could never exercise

### FINAL RELEASE GATE — Wednesday 10 September

Ship only if **all** of these hold:

| # | Gate | Must be |
|---|---|---|
| 1 | `grant-bonus` defect closed and re-probed | **YES — no exceptions** |
| 2 | Backend / frontend suites | 0 failed, 0 unexplained skips |
| 3 | Live security probes | 171/171 |
| 4 | Reconciliation | `difference: "0"`, 0 negative balances |
| 5 | Mobile 375/390/412 | PASS |
| 6 | Production build with `NEXT_PUBLIC_DEMO_MODE=false` | PASS |
| 7 | HTTPS + `AUTH_COOKIE_SECURE=true` verified on staging | PASS |
| 8 | Every admin account enrolled in 2FA | PASS |
| 9 | `RECOVERY_FAILED` alerting routed to a human | PASS |
| 10 | Database backup taken and a restore rehearsed | PASS |

**Accepted, documented day-one limitations** (only if the client explicitly accepts them):
manual deposit confirmation until a gateway exists; no outbound email until SMTP is supplied; KYC
documents reviewed outside the platform until storage exists; large-withdrawal escalation off until
the threshold is set.

---

## 10. Verdict

# NO-GO today — CONDITIONAL GO once the security fix is applied

The platform is in genuinely good shape: 38 of 58 requirements complete and verified, a money core
that balances to the last decimal across 56,828 ledger entries, 171 live security probes passing,
and mobile certification at all three widths.

**But a live build in which any player can mint withdrawable money must not ship.** That is a
two-hour fix awaiting one approval.

With the fix applied, this becomes a **CONDITIONAL GO** for 10 September — conditional on the client
accepting the documented day-one operational limitations, which are consequences of missing vendor
accounts rather than incomplete engineering.

**Nothing on the critical path is waiting on more development.**
