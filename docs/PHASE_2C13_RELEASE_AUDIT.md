# Phase 2C.13 — Release Audit (Step 1, no code changes)

Inventory of the production journey with backend dependency, auth requirement, financial impact, mobile
status, test coverage, known limitation, and release risk. Evidence for each certification is in the
later sections / `PHASE_2C13_FINAL_REPORT.md`.

## Environment capability (honest)
- **Playwright + Chromium (1228) present** → real **browser device-emulation** at 375/390/412 with
  screenshots is possible. **Physical-device testing is NOT available** here → reported as *pending*.
- Real Postgres (`gp_phase1` 55432) + Redis (56379) available for live financial verification.
- Production same-origin auth: `next.config.mjs` rewrites `/api/:path*` → `BACKEND_ORIGIN` (opt-in); real
  login on a production build (demo off) via `.env.production.local` `NEXT_PUBLIC_API_URL=/api/v1`.

## Core money-journey routes

| Route | Purpose | Backend dep | Auth | Financial | Mobile | Tests | Limitation / Risk |
|-------|---------|-------------|------|-----------|--------|-------|-------------------|
| `/login` | Auth entry | `/auth/login` | public | none | mobile-first | e2e(demo) + auth-session unit | demo guest-mode exists (demo-mode only) — LOW |
| `/lobby` | Real-money lobby | `/catalog`,`/wallet` | JWT | none | ✅ 2C.8 | catalog.test + build | none — LOW |
| `/dice-money`…`/teen-patti-money` (15) | Real-money play | `/games/<g>/config,play` | JWT | reserve→settle | ✅ 2C.6/7 | 15 integration + unit + parity | none — LOW |
| `/game-history` | Own rounds | `/games/history` | JWT | read | ✅ 2C.4 | game-history-api.test + integration | none — LOW |
| `/wallet` | Authoritative balance | `/wallet`,`/wallet-engine/balances` | JWT | read | ✅ | wallet-*.test | none — LOW |
| `/wallet/history` | Wallet txns | `/wallet/history` | JWT | read | ✅ 2C.4 | wallet-history-api.test | none — LOW |
| `/transactions` | Txn list | `/wallet/history` | JWT | read | ✅ 2C.9 (server-auth) | build | none — LOW |
| `/deposit` | Deposit request | `/cashier/deposits` | JWT | PENDING (no credit) | ✅ 2C.9 | cashier unit+integration+contract | no payment gateway (deferred, disclosed) — MED |
| `/withdraw` | Withdrawal request | `/cashier/withdrawals` | JWT | hold-on-request | ✅ 2C.9 | cashier unit+integration+contract | operator completion — LOW |
| `/profile` | Account center | `/auth/me`,`/wallet` | JWT | read | ✅ 2C.10 | account-api.test | none — LOW |
| `/settings/security` | Password/2FA/sessions | `/auth/*` | JWT | none | ✅ | e2e(demo) | none — LOW |
| `/verification` | Email/phone/KYC state | `/users/me/verification` | JWT | none | ✅ 2C.10 | users-verification.spec | KYC submission deferred (read-only, disclosed) — LOW |
| `/responsible-gaming` | Self-monitoring + limits | `/cashier/config` | JWT | none | ✅ 2C.10 | (page) | no enforcement (disclosed) — LOW |
| `/support` | FAQ + contact | none (static) | JWT | none | ✅ 2C.10 | (page) | no ticket backend (disclosed) — LOW |

## Operator (RBAC `WALLETS_ADJUST`)
`/admin/cashier/deposits/:id/{complete,reject}`, `/admin/cashier/withdrawals/:id/{approve,complete,reject}`,
`/admin/wallet/{credit,debit,reconcile}`. Non-admin → 403 (verified 2C.11).

## Navigation
Bottom nav (`md:hidden`, safe-area, ≥60px): `Home(/dashboard) · Play(/lobby) · History(/game-history) ·
Wallet(/wallet) · Profile(/profile)`. No production nav links to the demo lobbies (`/games`,`/casino`).

## Demo boundary (to re-verify)
Core journey demo-free (verified 2C.9–2C.11). Residual demo: login guest-mode (demo-mode only) + secondary
engagement pages (bets/mailbox/marketplace/promotions/store/vault) + demo lobbies — **not linked from the
money nav**. Re-audited in Step 15.

## Deferred (must remain honestly represented — not to be faked)
External payment provider · KYC submission · responsible-gaming enforcement · support tickets.

## Release-risk summary
No HIGH risks in the core money journey. One MEDIUM: deposits require operator completion (no payment
gateway) — honestly disclosed in-app; not a correctness blocker. Mobile physical-device testing pending
(emulation available). Certification proceeds against this map.
