# Financial Traceability (Phase 2C.4)

Every money movement is explainable without SQL. This phase adds read-only endpoints that assemble
the already-persisted records into a single traceability bundle — for the player ("what happened to
my money?") and for the operator (investigation). No new table, no new financial write, no direct
SQL — it joins existing rows via links the money bridge already stored.

## The trace chain

```
GameRound ──reservationId──▶ LockedFunds            (the reservation)
GameRound ──betTransactionId─▶ WalletTransaction    (the settlement)
        └── reference prefix `round:{id}` ──▶ all WalletTransactions (RESERVE, bet, win, `:2` for a doubled hand)
WalletTransaction ──▶ Ledger ──▶ LedgerEntry        (double-entry journal)
```

`Ledger.walletTransactionId` links a journal to its transaction; ledgers are also matched by the
`round:{id}` reference. All amounts and balances are the stored values.

## Player round detail — `GET /api/v1/games/history/:roundId`

Ownership-enforced (JWT userId must equal `GameRound.userId`, else `403`).

```jsonc
{
  "round": { "id","gameKey","variant","betType","stake","payout","netResult",
             "status","idempotencyKey","result","fairness","createdAt","settledAt","reference" },
  "reservation": { "id","amount","status","reason","createdAt","releasedAt" } | null,
  "settlement":  { "id","type","status","amount","fee","balanceBefore","balanceAfter",
                   "currency","reference","description","createdAt" } | null,
  "walletTransactions": [ /* every round:{id}* transaction */ ],
  "ledger": [ { "id","reference","status","postedAt",
                "entries": [ { "id","direction","amount","balanceAfter","status" } ] } ]
}
```

The player view does **not** expose internal `walletId` on ledger entries, and redacts the
provably-fair secret while the round is still active.

## Admin investigation — `GET /api/v1/admin/games/rounds/:roundId`

Permission-gated: `@RequirePermissions(PERMISSIONS.WALLETS_READ)`. Replaces manual DB investigation.
Everything the player bundle has, **plus**:

```jsonc
{
  "player":  { "id","email","username","status","createdAt" },
  "wallet":  { "id","type","status","available","locked","total" },
  "recovery":{ "status","recoveryAttempts","lastRecoveryAt","nextRecoveryAt","error" },
  // ledger entries also expose "walletId" for the operator
}
```

Admin data is more detailed but still exposes **no secrets** — no passwords, refresh tokens, JWT
secrets, API keys, or unrevealed server seeds (redacted while a round is in flight, exactly as for
the player view).

## Player vs admin visibility

| | Player (`/games/history/:id`) | Admin (`/admin/games/rounds/:id`) |
|---|---|---|
| Round + reservation + transactions + ledger | ✅ | ✅ |
| Ledger `walletId` | ❌ hidden | ✅ shown |
| Player identity / wallet balances | own only, implicit | ✅ explicit |
| Recovery state (attempts, next-retry, error) | ❌ | ✅ |
| Ownership | enforced (`403` otherwise) | none (permission-gated) |
| Provably-fair secret while active | redacted | redacted |

## Financial safety

This is a read-only layer: it performs no reservation, settlement, ledger write, or balance
mutation, and issues no `$executeRaw` for financial data. It only reads through existing Prisma
models. Verified live: reading history creates **no** new `GameRound` / `WalletTransaction` /
`LedgerEntry` rows, the invariant `balanceAfter = balanceBefore − stake + payout` is unchanged, and
`reconcile()` stays `{ balanced: true, difference: "0" }`.

## Security model

- Every endpoint requires a valid JWT (`401` otherwise).
- Player endpoints are scoped to the JWT userId; round detail enforces per-round ownership (`403`).
- The admin endpoint is gated on `wallets:read`; a normal user gets `403`.
- No client-supplied `userId` / `walletId` is ever trusted.
- No secrets are returned or logged.
