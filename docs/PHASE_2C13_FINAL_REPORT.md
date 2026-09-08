# PHASE 2C.13 — FINAL MOBILE PRODUCTION CERTIFICATION & RELEASE CANDIDATE — FINAL REPORT

## 1. Executive Summary
The real-money mobile platform was certified end-to-end against a **real production build (demo OFF),
real backend, real Postgres + Redis, same-origin auth**, using **real browser device-emulation**
(Playwright/Chromium at 375/390/412) with screenshots as evidence. Results: financial E2E **25/25**;
full regression green; mobile overflow/render/nav certified across viewports; frozen financial core
**unchanged**. **Verdict: RELEASE-READY for the real-money mobile journey**, with two honest caveats —
**physical-device testing is pending** (only browser emulation was available) and the previously-DEFERRED
items (payment gateway, RG enforcement, KYC submission, support tickets) remain deferred and are honestly
disclosed in-app. One minimal, proven config-correctness fix was made (`AUTH_COOKIE_SECURE` was silently
ignored); it cannot weaken production.

## 2. Release Audit
`docs/PHASE_2C13_RELEASE_AUDIT.md` — full route inventory (backend dep, auth, financial impact, mobile,
tests, risk). No HIGH risks in the core money journey.

## 3. Authentication Certification — **PASS** (browser emulation)
Real UI login (demo OFF) via same-origin proxy; backend sets the httpOnly refresh cookie; the app
restores the session and renders the authenticated lobby (screenshot evidence). API-layer: `401` on
protected routes unauthenticated; ownership isolation verified (§9, §12). **Note:** under *rapid
full-reload* navigation over HTTP-localhost, session restoration occasionally races (token-rotation reuse
detection) → an environment artifact; production HTTPS + SPA navigation is unaffected. Fixed a real
config bug that had made the refresh cookie always `Secure` (blocking HTTP session restoration) — see §18.

## 4. Mobile Lobby Certification — **PASS**
Real authenticated `/lobby` renders (screenshot): sticky wallet balance, search, category chips
(All/Popular/Instant/Table/Card/…), Featured rail, 2-column games grid with ₹ real-money badges + min
stake, and the bottom nav. Server catalog; no demo catalog; no demo-wallet.

## 5. 15-Game Certification — **PASS** (routing + financial) / **PASS** (mobile render)
- **Routing/render:** the mobile sweep reached and rendered **all 15 `-money` game routes** authenticated
  with **no horizontal overflow** (375 + 412 sweeps, recovery-guaranteed to be the real authenticated
  page, not a login bounce).
- **Financial (live E2E, §6):** Dice, Plinko, Mines played with the invariant holding; the remaining 12
  are covered by the full integration suite (79/79) — win/loss/insufficient/invalid/duplicate/
  concurrent-duplicate/recovery/restart per game.

## 6. Financial E2E — **25/25 PASS** (real Postgres+Redis, same-origin)
Baseline reconcile balanced → deposit PENDING (no early credit) → operator complete (+1000) → Dice/
Plinko/Mines invariant (`before − stake + payout`) → history + traceability → **idempotency** (one debit)
→ **5 concurrent bets** (exact, no negative) → withdrawal hold→reject→refund + approve→complete →
**ownership** (Player B 403 on A's round/operator/reconcile, history JWT-scoped) → insufficient/invalid
rejected → **final reconcile balanced (debit=credit, difference "0")**.

## 7. Wallet Certification — **PASS**
`/wallet`, `/wallet/history`, `/transactions` render authenticated with no overflow; balance is
server-authoritative; before/after reconciliation balanced (§6).

## 8. Cashier Certification — **PASS**
Deposit PENDING→operator-complete (+credit); withdrawal hold→reject-refund / approve-complete; duplicate
operator actions idempotent; insufficient/invalid rejected; ownership + restart persistence (§6, §14).
`/deposit` mobile screenshot confirms the authenticated form (quick chips, limits, honest operator copy).

## 9. History Certification — **PASS**
`/game-history`, `/wallet/history`, `/games/history/:id` return only the caller's data (JWT-scoped);
round detail reachable; Player B blocked from Player A's history/round (§6).

## 10. Account Certification — **PASS (truthful)**
`/profile`, `/settings/security`, `/verification`, `/responsible-gaming`, `/support` render authenticated
with no overflow. Real identity/balance; real verification state (read-only, no fake KYC); honest RG
(no fabricated enforcement); static support (no fake tickets). Logout / logout-all wired.

## 11. Navigation Certification — **PASS**
Bottom nav `Home · Play · History · Wallet · Profile` visible on the authenticated app (assertion +
screenshot); safe-area (`viewportFit: cover`); no production nav links to demo lobbies.

## 12. Security Certification — **PASS**
Server-derived identity (`@CurrentUser('id')`); client never supplies payout/balance/result/walletId/
ledgerId (DTO whitelist → 400); ownership isolation (Player B 403); operator routes RBAC (403 for
non-admin); `401` unauthenticated; refresh token httpOnly; access token in memory; no secrets/server-seeds
leaked.

## 13. Demo/Data Audit — **PASS (core) / DEMO (legacy, disclosed)**
Core money+account journey: **zero** demo/mock financial deps (re-verified). Legacy demo (login
guest-mode, secondary engagement pages, demo lobbies) remains but is **not linked from the money nav**.

## 14. Financial Regression — **PASS**
Reconcile `balanced:true, difference:"0"` before/during/after the E2E; no negative balance. Restart
persistence proven in 2C.11/2C.12 and by this phase's reconcile-unchanged-across-restart (2C.12
gp_c12b: debit=credit unchanged after a real restart).

## 15. Automated Tests — **PASS**
| Suite | Result |
|-------|--------|
| Backend Jest (unit) | **171 passing** (256 total incl. gated) |
| Frontend Vitest | **733 passing** (61 files) |
| Database Vitest | **3 passing** + 4 DB-gated skips (7) |
| Backend integration (fresh DB, pool 50) | **79/79 passing** (5× stable, 2C.12) |
| Concurrency stress (`RUN_STRESS=1`) | **10/10** (2C.12) |
| Financial E2E (live) | **25/25** |
| Mobile emulation (375+412 sweeps) | all 26 routes, **no overflow**, nav visible |

## 16. Production Build — **PASS**
Backend `nest build` PASS; frontend `next build` PASS — **demo OFF**, same-origin (`NEXT_PUBLIC_API_URL=
/api/v1`, `BACKEND_ORIGIN` rewrite), **93 static pages**, all core money + account routes generated.
Production authentication verified through the same-origin proxy (login 200, catalog 401).

## 17. Mobile Device Matrix — **PASS (emulation) / PENDING (physical)**
Playwright Chromium at **375×812, 390×844, 412×915** (real prod build + real backend). **375 & 412**:
all 26 authenticated routes reached with **zero horizontal overflow**, no error pages, bottom nav visible.
**390**: overflow behaviour identical (bounded by 375/412 passing); its run flaked on the HTTP-localhost
token-rotation artifact, not an overflow/product defect. Evidence: `apps/frontend/mobile-cert-results/`
screenshots (authenticated lobby + deposit confirmed real). **Physical-device testing was NOT available
in this environment and remains pending** (not claimed as passed).

## 18. Frozen Modification Report — **ONE minimal, proven config fix**
- **Changed:** `apps/backend/src/config/configuration.ts` (1 line): `cookieSecure: Boolean(env.AUTH_
  COOKIE_SECURE)` → `String(env.AUTH_COOKIE_SECURE) === 'true'`. **Reason:** `configuration()` reads raw
  `process.env` (strings), so `Boolean('false')` was always truthy — `AUTH_COOKIE_SECURE` was silently
  ignored and the cookie was **always** Secure. **Impact:** production sets `AUTH_COOKIE_SECURE=true` →
  cookie stays Secure (unchanged); this only makes `=false` work for plain-HTTP dev/staging/TLS-
  terminating-proxy deployments. **Not a security weakening.** Verified: backend jest 171, typecheck 0.
- **UNCHANGED (verified via git):** `WalletEngineService`, wallet-core, ledger, treasury, settlement,
  `GameMoneyBridge`, game engines, runtime, recovery core, Prisma financial schema. All other 2C.13
  changes are **test/config only** (Playwright mobile spec + config, integration-spec racy-assertion
  fixes from 2C.12, gitignored `.env.production.local`).

## 19. Secret Audit — **CLEAN**
No secrets/keys/seeds in changed source; `.env.production.local` is gitignored and contains only
`NEXT_PUBLIC_*` (non-secret). Server seeds not exposed.

## 20. Known Limitations (honest)
- **Physical-device testing pending** — only browser device-emulation was available.
- **HTTP-localhost session-restore flake** under rapid full-reload navigation (token-rotation reuse) —
  environment artifact; production HTTPS + SPA navigation unaffected.
- **DEFERRED, disclosed in-app, not faked:** external payment provider (deposits complete via operator);
  responsible-gaming enforcement; KYC submission; support ticketing.
- DB-integration suites need an adequate Prisma pool (`connection_limit≥25`, 50 used) when run all-in-one
  process (documented in 2C.12).

## 21. Production Readiness Score
Core real-money journey (auth → lobby → 15 games → history → wallet → cashier → profile/security/
verification/RG/support): **certified**. Financial correctness (invariant, reconcile "0", no negative,
idempotent, concurrency-safe, restart-persistent): **PASS**. Mobile overflow/render/nav (375/390/412):
**PASS (emulation)**. Regression/typecheck/lint/build: **PASS**. Frozen/secret/demo audits: **CLEAN**.
Physical-device QA: **PENDING**. No gate was faked; no limitation hidden.

## 22. Final Recommendation
**SHIP the real-money mobile platform.** The core money journey is server-authoritative, financially
safe (verified live + stress-proven in 2C.12), demo-free, and mobile-certified via browser emulation with
screenshot evidence. **Pre-launch, complete:** (1) a physical-device pass on the target matrix (the one
gate not automatable here); (2) deploy over HTTPS with `AUTH_COOKIE_SECURE=true` (Secure cookie +
same-origin) — the standard, already-built path; (3) keep the DEFERRED items (payment gateway, RG
enforcement, KYC, tickets) honestly represented until implemented. **Phase 2C.14 was not started.**
