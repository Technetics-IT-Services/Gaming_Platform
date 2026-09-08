# Phase 2C.9 — Wallet & Cashier Architecture

An additive, server-authoritative cashier (deposits & withdrawals) built on the **existing** Prisma
models and the **frozen** `WalletEngineService`. No new financial engine, no schema change, no fake
payment gateway.

## 1. Reused (frozen) foundation

- **`WalletEngineService`** — the only money mover. `credit(userId, currencyId, {amount, typeCode,
  description?, idempotencyKey}, type?)` and `debit(...)`: atomic, double-entry ledger, idempotent by
  key, non-negative algebra, Redis-locked, optimistically versioned. The cashier **calls** these; it
  never re-implements balance/ledger logic.
- **Prisma models (already present)**: `DepositRequest` (`DepositStatus`), `WithdrawalRequest`
  (`WithdrawalStatus`), `PaymentGateway`, `PaymentMethod`, `Refund`. No migration.
- **Transaction type codes** `DEPOSIT`, `WITHDRAWAL`, `REFUND` (wallet-core / types enums).
- **Wallet reads** (Phase 2C.4): `GET /wallet`, `/wallet/summary`, `/wallet/history` (stored
  balanceBefore/After).

## 2. New `CashierService` (additive) — `apps/backend/src/modules/wallet/cashier.service.ts`

Owns only the **request lifecycle**; all money moves through the engine.

### Deposits (no fake credit)
- `createDeposit` → validate active user + currency + amount (min/max) → create `DepositRequest`
  **PENDING**. **No credit** — a deposit is money-neutral until an operator completes it. Idempotent by
  `reference = dep_<idempotencyKey>` (unique).
- `completeDeposit` (operator) → `engine.credit(DEPOSIT, idempotencyKey=<ref>:credit)` + link
  `transactionId` + `COMPLETED`. Idempotent (re-run returns the completed row, credits once).
- `rejectDeposit` (operator) → `FAILED`, no money moved.

### Withdrawals (hold-on-request)
- `createWithdrawal` → validate active user + currency + amount (min/max) + **available balance** →
  create `WithdrawalRequest` → `engine.debit(WITHDRAWAL, idempotencyKey=<ref>:hold)` (funds **held
  immediately**, preventing double-spend) → `UNDER_REVIEW` with `transactionId`. Idempotent by
  `reference = wd_<idempotencyKey>`; a debit failure marks the request `FAILED` (no money moved).
- `approveWithdrawal` (operator) → `APPROVED` (funds already held; no movement).
- `completeWithdrawal` (operator) → `COMPLETED` (funds already debited; no second movement).
- `rejectWithdrawal` (operator) / `cancelWithdrawal` (player, while pending) → `engine.credit(REFUND,
  idempotencyKey=<ref>:refund)` refunds the held amount → `REJECTED` / `CANCELLED`.

## 3. APIs

**Player — `@Controller('cashier')`** (authenticated; distinct `/cashier` prefix to avoid the
`GET /wallet/:currencyId` param collision):
- `GET /cashier/config` — min/max, currencies, fee pct (display only; server validates).
- `POST /cashier/deposits`, `GET /cashier/deposits`, `GET /cashier/deposits/:id`.
- `POST /cashier/withdrawals`, `GET /cashier/withdrawals`, `GET /cashier/withdrawals/:id`,
  `POST /cashier/withdrawals/:id/cancel`.

**Operator — `@Controller('admin/cashier')`** (`RequirePermissions(WALLETS_ADJUST)`):
- `POST /admin/cashier/deposits/:id/{complete,reject}`.
- `POST /admin/cashier/withdrawals/:id/{approve,complete,reject}`.

DTOs (`whitelist + forbidNonWhitelisted`): the client sends **only** `amount, currency, method?,
idempotencyKey` — never `balance/status/netAmount/transactionId/walletId/userId/approval` (rejected
400, verified live).

## 4. Financial safety (verified)

- Invariant `balanceAfter = balanceBefore − debit + credit` (deposit complete `+amount`, withdrawal hold
  `−amount`, refund `+amount`) — verified live.
- No negative balance (engine non-negative algebra; withdrawal pre-checks available).
- Double-entry ledger stays balanced — `reconcile → difference "0"` (verified live).
- Idempotency: duplicate deposit/withdrawal key → one request, one movement (verified live + integration).
- Concurrency: 5 concurrent withdrawals → exact holds, no negative, balanced (integration).
- Restart persistence: a held withdrawal survives a real backend restart with funds preserved (verified).

## 5. Server authority & security

Identity from `@CurrentUser('id')`; ownership enforced on list/read; amounts/status/netAmount are
server-derived; operator transitions are RBAC-gated; no server seeds/secrets in payloads or logs;
deposits are never auto-credited (honest — no payment gateway is faked).

## 6. What was NOT built (honest)

No external payment-provider integration (deposits complete via operator, the honest path without a
gateway). No new financial schema. No changes to frozen wallet/ledger/engine/bridge code.
