# Final Client Gap Report

**What is missing, and exactly whose decision it is.** 2026-09-08.

## Summary

| Category | Count | Blocks |
|---|---|---|
| **A. Client business decision** | 8 | 12 requirements |
| **B. External provider** | 6 | 6 requirements (+ KYC file storage) |
| **C. Engineering (no client input needed)** | 5 | 2 requirements, all P2 |
| **D. Environment / configuration** | 3 | Release gates 13–15 |
| **E. Security approval** | 0 | — *(the one item here was approved and applied in 2D.11)* |

These categories are deliberately kept apart: mixing "we need a number from you" with "we need to
write code" is how a delivery conversation goes wrong.

## A. Client business decisions (8)

| ID | Question | Blocks | Effort after |
|---|---|---|---|
| **D-01** | What counts as revenue? | F-02, F-04, PA-03, PA-04, PA-06, PA-10 | ~1 day |
| **D-02** | Large-withdrawal approval threshold | AD-06 | **< 1 hour** |
| D-03 | VIP tiers + qualifying metric | P-15, P-16 | ~1 day |
| D-04 | Referral qualification, reward, leaderboard criterion | P-17, P-18 | ~half a day |
| D-05 | Periodic reward amounts | P-14, P-16 | ~1 day |
| D-06 | Retention cohort; promotion award rule | X-02, AD-08 award | ~1–2 days |
| D-07 | Financial close semantics | F-05 | ~2–3 days |
| D-08 | Gift-code value and destination wallet | P-13 | S |

Full multiple-choice sheet with recommended defaults: `CLIENT_DECISION_QUESTIONNAIRE.md`.
Every "recommended default" there is marked as a recommendation and has **not** been implemented.

## B. External providers (6)

| Provider | State | Consequence today |
|---|---|---|
| **SMTP** | Code complete, credentials missing | **No password-reset or verification email** |
| **Payment gateway** | Deliberately deferred | Deposits confirmed manually by staff |
| **Object storage** | No abstraction | KYC review works; document images live outside the platform |
| SMS / push | No provider chosen | In-app notifications only (complete) |
| FX feed | `exchange_rates` empty | Only INR in use — low impact |
| Banking | No partner | Manual payouts |

> **Payment gateway, UPI, bank transfer, payout, banking and external FX integration are
> intentionally deferred and are not part of this phase.**

## C. Engineering remaining — no client input needed (5, all P2)

| Item | Requirement | Effort |
|---|---|---|
| Game catalog sub-console (categories, collections, launchers, providers — 18 routes) | AD-03 | M |
| Responsible-gaming operator read view (2 routes) | P-10 | S |
| Audit-log viewer page (1 route) | AD-12 | S |
| Referral admin list page (1 route) | P-17 | S |
| Page-view / session instrumentation | X-02 | M — **feeds nothing until D-06 defines the metrics** |

None blocks delivery. The first four are read-mostly screens over backends that already work; the
fifth is deliberately deferred because shipping instrumentation with no defined metric would be half
a feature.

## D. Environment / configuration (3)

1. **HTTPS + `AUTH_COOKIE_SECURE=true` verified on staging** — mandatory, and impossible to verify in
   this environment. Procedure in `FINAL_RELEASE_CHECKLIST.md`.
2. Production secrets, `CORS_ORIGINS`, database and Redis URLs.
3. Schema push, backup, and `RECOVERY_FAILED` alert routing.

## E. Security approval (0)

The one item in this category — the `grant-bonus` frozen-surface fix — was proposed, approved and
applied in Phase 2D.11, then re-probed live. Nothing is outstanding.

## The three things worth asking for first

1. **D-01, the revenue definition.** One answer, six requirements.
2. **D-02, the withdrawal threshold.** Under an hour of work, and it turns on a compliance control
   that is currently off.
3. **SMTP credentials.** Under an hour, and without them your players cannot reset a password.
