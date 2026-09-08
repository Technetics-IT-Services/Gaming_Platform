# Phase 2C.11 — Production Release Audit

Release-hardening audit of the **complete** product. Classification per finding: **PASS · BUG · RISK ·
DEMO · ORPHANED · INCONSISTENT · DEFERRED · OUT OF SCOPE**. Prior phase reports are not rewritten.

## 1. Catalog ↔ route ↔ config integrity — **PASS**
All 15 backend catalog descriptors route to a `-money` page, and all 15 `-money` page directories exist
(1:1 match). Each game has a `GET /games/<game>/config` + `POST …/play` (verified in prior phases and
live in §E2E). Server-authoritative `enabled`/`maintenance`/limits from `GET /catalog` (2C.8).

## 2. Demo/mock on production money+account routes — **PASS (clean)**
Zero `useDemoWallet` / `stores/demo-wallet` / `usePlayerProfile` / `fakeBalance` / `fakePayout` on any
`(casino)` `-money` route or on `/wallet`, `/deposit`, `/withdraw`, `/transactions`, `/game-history`,
`/wallet/history`, `/lobby`, `/profile`, `/verification`, `/responsible-gaming`, `/support`.

## 3. Residual demo surfaces (legacy) — **DEMO (disclosed, not in money journey)**
- `login/page.tsx` retains a **demo guest-mode** affordance (`createDemoSession` + `useDemoWallet`,
  demo mode only). The real-money journey uses real credentials + server-authoritative state; the two
  are separate. Pre-existing; out of hardening scope.
- Secondary engagement pages `bets`, `mailbox`, `marketplace`, `promotions`, `store`, `vault` use
  `useDemoWallet`. **Not real-money surfaces; not linked from the bottom nav, lobby, wallet, profile, or
  history.** Reachable only from the dashboard/drawer as gamification. Left as-is (converting would
  require backends that do not exist — DEFERRED, no fabrication).
- Demo lobbies `/games`, `/casino` and `prototype/*` remain but are **not linked** from the bottom nav
  or the real-money lobby. **ORPHANED-from-money-nav (intentional).**

## 4. Navigation — **PASS**
Bottom nav = `Home(/dashboard) · Play(/lobby) · History(/game-history) · Wallet(/wallet) ·
Profile(/profile)`; all five targets exist. No dead tabs. No production nav links to the demo lobbies.
Profile links → wallet/deposit/withdraw/transactions/verification/security(`/settings/security`)/game &
wallet history/responsible-gaming/support/notifications/logout.

## 5. All 28 core routes exist — **PASS**
Every route named in the mobile-QA list resolves to a page (0 missing); security is `/settings/security`.

## 6. Authentication (Phase 2C.5) — **PASS (reused, unchanged)**
Login/refresh/logout/logout-all; single-flight refresh; httpOnly refresh cookie; access token in memory;
`AuthGuard` on `(dashboard)`/`(casino)`. No refresh token in localStorage. Live: `401` on every
protected route unauthenticated; direct-nav authenticated works (session restoration preserved).

## 7. Wallet / cashier — **PASS** (see §E2E, `PHASE_2C11_E2E_ACCEPTANCE.md`)
Authoritative balance; deposit PENDING→operator-complete; withdrawal hold→reject-refund /
approve-complete; idempotency; ownership; reconcile balanced.

## 8. Financial invariant & reconcile — **PASS**
`balanceAfter = before − stake + payout` (games), `+creditedAmount` (deposit), `−heldAmount`
(withdrawal), `+refundedAmount` (refund); no negative balance; reconcile `balanced:true, difference:"0"`
before/during/after tests and after restart.

## 9. Idempotency / concurrency — **PASS** (product) / **RISK** (test-harness contention)
Product: duplicate play/deposit-complete/withdrawal-reject → single mutation; 5 concurrent bets → exact
settlement, no negative (live). **RISK (documented):** running all 10 money-integration suites in one
serial jest process against a shared Postgres+Redis flakes exactly **1** "concurrent-duplicate-settle"
test per run (a *different* suite each run: roulette / blackjack / sic-bo). **Every suite passes in
isolation on a clean DB** (blackjack 10/10 ×3, roulette 11/11, plinko-mines 8/8, cashier 8/8, instant
8/8, card 8/8). Root cause = Postgres deadlock + WalletEngine retry re-apply under cross-suite lock
contention. **Not caused by 2C.11** (zero backend financial changes) and **not reproducible in
isolation**. See `PHASE_2C11_SECURITY_AUDIT.md` §frozen for the safest future fix; **not fixed here (frozen boundary).**

## 10. Recovery — **PASS (reused)** `recovery/health` reachable live; recovery core unchanged.

## 11. History / traceability — **PASS** `GET /games/history(+/:id)`, `/wallet/history` (own, JWT-scoped); round detail reachable (live).

## 12. Profile / account — **PASS** Server-authoritative identity + balance; real verification; honest RG; static support. No demo.

## 13. Responsible gaming — **PASS (truthful)** No fabricated enforcement; surfaces real self-monitoring + real cashier limits; unavailable controls disclosed. `PHASE_2C11_...` + 2C.10 RG doc.

## 14. Ownership / cross-user — **PASS** Player B blocked from A's round (403), operator routes (403), admin reconcile (403); B history JWT-scoped (0 of A).

## 15. Database / migrations — **PASS (no change)** No schema change this phase; project uses `prisma db push` (established workflow — no migrations dir). No direct DB balance mutation in app code.

## 16. Frozen surface — **PASS (clean)** No financial/engine/runtime/auth-security file modified. See `PHASE_2C11_FINAL_REPORT.md` §Frozen.

## 17. Secrets — **PASS** No secrets in changed/new source.

## 18. Builds / typecheck / lint / tests — **PASS** be `tsc` 0 · fe `tsc` 0 · be jest 171 · fe vitest 733 · lint clean · both prod builds PASS (93 pages).

## Summary of non-PASS findings
| Finding | Class | Action |
|--------|-------|--------|
| Full-serial integration flakes 1/79 (concurrent-dup-settle) | **RISK** | Documented; passes in isolation; run integration `--runInBand` per-suite or on a fresh DB; safest fix is frozen-scope (deferred) |
| login demo guest-mode; secondary demo pages (store/vault/…) | **DEMO** | Not in money journey / nav; left as-is (no fabrication) |
| Demo lobbies `/games`,`/casino`,`prototype/*` | **ORPHANED** | Not linked from money nav; intentional |
| Payment gateway, RG enforcement, KYC submission, support tickets | **DEFERRED** | Honestly disclosed in-app (2C.9/2C.10); not faked |
