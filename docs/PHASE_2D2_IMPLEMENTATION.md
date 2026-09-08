# Phase 2D.2 — Implementation

Companions: `PHASE_2D2_AUDIT.md` (Phase A) · `PHASE_2D2_SECURITY_TESTS.md` ·
`PHASE_2D2_FINAL_REPORT.md`.

**No Prisma migration. No frozen-surface change. No new dependency. No second session/token system.**

---

## A. Audit completion (Phase B) — 5 gaps closed

The Phase A audit corrected my own Phase 2C.18 figure: this repository has **two** audit stores
(`AuditTrail` via `AuditService`, and `SecurityEvent` via `SecurityEventService`), and login/logout/
password-change were already recorded in the second one. Only **five** genuine gaps remained.

### Gaps 14 & 15 — 2FA enable / disable were recorded NOWHERE

`MFA_ENABLED` and `MFA_DISABLED` existed in the enum with **zero call sites**.
`two-factor.service.ts` now writes to **both** stores after the change commits:

```ts
private async recordMfaChange(userId, enabled, meta) {
  await this.security.record({ userId, type: enabled ? MFA_ENABLED : MFA_DISABLED,
                               severity: HIGH, description: ..., meta });
  await this.audit.record({ userId, action: UPDATE, entityType: 'two_factor',
                            entityId: userId, changes: { method: 'TOTP', enabled }, meta });
}
```

`changes` carries **only** `{ method, enabled }` — never the TOTP secret and never a recovery code
(asserted in the integration suite against the live database).

### Gap 16 — bulk session revocation was silent

`SessionService.revokeAll()` (the "log out everywhere" and post-password-change path) recorded
nothing. It now records to both stores — **only when something was actually revoked**, so a no-op
produces no audit noise. `meta` is threaded through `AuthService.logoutAll()` and the controller so
the action is attributable to an IP and user-agent.

### Gap 17 — an admin login was indistinguishable from a player login

Both produced a bare `LOGIN_SUCCESS`. `completeLogin` now derives elevation from the resolved roles
and, for a privileged sign-in, additionally writes `AuditAction.LOGIN` on `entityType:
'admin_session'` with the roles that made it privileged. A player login writes **no** such record
(explicitly tested).

### Gap 18 — game-configuration changes were unaudited

`admin-games` and `admin-catalog` expose 12+ mutation endpoints across several services. Rather than
12 scattered call sites, one narrow interceptor covers them uniformly:

`security/audit-mutation.interceptor.ts` + `@AuditEntity('game')` / `@AuditEntity('game_catalog')`

Scope is deliberately tight so it cannot become noise: **only** POST/PUT/PATCH/DELETE, **only** on
annotated controllers, **only** on success. It records actor, roles, method, route, target id, request
id, IP and UA — and never the request body, which could carry secrets.

### Not closed, with reasons

| Item | Reason |
| --- | --- |
| Settings-change audit | **there is no settings CRUD in the product** — nothing to audit |
| Partner percentage change | no partner entity exists |

## B. Admin 2FA (Phase C) — server-enforced, no migration

`TwoFactorService` was already fully real (otplib TOTP, QR provisioning, SHA-256-hashed single-use
recovery codes, Redis-backed single-use login challenge). **Nothing about the crypto was rebuilt.**
The gap was purely enforcement: `login()` did `if (user.twoFactorEnabled)` — 2FA was opt-in.

`authorization/guards/admin-two-factor.guard.ts`, registered as a global `APP_GUARD`:

```
unauthenticated            → pass (JwtAuthGuard's job)
not admin/super_admin      → pass (players are never affected)
not an /admin/ route       → pass (enrolment + player surfaces stay open)
twoFactorEnabled === false → 403 with a remediation message
```

**Why this is genuinely enforced:** when `twoFactorEnabled` is true the existing login flow *already*
forces the TOTP challenge, so any session belonging to a 2FA-enabled admin has provably passed a
second factor. Refusing admin APIs while the flag is false therefore means **every successful admin
API call is backed by a real second factor**. The flag is read **from the database** on each admin
request — a forged token claim or header changes nothing (attack test #12).

**Why not refuse admin login outright:** that would instantly lock out every existing admin, including
the bootstrap super-admin, with no recovery path. Refusing at the API boundary leaves
`/auth/2fa/setup|enable` reachable so an admin can self-enrol — proven live end-to-end.

**Why path-scoped rather than per-controller:** a future admin controller cannot forget the
requirement. It fails closed for anything under the admin prefix.

## C. Idle session (Phase D) — server-authoritative, no migration

`Session.lastActivityAt` already existed **and was already maintained** (written at session start and
on every rotation). It was simply never read for expiry.

Enforcement lives in `SessionService.rotate()` — the single place a session is renewed, already
single-flight on the client, so there is no rotation storm:

```ts
await this.assertNotIdle(sessionId, user.id, meta);   // BEFORE anything is issued
```

When the idle window is exceeded the session is **revoked server-side** and the refresh refused —
the identical path an already-revoked session takes, so the frontend's existing
`401 → refresh fails → unauthenticated → /login` flow handles it with **no frontend change**.

`lastActivityAt` is deliberately **not** written on every API request: that would add a database write
to every call for negligible benefit, since access tokens are short-lived and an active user rotates
regularly.

**The timeout value is not invented.** `SESSION_IDLE_TIMEOUT_MINUTES` defaults to **0 = disabled**,
following the precedent this codebase set in Phase 2C.17 for the large-withdrawal threshold. With it
unset, behaviour is byte-for-byte what it was. Marked **BUSINESS-CONFIG REQUIRED**.

## D. Concurrent-refresh race (found by Phase M, fixed)

Attack test #16 exposed a pre-existing TOCTOU in `rotate()`: six concurrent refreshes with the same
token all succeeded, minting six token families and bypassing reuse detection. The `ACTIVE → USED`
transition is now a single conditional `updateMany`; losers fall into the existing reuse path and the
family is burned. Full evidence in `PHASE_2D2_SECURITY_TESTS.md` §2.

## E. Mobile security UX (Phases H/Q)

Two real defects found by measurement on the 2FA challenge screen and fixed:

| Element | Was | Now |
| --- | --- | --- |
| 2FA code input | under 44px | `minHeight: 48`, 18px centred, letter-spaced |
| Verify button | 35px | `minHeight: 48` |
| "Back to sign in" | small | `minHeight: 44` |

Same root cause as Phase 2D.1's bell: the app's root font scale renders rem-based sizes below nominal.

The mobile cert login helpers in `p2c17.spec.ts` and `p2d1-notifications.spec.ts` are now 2FA-aware,
with **RFC-6238 TOTP computed inline via `node:crypto`** — no dependency was added to the frontend.
(`isVisible()` does not auto-wait; the helper uses `waitFor({state:'visible'})`, which is what made
the first attempt silently skip the second factor.)

---

## Files changed — 17

**New (5)**
`authorization/guards/admin-two-factor.guard.ts` · `authorization/guards/admin-two-factor.guard.spec.ts` ·
`security/audit-mutation.interceptor.ts` · `security/security-hardening.integration.spec.ts` ·
`auth/services/session-idle.spec.ts`

**Backend modified (9)**
`auth/services/two-factor.service.ts` (MFA audit) · `auth/controllers/two-factor.controller.ts` (meta) ·
`auth/services/session.service.ts` (revokeAll audit, idle expiry, atomic rotation claim) ·
`auth/auth.service.ts` (privileged-login audit, meta threading) · `auth/auth.controller.ts` (logout-all meta) ·
`auth/auth.module.ts` · `app.module.ts` (guard registration) ·
`games/controllers/admin-games.controller.ts` + `admin-catalog.controller.ts` (audit interceptor) ·
`config/env.validation.ts` + `config/configuration.ts` (idle timeout)

**Frontend modified (3)**
`app/(auth)/login/page.tsx` (2FA touch targets) ·
`tests/mobile-cert/p2c17.spec.ts` + `p2d1-notifications.spec.ts` (2FA-aware login)

**Frontend new (1)** `tests/mobile-cert/p2d2-security.spec.ts`

**Also updated** `notifications.service.spec.ts` (two strict-null assertions).

**Untouched:** WalletEngine, wallet-core, ledger, settlement, GameMoneyBridge, game engines,
provably-fair engines, runtime, game registry, financial schemas, Prisma schema.
