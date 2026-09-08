# Phase 2D.2 — Security Test Results

All results are from **live execution** against the disposable stack (Postgres `gp_phase1_pg`:55432,
Redis :56379, backend :4100, production frontend :3100). Nothing here is inferred.

---

## 1. Attack tests (Phase M) — 20/20 secure failures

| # | Attack | Result | Verdict |
| --- | --- | --- | --- |
| 1 | Player → admin API (`GET /admin/users`) | **403** | PASS |
| 2 | Player → another player's session revoke | **403** | PASS |
| 3 | Player → another player's notifications | **404** | PASS |
| 4 | Player → another player's wallet history | **403** | PASS |
| 5 | Player → another player's game history | **404** | PASS |
| 6 | Player → another player's audit data | **403** | PASS |
| 7 | Client → fake `userId` in a withdrawal body | **400** | PASS |
| 8 | Client → fake `roles` in the body | **400** | PASS |
| 9 | Client → fake `permissions` in the body | **400** | PASS |
| 10 | Client → fake `balance` in the body | **400** | PASS |
| 11 | Client → fake `payout` on a game play | **400** | PASS |
| 12 | Client → forged `x-two-factor-verified` header on an admin API | **403** | PASS |
| 13 | Reuse an already-rotated refresh token | **401** | PASS |
| 14 | Refresh after logout | **401** | PASS |
| 15 | Refresh after logout-all | **401** | PASS |
| 16 | **Six concurrent refreshes with the same token** | **1 success, 5 × 401** | **PASS (after the fix below)** |
| 17 | Concurrent 2FA attempts on a bogus challenge | all **401/429** | PASS |
| 18 | Malformed/XSS query on notifications | **400** (`limit must not be greater than 100`) | PASS |
| 19 | Non-admin → `POST /admin/wallet/credit` | **403** | PASS |
| 20 | Unauthenticated → real-money API | **401** | PASS |

`whitelist + forbidNonWhitelisted` is what turns 7–11 into hard 400s: an unknown property is rejected
outright rather than silently ignored.

---

## 2. DEFECT FOUND AND FIXED — concurrent refresh defeated reuse detection

**Attack #16 failed on the first run.** This was a pre-existing defect, surfaced by this phase's own
attack testing.

### Evidence before the fix

Six simultaneous `POST /auth/refresh` calls presenting the **same** refresh token:

```
trial 1: codes=[200,200,200,200,200,200] ok=6 distinctAccessTokens=6 | refresh_tokens ACTIVE:8 USED:1
trial 2: codes=[200,200,200,200,200,200] ok=6 distinctAccessTokens=6 | refresh_tokens ACTIVE:14 USED:2
trial 3: codes=[200,200,200,200,200,200] ok=6 distinctAccessTokens=6 | refresh_tokens ACTIVE:20 USED:3
```

All six succeeded, minting six independent token families from one token, while only one row was
marked `USED`.

### Root cause

`SessionService.rotate()` read the token and checked `status !== ACTIVE` at the top, then wrote
`status: USED` at the bottom — separated by several `await`s (user lookup, RBAC resolution, token
issuance, persistence). A classic TOCTOU window: all six readers saw `ACTIVE` before any writer
committed.

### Impact

Reuse detection is the platform's anti-theft control: presenting an already-rotated token burns the
whole session family. An attacker holding a stolen refresh token could **race** it to obtain multiple
valid families **without ever tripping detection**. Legitimate clients were unaffected (the frontend
has single-flight refresh since Phase 2C.15), so this was a security-hardening gap, not a functional
bug.

### Fix

The `ACTIVE → USED` transition is now a single conditional `updateMany`. Exactly one caller can match
`status: ACTIVE`; every loser matches nothing, which is indistinguishable from presenting an
already-rotated token — and is therefore handled by the **same reuse path**, burning the family.

```ts
const claimed = await this.prisma.refreshToken.updateMany({
  where: { id: record.id, status: TokenStatus.ACTIVE },
  data:  { status: TokenStatus.USED },
});
if (claimed.count === 0) {
  await this.handleReuse(record.userId, record.family, record.sessionId, meta);
  throw new UnauthorizedException('Refresh token reuse detected. All sessions were revoked.');
}
```

### Evidence after the fix

```
trial 1: codes=[401,401,401,200,401,401] ok=1 distinctAccessTokens=1 | refresh_tokens ACTIVE:2 REVOKED:2
trial 2: codes=[401,401,200,401,401,401] ok=1 distinctAccessTokens=1 | refresh_tokens ACTIVE:2 REVOKED:4
trial 3: codes=[200,401,401,401,401,401] ok=1 distinctAccessTokens=1 | refresh_tokens ACTIVE:2 REVOKED:6
```

Exactly one winner per trial, losers refused, family revoked. `session.service.ts` is in the `auth`
layer — **not a frozen surface** — so no frozen-change proposal was required.

---

## 3. Admin 2FA — live enrolment and enforcement (19/19)

| Stage | Check | Result |
| --- | --- | --- |
| Before enrolment | `GET /admin/users` (admin without 2FA) | **403** |
| | `GET /admin/audit` | **403** |
| | `GET /auth/2fa/status` (enrolment path stays open) | **200** |
| | `GET /wallet-engine/balances` (player surface unaffected) | **200** |
| Self-enrolment | `POST /auth/2fa/setup` | **200** |
| | enable with a **wrong** code | **400 rejected** |
| | enable with a real TOTP | **200**, 10 recovery codes issued |
| After enrolment | login returns `requiresTwoFactor` | **true** |
| | login returns **no session** before the second factor | **true** |
| | verify with a **wrong** OTP | **401 rejected** |
| | verify with a real OTP | **200**, session issued |
| | **replay** of the challenge token | **401 rejected** |
| Access restored | `GET /admin/users` | **200** |
| | `GET /admin/audit` | **200** |
| Audit | `two_factor` record exists | yes |
| | `admin_session` record exists | yes |
| | audit contains **no TOTP secret** | confirmed |
| | audit contains **no recovery code** | confirmed |

The enforcement is genuine: `AdminTwoFactorGuard` reads `twoFactorEnabled` from the **database** on
every admin request. A forged `twoFactorEnabled` claim in the token or a forged header changes
nothing (attack #12).

---

## 4. Idle session — live and integration

| Check | Result |
| --- | --- |
| Disabled by default (`SESSION_IDLE_TIMEOUT_MINUTES=0`) — a year-old session still refreshes | **PASS** |
| Configured: a 2-hour-idle session with a 30-minute window is **refused** | **PASS** |
| …and the session row is **`REVOKED`** server-side, not merely refused | **PASS** |
| …and a second attempt cannot resurrect it | **PASS** |
| An active session inside the window is unaffected | **PASS** |
| A session with no recorded activity is not expired | **PASS** |
| Expiry payload carries no token, hash, secret or password | **PASS** |

The check runs **before** any token is issued, so an idle session never mints a credential on its way
to being refused.

---

## 5. Unchanged core guarantees (re-verified)

| Guarantee | Result |
| --- | --- |
| Refresh rotation issues a new token | PASS |
| Reuse of the original token burns the family | PASS |
| Logout revokes server-side; refresh afterwards 401s | PASS |
| Logout-all revokes every session | PASS |
| httpOnly refresh cookie; no token in `localStorage` | PASS (proven by the mobile logout test: clearing `localStorage` does **not** end the session — only removing the cookie does) |
| Rate limiting on register/login/2FA | PASS (the harness waits the throttle out rather than weakening it) |
| Demo isolation (Phase 2C.15) | PASS — `/notifications` and real-money paths remain in `DEMO_BLOCKED_PATHS` |

---

## 6. Secret audit

`grep -inE "console\.log|logger\.(info|warn|error)\(.*\b(otp|code|secret|token|password)\b"` across
`auth`, `authorization` and `security`:

- `password.service.ts:147` — `'Password breach check failed'` (no password logged)
- `session.service.ts:417` — `'Refresh token reuse detected'` with `userId` + `family` (a UUID
  grouping identifier, not a token)

**No OTP, TOTP secret, recovery code, token, password or payment credential is logged or stored in any
audit record.** Verified additionally in the database: the 2FA audit payload contains only
`{ method, enabled }`.

---

## 7. Mobile security UX (Phase H/Q)

`tests/mobile-cert/p2d2-security.spec.ts` — **5/5 at 375×812, 390×844, 412×915**:

- 2FA challenge renders, no dashboard flash before the second factor, no horizontal overflow
- Verify is disabled until 6 digits, then enabled
- a wrong code keeps the user on the challenge
- `/settings/security` renders with no overflow
- logout settles on `/login` **once**, with no loop (the Phase 2C.15 regression)
- a non-admin sees only the forbidden screen — no admin chrome

### Two real mobile defects found and fixed on the security screen

| Element | Measured | Fixed to |
| --- | --- | --- |
| 2FA code input | **under 44px** | `minHeight: 48` + larger centred text |
| Verify button | **35px** | `minHeight: 48` |

Both are the same root cause identified in Phase 2D.1: this app's root font scale renders rem-based
sizes below their nominal value. These are the controls standing between an operator and their
account, so they are pinned in explicit pixels.
