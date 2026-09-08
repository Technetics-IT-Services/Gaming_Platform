# Phase 2C.10 — Account Architecture

A mobile-first player account center built almost entirely by **reusing** the production
account/security/session backend. One additive read-only endpoint was added; no frozen surface changed.

## 1. Reused production backend (no change)

- **Profile:** `GET /users/me`, `GET /auth/me` → `AuthUserView` (id, email, username, displayName,
  avatarUrl, role, roles, permissions, status, emailVerified, twoFactorEnabled, createdAt, lastLoginAt);
  `PATCH /users/me` (displayName, avatarUrl).
- **Security (already a production page at `/settings/security`):** `POST /auth/change-password`
  (+ strength); 2FA `/auth/2fa/{setup,enable,disable,status,recovery-codes}`; sessions `GET /auth/sessions`,
  `DELETE /auth/sessions/:id`, `DELETE /auth/sessions`; devices `GET /auth/devices` …
- **Logout:** `POST /auth/logout`, `POST /auth/logout-all` (frontend `authApi.logout/logoutAll` +
  Phase 2C.5 `logoutSession`).
- **Notifications:** `GET /notifications`, `PATCH /notifications/:id/read` (existing `/notifications` page).
- **Wallet / cashier / history:** `/wallet*`, `/cashier*`, `/games/history` (2C.4/2C.9).
- **Session restoration:** Phase 2C.5 (`auth-session` single-flight refresh, httpOnly cookie, auth
  store) — unchanged; direct navigation to account routes does not cause a login flash.

## 2. Additive backend (the only new endpoint)

`GET /users/me/verification` (in the `users` module — additive read-only method
`UsersService.verification`): returns **real state only** —
`{ email:{verified}, phone:{hasPhone, verified}, identity:{available, status, level, submittedAt,
reviewedAt} }` from the `User` flags + the latest `KycVerification` row. When no KYC record exists,
`identity.available = false` (truthful). No schema change; no enforcement/compliance claimed; exposes
only safe status fields (no document URLs / provider refs / secrets — verified live).

## 3. Frontend account center

- **`/profile`** (rebuilt, replaces the demo page) — mobile-first: identity header (from `authApi.me`
  via the auth store), authoritative wallet snapshot (`getMainWallet`), Deposit/Withdraw/Transactions
  quick actions, and grouped rows → Personal details, Verification, Security (→ `/settings/security`),
  Game history, Wallet history, Responsible gaming, Help & support, Notifications, Log out, Log out all.
  **No demo wallet / demo profile.**
- **`/verification`** — `getVerification()`; email/phone/identity with honest badges.
- **`/responsible-gaming`** — honest self-monitoring + real cashier limits; see
  `PHASE_2C10_RESPONSIBLE_GAMING.md`.
- **`/support`** — static FAQ + configured contact (no fake tickets).
- `components/account/AccountRow` — shared compact mobile row (link/button).

## 4. Server authority & security

Identity always from the authenticated session (`@CurrentUser('id')` / auth store); the client never
supplies id/email/status/role/verification. Logout tears the session down via the existing 2C.5 flow.
No passwords/refresh tokens in frontend state (unchanged). The account browsing path is **read-only** —
it moves no money (financial regression verified: reconcile unchanged, difference "0").

## 5. Frozen posture

No game engine, runtime, registry, wallet-core, WalletEngine, ledger, treasury, settlement,
GameMoneyBridge, recovery, auth/session security core, or financial schema change. The `users` module
gained one additive read-only method + route.
