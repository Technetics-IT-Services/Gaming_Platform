# Phase 2C.11 — Security Audit

## Server authority — **PASS**
- Identity is always `@CurrentUser('id')` (JWT) — never a client-supplied `userId`. Verified across
  games, cashier, catalog, account, verification.
- The client never supplies `payout / balance / result / multiplier / status / walletId / ledgerId /
  approval / netAmount` — DTOs use `whitelist + forbidNonWhitelisted` (verified live: forbidden fields
  and invalid inputs → **400**).
- Availability (`enabled`/`maintenance`) is server-controlled (`GET /catalog`, `CATALOG_DISABLED_GAMES`)
  — the client cannot unlock a disabled game; play-time validation is the final guard.

## AuthN / AuthZ — **PASS**
- Every protected route returns **401** unauthenticated (games, cashier, catalog, wallet, verification —
  verified live).
- Operator cashier + admin reconcile require `WALLETS_ADJUST`; a non-privileged player is **403**
  (verified live).
- httpOnly refresh cookie; access token in memory; single-flight refresh (2C.5). **No refresh token in
  localStorage** (auth store holds only user + in-memory access token).

## Ownership / cross-user isolation — **PASS** (verified live)
Player B, given Player A's identifiers, is denied:
- A's game round detail → **403**.
- Operator route (complete A's deposit) → **403**.
- Admin reconcile → **403**.
- Game/wallet history is JWT-scoped → B sees **none** of A's rows.

## Secrets — **PASS**
No passwords / JWT secrets / API keys / DB credentials / refresh tokens / server seeds / payment secrets
in changed or new source. The catalog and verification payloads expose only safe metadata (verified live
— no `serverSeed` / document URLs / provider refs). Server seeds are withheld while a round is live and
revealed only on settlement (existing provably-fair contract, unchanged).

## Frozen financial surface — **PASS (NONE modified)**
`git` tracked-modified files this release: `users.controller.ts` + `users.service.ts` (additive
read-only verification, 2C.10 — user-profile module, **not** the auth/session security core),
`wallet.controller.ts`/`wallet.module.ts` (cashier registration, 2C.9), and presentation pages
(`profile`, `deposit`, `withdraw`, `transactions`, `bottom-nav`). **Untouched:** game engines, runtime,
registry, wallet-core, `WalletEngineService`, ledger, treasury, settlement, `GameMoneyBridge`, recovery
core, auth/session security backend, Prisma financial schema. (`wallet-transaction.service.ts` shows
dirty but predates Phase 2C.6 — an unrelated wallet-history read enhancement, not a 2C.11 change.)

## RISK — concurrent-duplicate-settlement under shared-DB contention (frozen; not fixed)
**Defect:** in the **full serial integration run** (10 money suites, one jest process, shared
Postgres+Redis), exactly one "concurrent-duplicate settles once" test flakes per run (a *different*
suite each time), showing a transient **double-credit** (e.g. expected 190, received 210).
**Why frozen is involved:** the double-apply originates in `WalletEngineService.applyAvailableDelta`'s
deadlock **retry loop** re-running a settlement after a Postgres deadlock abort, combined with the
per-game `actionSeq`/reservation commit — all inside the **frozen** WalletEngine / GameMoneyBridge.
**Evidence it is contention, not a product bug:** every suite passes **in isolation on a clean DB**
(blackjack 10/10 ×3, roulette 11/11, plinko-mines 8/8, cashier 8/8, instant 8/8, card 8/8), and the live
E2E concurrency check (5 concurrent bets) settles exactly with no negative balance and a balanced ledger.
**Safest future fix (deferred):** make each interactive settlement idempotent against retry by keying the
commit on a stable idempotency key inside the retried transaction (so a deadlock-retry is a no-op replay,
not a re-apply), and/or run the settlement claim + commit in a single `SERIALIZABLE` transaction.
**Why not fixed in 2C.11:** it requires modifying the **frozen** WalletEngine/settlement path; per the
STOP rule this is documented, not bypassed. Operationally, run DB-integration suites **per-suite / on a
fresh DB** (they are green in isolation); this does not affect the live product behavior verified in the
E2E.

## Overall
Security posture is **PASS** for authentication, authorization, server authority, ownership isolation,
and secret hygiene. The single **RISK** is a documented frozen-path concurrency edge that manifests only
under pathological shared-DB test contention — disclosed, not hidden, not fixed within the frozen
boundary.
