# Phase 2C.10 — Pre-Implementation Audit (Player Account, Responsible Gaming & Support)

**Step 0 deliverable — audit only. No implementation code written.** This audit classifies every
account/security/RG/KYC/support/notification capability and defines a tight, honest, mostly-frontend
scope. No frozen surface is touched; no compliance is fabricated.

---

## 0. Headline findings

- **Account + Security backend is PRODUCTION and already frontend-wired** — the heavy lifting is done.
- **`/settings/security` is a PRODUCTION page** (change password + 2FA + sessions + devices, all on real
  `authApi`). Security/Sessions = **DONE** (reuse & link, do not rebuild).
- **`/profile` is a DEMO page** (`useDemoWallet` + `usePlayerProfile`) — must be replaced with a real
  mobile account center.
- **Responsible Gaming has NO backend models or enforcement** — STOP rule applies: **surface honestly,
  fake nothing.**
- **KYC models exist** (`KycVerification`, `Document`) but no player-facing read — a tiny additive
  read-only endpoint surfaces real state.
- **Support/tickets: NO backend** — build a static, honest help/contact page (no fake ticket system).
- **Notifications: PRODUCTION** (`GET /notifications`, mark-read) — link the existing page.

---

## 1. Capability matrix

| # | Capability | Backend | Frontend | Classification |
|---|-----------|---------|----------|----------------|
| 1 | Profile read | `GET /users/me`, `GET /auth/me` (id, email, username, displayName, avatarUrl, role, roles, status, emailVerified, createdAt) | `authApi.me()`; `/profile` is DEMO | **BACKEND READY / FE DEMO** |
| 2 | Profile update | `PATCH /users/me` (displayName, avatarUrl) | present | **PRODUCTION** |
| 3 | Change password | `POST /auth/change-password` (+ strength) | `/settings/security` | **PRODUCTION** |
| 4 | 2FA | `/auth/2fa/{setup,enable,disable,status,recovery-codes}` | `/settings/security` | **PRODUCTION** |
| 5 | Sessions | `GET /auth/sessions`, `DELETE /auth/sessions/:id`, `DELETE /auth/sessions` | `/settings/security` | **PRODUCTION** |
| 6 | Logout / logout-all | `/auth/logout`, `/auth/logout-all` | `authApi.logout/logoutAll` | **PRODUCTION** |
| 7 | Devices | `GET /auth/devices`, trust, delete | `/settings/security` | **PRODUCTION** |
| 8 | Login history / security events | `GET /auth/security/{login-history,events}` | partial | **BACKEND READY** |
| 9 | Email verification | `POST /auth/{verify-email,resend-verification}`; `emailVerified` on user | — | **BACKEND READY** |
| 10 | Phone verification | `phoneVerified`/`phoneNumber` on user | not surfaced | **BACKEND READY (read)** |
| 11 | KYC / identity | `KycVerification` (level, status, submitted/reviewed) + `Document`; admin-managed | no player read | **BACKEND MODEL ONLY** |
| 12 | Responsible gaming (limits/self-exclusion/cooling-off) | **none** (no models, no enforcement) | — | **MISSING (do not fake)** |
| 13 | Support / tickets | **none** | — | **MISSING** |
| 14 | Notifications | `GET /notifications`, `PATCH /notifications/:id/read` | `/notifications` page | **PRODUCTION** |
| 15 | Wallet / cashier / history | `/wallet*`, `/cashier*`, `/games/history` (2C.4/2C.9) | production | **PRODUCTION** |
| 16 | Session restoration | Phase 2C.5 (`auth-session`, single-flight refresh, httpOnly cookie) | production | **PRODUCTION** |

---

## 2. What to build (gaps only — additive, honest)

**Backend (one small additive read):**
- `GET /users/me/verification` — read-only: `{ email:{verified}, phone:{hasPhone, verified},
  identity:{ status, level } }` from `User` + latest `KycVerification`. Real state; no schema change; no
  enforcement claim.

**Frontend (the bulk — mobile-first, server-authoritative, no demo):**
1. **Rebuild `/profile`** as the mobile account center from `authApi.me()` + authoritative wallet
   balance. Sections → Wallet, Deposit/Withdraw (cashier), History, Personal details, Verification,
   Security (→ existing `/settings/security`), Responsible Gaming, Help/Support, Logout + Logout all.
   **Remove `useDemoWallet`/`usePlayerProfile`.**
2. **`/verification`** — real email/phone/KYC state from the new read endpoint. Honest labels; where KYC
   is not submitted, show "Identity verification is not currently available" (truthful).
3. **`/responsible-gaming`** — HONEST info page: self-monitoring via real transaction & game history,
   the platform deposit/withdrawal min/max (from `/cashier/config`), and a truthful statement that
   player-set limits / self-exclusion / cooling-off are **not currently available** (no enforcement
   exists). **No client-only limits, no fake compliance.**
4. **`/support`** — static help/contact page: FAQ (cashier/game/RG help), support email/phone from
   config/env (only if configured; otherwise a truthful "contact options coming soon"). **No fake ticket
   backend.**
5. Wire **logout / logout-all** through the existing `authApi` + 2C.5 session teardown.

---

## 3. Frozen-surface & safety posture

- No changes to game engines, runtime, registry, wallet-core, WalletEngine, ledger, treasury,
  settlement, GameMoneyBridge, recovery, or the Prisma financial schema.
- The only backend change is an **additive read-only** verification endpoint in the `users` module.
- Viewing profile/settings/RG/support/verification triggers **no money movement** — financial
  regression must show reconcile still balanced and no new ledger entries from account browsing.
- Server authority: all account data from the authenticated session (`@CurrentUser('id')`); no
  client-trusted identity/status/verification.

## 4. STOP-rule compliance (explicit)
- **Responsible gaming:** no server enforcement exists → surface honestly; implement **no** client-only
  limits and claim **no** self-exclusion/cooling-off enforcement.
- **KYC:** show **real** `KycVerification` state only; create **no** fake verified users; if not
  submitted, say so truthfully.
- **Support:** **no** fabricated ticket backend; static help + configured contact only.
- **Notifications:** reuse the real backend; add nothing fake.

## 5. Demo audit (to fix)
`/profile` imports `useDemoWallet` + `usePlayerProfile` — **must be removed** (money/account surface).
Other required surfaces (`/wallet`, `/cashier`, `/deposit`, `/withdraw`, `/transactions`,
`/game-history`, `/lobby`) are already demo-free (2C.8/2C.9). Unrelated demo pages left untouched.

## 6. Deadline-fit
Mostly frontend + one additive read endpoint. P0 = mobile profile, account info, security/session UX
(link the existing production page), honest RG surfacing, support/help, navigation, no demo. This fits
the window without inventing infrastructure.

**No implementation has begun.** The scope above is additive and honest; proceeding to implement the
confirmed gaps.
