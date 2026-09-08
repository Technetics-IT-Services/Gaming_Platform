# Phase 2D.2 — Audit before code

**No code written at the time of this document.** Companions: `PHASE_2D2_IMPLEMENTATION.md`,
`PHASE_2D2_SECURITY_TESTS.md`, `PHASE_2D2_FINAL_REPORT.md`.

---

## 0. Correction to my own Phase 2C.18 finding

Phase 2C.18 reported *"audit covers 4 of 9 required actions"*. **That figure was measured against only
one of the two audit systems in this repository, and therefore understated real coverage.**

There are **two independent, both-real audit stores**:

| Store | Service | Purpose | Reader |
| --- | --- | --- | --- |
| `AuditTrail` | `AuditService` | generic actor → action → entity with before/after `changes`, IP, UA | `GET /admin/audit` (permission-gated) |
| `SecurityEvent` | `SecurityEventService` | append-only authentication/security event log with severity | `/settings/security` (own events) + admin |

Login, logout and password change **were already recorded** — in `SecurityEvent`, not `AuditTrail`.
The corrected baseline is in §2. I am stating this plainly rather than quietly reporting a larger
improvement than was actually made.

---

## 1. Existing authentication architecture (verified, not assumed)

| Component | State | Verdict |
| --- | --- | --- |
| JWT access token | short-lived, memory-only on the client | **real** |
| Refresh token | httpOnly cookie, hashed at rest (`tokenHash @unique`), `family` column | **real** |
| Rotation | `SessionService.rotate` marks old `USED`, links `replacedById` | **real** |
| Reuse detection | `handleReuse` (line 315) burns the family + records a security event | **real** |
| Logout | `revoke` → server-side revocation + `SecurityEvent LOGOUT` | **real** |
| Logout-all | `revokeAll` → revokes every session | **real, but NOT recorded** ← gap |
| Concurrency cap | `enforceConcurrency` + `MAX_CONCURRENT_SESSIONS` (default 5) | **real** |
| Session model | `status`, `expiresAt`, `revokedAt`, **`lastActivityAt DateTime?`** | **real** |
| `lastActivityAt` maintenance | written on `start` (line 85) and on **every rotation** (line 177) | **already maintained** |
| Redis session mirror | `redisKey(sid)` fast-path with DB fallback in `isActive` | **real** |
| Rate limiting | global `ThrottlerGuard` + per-route `@Throttle` (login 10/60s, refresh 30/60s, 2FA 10/60s) | **real** |
| Cookie security | `httpOnly`, `SameSite`, `Secure` (the `Boolean('false')` bug was fixed in 2C.13) | **real** |
| Frontend | single-flight `refreshSession()`, retry-once 401 interceptor, demo isolation (2C.15) | **real** |

**Nothing in this architecture needs rebuilding.** No second session or token system will be created.

## 2. Audit coverage matrix — measured, both stores

| # | Required action | Where recorded today | Fields | Status |
| --- | --- | --- | --- | --- |
| 1 | User login (success) | `SecurityEvent LOGIN_SUCCESS` + `LoginHistory` | user, IP, UA, ts | **COVERED** |
| 2 | User login (failure) | `SecurityEvent LOGIN_FAILURE` ×2 sites | user, IP, UA, ts | **COVERED** |
| 3 | User logout | `SecurityEvent LOGOUT` | user, IP, UA, ts | **COVERED** |
| 4 | Password change | `SecurityEvent PASSWORD_CHANGE` (+ 2D.1 notification) | user, IP, UA | **COVERED** |
| 5 | Password reset req/complete | `SecurityEvent PASSWORD_RESET_*` | user, IP, UA | **COVERED** |
| 6 | Account lock / unlock | `SecurityEvent` + `AuditTrail` (admin path) | actor, target, IP | **COVERED** |
| 7 | Role assign / remove | `AuditTrail UPDATE entity=user_role` | actor, target, changes | **COVERED** |
| 8 | Admin revokes user sessions | `AuditTrail DELETE entity=sessions` | actor, target | **COVERED** |
| 9 | Manual verification | `AuditTrail APPROVE` | actor, target | **COVERED** |
| 10 | Registration | `AuditTrail CREATE entity=user` | user, IP | **COVERED** |
| 11 | Deposit complete / reject | `AuditTrail APPROVE/REJECT` (2C.17) | actor, roles, target, amount, ref, req-id, IP | **COVERED** |
| 12 | Withdrawal approve / reject / complete / escalation-refusal | `AuditTrail` (2C.17) | as above | **COVERED** |
| 13 | Refresh-token reuse detected | `SecurityEvent SUSPICIOUS_ACTIVITY` (line 326) | user, IP | **COVERED** |
| 14 | **2FA enabled** | **NOWHERE** — `MFA_ENABLED` enum exists, **zero call sites** | — | **GAP** |
| 15 | **2FA disabled** | **NOWHERE** — `MFA_DISABLED` enum exists, **zero call sites** | — | **GAP** |
| 16 | **Logout-all / bulk session revocation** | `revokeAll` records **nothing** | — | **GAP** |
| 17 | **Admin login (distinguished)** | recorded, but **indistinguishable from a player login** | — | **GAP** |
| 18 | **Game configuration change** | `admin-games` / `admin-catalog` — **no audit call** | — | **GAP** |
| 19 | Settings change | **no settings CRUD exists at all** | — | **N/A — nothing to audit** |
| 20 | Partner percentage change | **no partner entity exists** | — | **N/A** |

**Real, closeable gaps: 5** (#14, #15, #16, #17, #18). Everything else is either already covered or has
no source system to audit.

**Existing contract (to be followed, not changed):** `AuditService.record()` wraps its write in
`try/catch` and only logs a warning — audit is **non-blocking** and is always called *after* the
underlying transaction commits, so it can never alter a financial or security outcome.

## 3. Admin 2FA — infrastructure audit (Phase C)

`TwoFactorService` is **fully real** and must be reused, not rebuilt:

| Capability | Implementation |
| --- | --- |
| TOTP | `otplib` `authenticator` — real RFC-6238 |
| Provisioning | `generateSecret()` + `keyuri()` + QR data URL |
| Secret storage | `TwoFactorAuth.secret` (server-side; returned **once** at setup only) |
| Recovery codes | 10 codes, stored **only as SHA-256 digests**, consumed on use |
| Enable | verifies a live TOTP before enabling; sets `user.twoFactorEnabled` |
| Disable | requires a valid current code |
| Login challenge | opaque `challengeToken` in **Redis with a TTL**, deleted on success (single-use) |
| Failure handling | records `LOGIN_FAILURE` with MEDIUM severity |

**No new crypto is needed. No fake OTP. No plaintext secret. No OTP logging.**

**The gap:** enforcement. `AuthService.login` does `if (user.twoFactorEnabled)` — 2FA is entirely
**opt-in**. An `admin`/`super_admin` with `twoFactorEnabled = false` signs in with a password alone.

**Options considered:**

| Option | Verdict |
| --- | --- |
| Refuse admin login without 2FA | **rejected** — instantly locks out every existing admin, including the bootstrap super-admin; no recovery path |
| Add an `mfaVerified` flag to the Session/JWT | **rejected for this phase** — requires a schema or token-payload change; §5 shows it is unnecessary |
| **Refuse admin-scoped API access until the account has 2FA enabled** | **CHOSEN** |

Why the chosen option is genuinely server-enforced and sound: when `twoFactorEnabled` is true, the
existing login flow **already forces the TOTP challenge** — so any session belonging to a 2FA-enabled
admin has provably passed a second factor. Refusing admin endpoints while `twoFactorEnabled` is false
therefore means *every* successful admin API call is backed by a real second factor. It needs no
migration, no token change, leaves the enrolment path (`/auth/2fa/*`) open so an admin can self-remedy,
and **cannot affect players** because it is scoped to admin roles only.

## 4. Idle session — architecture audit (Phase D)

| Question | Finding |
| --- | --- |
| Does a session field exist? | **Yes — `Session.lastActivityAt DateTime?`, already in the schema** |
| Is it maintained? | **Yes** — set at `start()`, updated on **every rotation** (`rotate()` line 177) |
| Is it enforced anywhere? | **No** — never read for expiry |
| Is there an existing timeout config? | **No.** Related values exist (`ACCOUNT_LOCK_DURATION_MINUTES=15`, `MAX_CONCURRENT_SESSIONS=5`, `PASSWORD_RESET_TTL_MINUTES`) but nothing for idle |

**Design consequence — server-authoritative, no migration, no rotation storms.**

A client-side timer alone does not revoke anything and is explicitly insufficient. The correct
enforcement point is **`SessionService.rotate()`**: it is the single place a session is renewed, it is
already single-flight on the client, and `lastActivityAt` is already written there. If the gap between
now and `lastActivityAt` exceeds the configured idle window, the refresh is **refused and the session
is revoked server-side** — the same path a revoked session already takes, so the frontend's existing
401 → refresh-fails → `setUnauthenticated()` → `/login` flow handles it with **no frontend change and
no new redirect logic**.

This deliberately does **not** write `lastActivityAt` on every API request: that would add a database
write to every call for negligible security benefit, since access tokens are short-lived and an active
user rotates regularly.

**The timeout value is NOT invented.** No requirement or configuration exists, so following the
precedent this codebase already set in Phase 2C.17 for the large-withdrawal threshold, it ships as
`SESSION_IDLE_TIMEOUT_MINUTES` **defaulting to 0 = disabled**, marked **BUSINESS-CONFIG REQUIRED**.
With it unset, behaviour is byte-for-byte today's behaviour.

## 5. What will NOT be built, and why

| Not built | Reason |
| --- | --- |
| `mfaVerified` on the session/JWT | unnecessary — §3 achieves server enforcement without a schema or token change |
| Client-side idle timer | a timer alone revokes nothing; the server enforcement in §4 is the real control |
| New auth endpoints | `/auth/2fa/setup|enable|disable|status`, `/auth/logout`, `/auth/logout-all` and `/settings/security` already exist |
| Widening `wallets:adjust` to `admin` | 2C.17 finding stands; changing it needs requirement evidence, not test convenience |
| Player 2FA enforcement | the client requirement says **admin** 2FA; forcing players would be inventing policy |
| Settings-change audit | there is no settings CRUD to audit |

## 6. Risk register before coding

| Risk | Mitigation |
| --- | --- |
| Admin 2FA guard locks out the bootstrap super-admin | enrolment routes stay open; the guard covers admin **APIs**, not `/auth/*`; live-tested both ways |
| Idle expiry causes a refresh storm | enforced inside the existing single-flight `rotate()`; refusal is terminal, not retried |
| Idle expiry breaks demo sessions | demo sessions never refresh at all (2C.15) — unaffected |
| Audit writes slow a financial path | existing non-blocking contract, always after commit |
| Secret leakage into audit records | assertions in tests; TOTP secrets/backup codes never placed in any audit payload |
| Regression of 2C.15 demo isolation | explicit attack test #20 |

**No blocker. No migration required. No frozen surface required. Proceeding to implementation.**
