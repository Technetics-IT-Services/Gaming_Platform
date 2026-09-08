# Phase 2C.9 — Pre-Implementation Audit (Mobile Cashier, Wallet UX & Financial Experience)

**Step 0 deliverable — audit only. No implementation code written.** This audit determines exactly what
wallet/cashier functionality already exists (production / partial / demo / orphaned) and defines the
smallest production-shaped scope. No frozen surface is touched.

---

## 0. Headline finding

- **Wallet READ APIs are production** (Phase 2C.4): server-authoritative balance, summary, and history.
- **Deposit/Withdrawal DATA MODEL is fully built but ORPHANED**: `DepositRequest`, `WithdrawalRequest`,
  `PaymentGateway`, `PaymentMethod`, `Refund` exist in Prisma with rich status machines — but **no
  service creates them** (only AI fraud/risk services *read* aggregates). There is **no player-facing
  deposit/withdrawal endpoint or service**.
- **Deposit/Withdraw FRONTEND is demo-only and violates the demo-wallet rule**: `/deposit` and
  `/withdraw` import `useDemoWallet` and mutate a client-side fake balance ("Demo confirmation, no
  backend").

So the cashier is **genuinely missing** (model-only). The STOP condition "already satisfies" does **not**
apply. The scope is: build the smallest **server-authoritative** deposit/withdrawal cashier on the
existing models + `WalletEngineService`, plus a real mobile wallet, and **remove the demo-wallet
dependency from the money surfaces**.

---

## 1. Current-state matrix

| Area | Backend | Frontend | State |
|------|---------|----------|-------|
| Wallet balance | `GET /wallet` + `/wallet-engine/balances` (authoritative) | `walletApi.balances` on `/wallet` page | **PRODUCTION** |
| Wallet summary | `GET /wallet/summary` | used | **PRODUCTION** |
| Wallet history | `GET /wallet/history` (2C.4, stored balanceBefore/After) | `walletApi.history` | **PRODUCTION** |
| Game history | `GET /games/history(+/:id)` (2C.4) | `gameHistoryApi` | **PRODUCTION** |
| Deposit | ❌ none (model `DepositRequest` orphaned) | `/deposit` uses `useDemoWallet` (fake) | **DEMO-ONLY / MISSING** |
| Withdrawal | ❌ none (model `WithdrawalRequest` orphaned) | `/withdraw` uses `useDemoWallet` (fake) | **DEMO-ONLY / MISSING** |
| Payment gateway | model `PaymentGateway`/`PaymentMethod` exist; no integration | — | **MODEL-ONLY** |
| Admin approval | `admin/wallet` has credit/debit/freeze/rollback; **no deposit/withdraw approval** | — | **PARTIAL** |
| Wallet page `/wallet` | authoritative balance queries + realtime socket | mixes real balance + cosmetic "demo insights" | **MOSTLY PRODUCTION** (balance is real) |

## 2. Existing APIs (reuse)

- `GET /wallet`, `GET /wallet/summary`, `GET /wallet/history`, `GET /wallet/:currencyId`
  (`wallet.controller.ts`).
- `GET /wallet-engine/balances`, `POST /admin/wallet/{credit,debit,freeze,unfreeze,rollback}`
  (RBAC `WALLETS_ADJUST`).
- `GET /games/history`, `GET /games/history/:roundId` (traceability).

## 3. Existing database models (reuse — no schema change needed)

- `DepositRequest` — `status DepositStatus{PENDING,PROCESSING,COMPLETED,FAILED,CANCELLED,EXPIRED}`,
  `amount/fee/netAmount`, `reference` (unique, idempotency anchor), `transactionId` → `WalletTransaction`,
  `completedAt`, `metadata`, `Refund[]`.
- `WithdrawalRequest` — `status WithdrawalStatus{PENDING,UNDER_REVIEW,APPROVED,PROCESSING,COMPLETED,
  REJECTED,CANCELLED,FAILED}`, `amount/fee/netAmount`, `reference`, `transactionId`, `reviewedById` →
  `AdminUser`, `approvedAt`, `rejectionReason`.
- `PaymentGateway`, `PaymentMethod`, `Refund`, `RefundStatus`.

## 4. Existing financial services (reuse — frozen, called not modified)

- `WalletEngineService.credit(userId, currencyId, {amount, typeCode, description?, idempotencyKey}, type?)`
  and `.debit(...)` — the authoritative money movers. `debit` enforces non-negative available balance;
  both are idempotent by `idempotencyKey` and write balanced ledger entries.
- `WalletEngineService.getOrCreateWallet/getWallets`, `WalletTransactionService`, ledger, reconcile.
- Transaction type codes `DEPOSIT`, `WITHDRAWAL`, `REFUND` exist (`packages/wallet-core` +
  `packages/types` enums; used by reporting) — reuse for cashier movements.

## 5. Existing frontend surfaces

- `/wallet` page: authoritative balance (`walletApi.balances`), transactions, bonus/reward, realtime
  socket. Cosmetic "demo economy insights" are decorative (not the balance). Reusable base.
- `/deposit`, `/withdraw`: **demo-wallet fakes** — must be replaced with server-authoritative flows.
- `wallet-api.ts`: balances/summary/history/bonus/reward — **no deposit/withdraw methods** (to add).
- `stores/demo-wallet.ts`: demo store — must NOT be referenced by production money surfaces.

## 6. Demo boundaries

- Real: balance, summary, history, game history (all server-authoritative).
- Demo: `/deposit`, `/withdraw` (fake `useDemoWallet`), some `/wallet` "insights" cosmetics, the demo
  lobbies (out of scope).

## 7. Missing production functionality (the P0 build)

1. Player deposit request (PENDING; **no fake credit** — no payment gateway).
2. Player withdrawal request (server-authoritative; validate + **hold funds**; idempotent).
3. List/read own deposits & withdrawals.
4. Operator transitions to make the state machine **real & testable** (deposit complete/reject;
   withdrawal approve/complete/reject) reusing `WalletEngineService` + `WALLETS_ADJUST` RBAC.
5. Mobile wallet UI wired to real APIs (balance, quick actions, recent activity linked to history,
   responsible-gaming links) — no demo wallet.

## 8. Security gaps

- `/deposit` & `/withdraw` are client-side fakes (no auth-backed money movement) — **replace**.
- Ensure new endpoints: `@CurrentUser('id')` identity, DTO whitelist, idempotency, server-derived
  amounts/status, no client-controlled balance/approval, ownership checks on list/read.

## 9. Mobile UX gaps

- No production mobile cashier; `/wallet` can be tightened for one-hand use (sticky balance, big
  Deposit/Withdraw, compact activity cards, no desktop tables).

## 10. Exact implementation scope (additive, no frozen change, no schema change)

**Backend — new `cashier` service + player controller under `/wallet`:**
- `POST /wallet/deposits` → create `DepositRequest` PENDING (idempotent by `reference`/idempotencyKey);
  **does not credit**. Returns pending request.
- `GET /wallet/deposits`, `GET /wallet/deposits/:id` (own only).
- `POST /wallet/withdrawals` → validate active user + currency + amount + min/max + available balance;
  **hold via `engine.debit(WITHDRAWAL)`** (prevents double-spend, keeps balance authoritative);
  create `WithdrawalRequest` UNDER_REVIEW with `transactionId`; idempotent.
- `GET /wallet/withdrawals`, `GET /wallet/withdrawals/:id`, `POST /wallet/withdrawals/:id/cancel`
  (player cancels while pending → **refund** via `engine.credit`).

**Backend — new admin cashier controller (`WALLETS_ADJUST`):**
- `POST /admin/wallet/deposits/:id/{complete,reject}` (complete → `engine.credit(DEPOSIT)` + link tx +
  COMPLETED; reject → FAILED/CANCELLED, no credit).
- `POST /admin/wallet/withdrawals/:id/{approve,complete,reject}` (already held; reject → refund credit +
  REJECTED).

**Frontend (additive, mobile-first):**
- `wallet-api.ts` deposit/withdraw methods; `use-cashier` hook.
- Rebuild `/wallet` (or a cashier surface) mobile-first with authoritative balance, Deposit/Withdraw,
  recent activity (from history, linked to game rounds), responsible-gaming links.
- Replace `/deposit` & `/withdraw` demo pages with server-authoritative flows (PENDING states) — **remove
  `useDemoWallet`** from money surfaces.

**Financial safety:** all movement via `WalletEngineService` (invariant, ledger, idempotency); no fake
payments; withdrawal holds funds; refunds on reject/cancel; reconcile stays balanced.

---

## 11. Open decision for approval (affects financial design)

- **Withdrawal fund handling:** (A) **Hold-on-request** — debit available balance immediately when a
  withdrawal is requested (prevents double-spend; refund on reject/cancel) — *recommended, financially
  safest*; or (B) **Validate-only** — record the request without debiting, debit only on operator
  completion (simpler, but the player could spend the same funds while pending).
- **Operator transitions:** include the admin complete/approve/reject endpoints (needed for a genuine,
  testable end-to-end state machine) — *recommended yes*; or defer them (deposits/withdrawals would sit
  PENDING with no honest completion path).

**No implementation has begun.** Awaiting confirmation of the withdrawal model + operator-transition
inclusion before writing code.
