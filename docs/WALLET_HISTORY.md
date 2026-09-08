# Wallet History (Phase 2C.4)

Server-authoritative, read-only wallet transaction history for the authenticated player. Every value
is read straight from the persisted `WalletTransaction` rows — **nothing is computed on the client**
and there is **no demo wallet**. This phase writes no financial data.

## API

`GET /api/v1/wallet/history` — authenticated (JWT). The userId is ALWAYS taken from the token
(`@CurrentUser('id')`); it is never accepted from the query, body or path.

### Filters (all optional)
| Param | Meaning |
|---|---|
| `page` | Page number (≥ 1, default 1). |
| `limit` | Items per page (1–100, default 20). |
| `type` | Transaction type code (e.g. `GAME_BET`, `GAME_WIN`, `RESERVE`, `DEPOSIT`). |
| `status` | Transaction status code (e.g. `COMPLETED`, `RESERVED`). |
| `currency` | Currency code (e.g. `INR`). |
| `from` / `to` | ISO-8601 date/datetime, inclusive — filters `createdAt`. Invalid dates are rejected (`400`). |

### Response
```jsonc
{
  "items": [
    { "id", "type", "status", "amount", "fee",
      "balanceBefore", "balanceAfter",   // STORED on the row — never recomputed
      "currency", "reference", "description", "metadata", "createdAt" }
  ],
  "total", "page", "limit", "pages"
}
```

## Implementation

Reuses the existing read-only `WalletTransactionService` (in the frozen wallet-engine module),
extended **additively**: the query gained optional `currency` / `from` / `to` filters and the view
gained `fee` / `balanceBefore` / `currency` / `metadata`. Existing callers
(`/wallet-engine/transactions`, admin transaction inspection) are unaffected. The route lives on the
existing `WalletController` (`/wallet`), which now imports `WalletEngineModule` to reuse the service.

## Authoritative balances

`balanceBefore` and `balanceAfter` are columns persisted by the Wallet Engine at write time. The
history layer only reads and returns them — it never reconstructs balances from prior transactions.

## Pagination

Platform convention: `page`/`limit` in, `{ items, total, page, limit, pages }` out; `limit` capped
at 100. No second pagination convention is introduced.

## Security

JWT required (`401` otherwise). Ownership is implicit — the query is always scoped to the JWT userId,
so a player can only ever see their own transactions. No client-supplied identity is trusted.

## Mobile UX

`/wallet/history` (under the auth-guarded `(dashboard)` group). Mobile-first: compact transaction
cards (never a wide table), sticky filters (type / currency / date range), signed amount + stored
`balanceBefore → balanceAfter`, reference + timestamp, prev/next pagination, and loading / empty /
error states. No horizontal overflow at 375 / 390 / 412. The existing demo `/transactions` page is
intentionally left untouched — the new page is additive and server-authoritative.

## Test evidence

- Backend: `WalletTransactionService` filters/paginate exercised in the history integration spec.
- Live HTTP: real round → `/wallet/history` returned the stored `GAME_BET` / `GAME_WIN` rows with
  `balanceBefore`/`balanceAfter`; date + currency filters honoured.
- Frontend: `wallet-history-api.test.ts` (contract + no-demo-wallet regression).
