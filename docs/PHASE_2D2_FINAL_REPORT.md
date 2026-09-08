# Phase 2D.2 — Final Report: Security Hardening, Audit Completion & Session Controls

Companions: `PHASE_2D2_AUDIT.md` · `PHASE_2D2_IMPLEMENTATION.md` · `PHASE_2D2_SECURITY_TESTS.md`.
**Nothing committed. No Prisma migration. No frozen-surface change. No new dependency.**

---

## 0. A correction to my own earlier reporting

Phase 2C.18 stated *"audit covers 4 of 9 required actions"*. **That was measured against only one of
the two audit stores in this repository and understated real coverage.** `SecurityEvent` already
recorded login, login-failure, logout, password change, password reset, MFA challenge and account
lock/unlock. I am stating this before the numbers below so the improvement is not overstated.

## 1. Audit coverage — before

Measured across **both** stores (`AuditTrail` + `SecurityEvent`), 18 auditable actions in scope
(2 more are N/A — no settings CRUD and no partner entity exist):

**13 of 18 covered (72%)** — with five genuine gaps:

| Gap | Action | State before |
| --- | --- | --- |
| 14 | 2FA enabled | `MFA_ENABLED` enum existed with **zero call sites** |
| 15 | 2FA disabled | `MFA_DISABLED` enum existed with **zero call sites** |
| 16 | Bulk session revocation (logout-all) | `revokeAll()` recorded **nothing** |
| 17 | Admin login | recorded, but **indistinguishable** from a player login |
| 18 | Game-configuration change | 12+ admin mutation endpoints, **no audit call** |

## 2. Audit coverage — after

**18 of 18 in-scope actions covered (100%).** Live database snapshot of the last 100 audit records:

```
admin_session: 17 · withdrawal_request: 24 · user: 34 · two_factor: 11
deposit_request: 10 · sessions: 4
```

Two actions remain **N/A, not missing**: settings-change (no settings CRUD exists in the product) and
partner-percentage change (no partner entity exists). Neither was fabricated to inflate coverage.

## 3. Exact audit actions now covered

Newly added this phase: **2FA enabled** · **2FA disabled** · **bulk session revocation** ·
**privileged (admin) login, distinctly** · **game-configuration create/update/delete**.

Each carries actor, actor roles, target, IP, user-agent, request id and timestamp, plus a
non-sensitive change set. Verified against the live database: the 2FA payload contains only
`{ method, enabled }` — **never** the TOTP secret or a recovery code.

The existing non-blocking contract is preserved: audit writes happen **after** the underlying
transaction commits and `AuditService` catches its own failures, so no audit write can alter a
security or financial outcome.

## 4. Admin 2FA status — **GENUINELY SERVER-ENFORCED**

`TwoFactorService` was already real (otplib TOTP, QR provisioning, SHA-256-hashed single-use recovery
codes, Redis-backed single-use challenge). **No crypto was written.** The gap was enforcement: 2FA was
opt-in, so an admin with `twoFactorEnabled = false` signed in with a password alone.

`AdminTwoFactorGuard` (global `APP_GUARD`) now refuses every `/admin/` API request while the calling
account lacks 2FA. Because login *already* forces the TOTP challenge for 2FA-enabled accounts, **every
successful admin API call is now backed by a session that provably passed a second factor.** The flag
is read from the **database** per request — a forged token claim or header changes nothing.

Live-proven end-to-end (19/19): blocked before enrolment → enrolment path stays open → wrong code
rejected → real TOTP enables → login becomes two-step → wrong OTP rejected → replay of the challenge
rejected → admin access restored → enrolment audited with no secret.

**Players are entirely unaffected** — the guard acts only on elevated roles, and only on admin routes.
The 2C.17 finding stands untouched: `admin` still does **not** hold `wallets:adjust`; only
`super_admin` does. That was not widened.

## 5. Idle-session status — **IMPLEMENTED, DISABLED BY DEFAULT (BUSINESS-CONFIG REQUIRED)**

`Session.lastActivityAt` already existed and was already maintained; it was simply never read.
Enforcement now lives in `SessionService.rotate()` — the single renewal point, already single-flight
on the client, so there is no rotation storm. An idle session is **revoked server-side** and the
refresh refused, which is the identical path a revoked session takes, so the frontend needed **no
change**. The check runs **before** any token is issued.

`SESSION_IDLE_TIMEOUT_MINUTES` defaults to **0 = disabled**. No timeout value was invented; with the
variable unset, behaviour is byte-for-byte what it was. Enabling it is a one-variable change.

Live-verified: disabled → a year-old session still refreshes; configured at 30 min → a 2-hour-idle
session is refused **and the row becomes `REVOKED`**, and cannot be resurrected; an active session
inside the window is unaffected.

## 6. Session-security status — one real defect found and fixed

**Attack test #16 exposed a pre-existing TOCTOU race in `rotate()`.** Six concurrent refreshes with
the *same* token all returned 200, minting six token families while only one row was marked `USED` —
**bypassing reuse detection**, the platform's anti-theft control.

Fixed by making the `ACTIVE → USED` transition a single conditional `updateMany`; losers fall into the
existing reuse path and the family is burned. After the fix: exactly one winner per trial, five 401s,
family revoked. Full before/after evidence in `PHASE_2D2_SECURITY_TESTS.md` §2.

Everything else re-verified intact: rotation, reuse detection, logout revocation, logout-all,
httpOnly cookie with no token in `localStorage`, rate limiting, and Phase 2C.15 demo isolation.

## 7. Attack-test results — **20/20 secure failures**

Authorization 6/6 · client-supplied values 6/6 (all hard **400**s via `forbidNonWhitelisted`) ·
session/token 5/5 · content/admin/demo 3/3. Full table in `PHASE_2D2_SECURITY_TESTS.md` §1.

## 8. Mobile results — 375×812 · 390×844 · 412×915

| Suite | Result |
| --- | --- |
| `p2d2-security.spec.ts` (new) | **5/5 at each of the three viewports** |
| `p2c17.spec.ts` (prior phase) | **4/4** — no regression with the now-two-step admin login |
| `p2d1-notifications.spec.ts` (prior phase) | **4/4** — no regression |

**Two real mobile defects found and fixed** on the 2FA challenge screen: the code input was under 44px
and the Verify button was **35px**. Both pinned to 48px. Same root cause as Phase 2D.1's bell — this
app's root font scale renders rem-based sizes below nominal.

Also verified: no dashboard flash before the second factor, no horizontal overflow, and logout settles
on `/login` **once** with no loop (the 2C.15 regression).

## 9. Financial regression — clean

| Invariant | Result |
| --- | --- |
| `GET /admin/wallet/reconcile` | `balanced: true`, **`difference: "0"`** |
| `SUM(DEBIT) − SUM(CREDIT)` | **0.000000000000000000** |
| Negative balances | **0** |
| Concurrency stress (100 same-key ops, 500 mixed) | **10/10** |
| Duplicate settlement / refund / deposit credit | none |

**Zero financial side effects.** No frozen financial file was touched.

## 10. Tests

| Suite | Before | After |
| --- | --- | --- |
| Backend (`RUN_DB_IT=1`) | 310 | **352 passed**, 46/47 suites, 0 failed |
| Backend stress (`RUN_STRESS=1`) | 10 | **10 passed** |
| Frontend | 834 | **834 passed / 65 files** |
| Mobile (this phase) | — | **15 passed** (5 × 3 viewports) |

**+42 backend tests.** Nothing skipped, disabled, weakened, or made to pass with fake data. No
throttle was relaxed — the attack harness *waits out* the real rate limiter instead.

### One pre-existing flake, proven independently

`game-money-plinko-mines.integration.spec.ts` → *"PLINKO: 10 real drops … wins & losses seen"* asserts
that 10 random plinko drops yield **at least one win**. Run five times in isolation with no code
change: **3 passed, 2 failed**. In the failing runs **every money invariant still passed** — the
per-drop `balanceAfter == balanceBefore − stake + payout` check, the non-negative check, and the final
reconcile. Only the statistical expectation failed.

It is a pre-existing statistical flake in a random-outcome game test, unrelated to this phase (the
suite touches no auth, audit, 2FA or session code). **I did not modify it** — loosening the assertion
would be weakening a test.

## 11–13. Typecheck · Lint · Builds

| Gate | Result |
| --- | --- |
| Backend typecheck | clean |
| Frontend typecheck | clean |
| Lint | **0 errors**, 3 pre-existing warnings (none from this phase) |
| Backend production build | success |
| Frontend production build | success, 93/93 static pages |

## 14. Frozen-surface audit

`wallet-engine/**`, `gaming-money/**`, `packages/database/prisma/**`: **zero files changed, no
migration.** No `PHASE_2D2_FROZEN_CHANGE_PROPOSAL.md` was needed — every change landed in `auth`,
`authorization`, `security`, `config`, admin controllers, or the frontend, exactly as the brief
preferred. `session.service.ts` is auth, not a frozen financial surface.

## 15. Secret audit

No OTP, TOTP secret, recovery code, token, password or payment credential is logged or persisted in
any audit record. The only credential-adjacent log lines are `'Password breach check failed'` (no
password) and `'Refresh token reuse detected'` with `userId` + `family` (a UUID grouping identifier).
Verified in the live database that the 2FA audit payload is `{ method, enabled }` only.

## 16. Demo-wallet audit

`useDemoWallet()` count on every security/account/money surface — `/settings/security`,
`/notifications`, `/wallet`, `/profile`, `/verification`, `/deposit`, `/withdraw`, `/game-history`,
`/transactions`, `admin-guard` — is **0**. Phase 2C.15 demo isolation intact.

## 17. Remaining limitations

1. **Idle timeout is disabled until the business supplies a value.** The mechanism is complete and
   tested; only the number is missing.
2. **Idle activity is tracked at rotation, not per request.** A deliberate trade-off (see
   `PHASE_2D2_IMPLEMENTATION.md` §C); granularity is bounded by the access-token lifetime.
3. **No CSRF token mechanism.** Still mitigated by bearer auth + `SameSite` refresh cookie; a
   dedicated token was out of scope and would need a documented design.
4. **Admin 2FA is enforced at the admin API boundary, not at login.** Deliberate — refusing login
   would lock out existing admins with no recovery path. The practical effect is identical: no admin
   function is reachable without a second factor.
5. **The seeded operator now has 2FA enabled** as a result of live testing. Any harness that logs in
   as `admin@money.local` must complete the challenge (the mobile specs now do, via inline TOTP).
6. **`admin` still lacks `wallets:adjust`**, so all cashier approvals remain super-admin-only. Not
   changed — that needs requirement evidence, not test convenience.

## 18. Client requirement coverage

| Requirement | Before | After |
| --- | --- | --- |
| Security — admin 2FA | YELLOW (optional) | **GREEN — server-enforced** |
| Audit logs — 2FA enable/disable | RED | **GREEN** |
| Audit logs — session revocation | RED | **GREEN** |
| Audit logs — admin login | RED | **GREEN** |
| Audit logs — game configuration change | RED | **GREEN** |
| Audit logs — overall | ~72% of in-scope actions | **100% of in-scope actions** |
| Security — automatic logout | RED | **BUSINESS-CONFIG REQUIRED** (mechanism complete, disabled) |
| Security — session management | GREEN | **GREEN, hardened** (concurrent-refresh race closed) |

**Overall client requirement coverage: 47.3% → 49.2%.**

Scored on the same 120-leaf basis as Phase 2C.18: Security moves 8×GREEN + 4×YELLOW + 1×RED + 2×E to
**10×GREEN + 2×YELLOW + 1×PURPLE + 2×E** (66.7% → 73.3%), and Compliance's audit row moves
YELLOW → GREEN (25% → 31.3%). The increase is small **by design** — this phase bought correctness and
enforcement, not surface area. I have not counted the concurrent-refresh fix as new coverage, because
it restored a control that was already claimed.

## 19. Next recommended phase

**Phase 2D.6 — Derivable Analytics & Admin Dashboard** (~1 week, no external dependency).
Aggregate revenue, average bet, most-played games, average deposit/withdrawal and conversion from the
real tables that already exist (`WalletTransaction`, `GameRound`, `DepositRequest`,
`WithdrawalRequest`, `User`), replacing the 501 stub and the placeholder dashboard. **Explicitly
exclude** DAU/MAU/retention/LTV and mark them blocked in the UI — there is still no event pipeline,
and fabricating them is not an option.

That converts ~7 leaf requirements and takes coverage to roughly **54%** with no third-party
dependency.
