# Game History (Phase 2C.4)

Server-authoritative, read-only game-round history for the authenticated player. Stake, payout and
net result come straight from the persisted `GameRound` rows — no client calculation, no demo wallet.
This phase writes no financial data.

## APIs

All authenticated (JWT); the userId is ALWAYS from the token (`@CurrentUser('id')`), never from the
client.

### `GET /api/v1/games/history` — round list
Filters: `page`, `limit`, `gameKey`, `status`, `from`, `to` (ISO-8601, filters `createdAt`).
```jsonc
{
  "items": [
    { "roundId", "gameKey", "betType", "stake", "payout",
      "netResult",            // Decimal(payout − stake), no floating-point money math
      "status", "createdAt", "settledAt", "reference" }
  ],
  "total", "page", "limit", "pages"
}
```

### `GET /api/v1/games/history/:roundId` — full traceability (owned round)
Ownership is enforced: the round's `userId` must equal the JWT userId, otherwise `403`. `?userId=`,
`body.userId` and any path userId are ignored — identity is server-derived only. See
`FINANCIAL_TRACEABILITY.md` for the response shape.

## netResult

`netResult = payout − stake`, computed with `Prisma.Decimal` (never floating-point). Positive = WIN,
zero = PUSH, negative = LOSS. The stored `stake`/`payout` are never altered.

## Provably-fair visibility

The round's `result`/`fairness` are returned as stored, EXCEPT while a round is still in flight
(non-terminal status) — the provably-fair secret (`serverSeed` / `seed` / a crash point embedded in
`settled`) is redacted, matching each game's own reveal rules. Once the round is terminal (`SETTLED`
/ `RECOVERED` / `FAILED` / `RECOVERY_FAILED`) the seed is revealed for verification.

## Security

JWT required (`401` otherwise). List is always scoped to the JWT userId; details enforce per-round
ownership. Proven live: a normal user gets `403` on another player's round and `total: 0` on their
own (empty) history.

## Mobile UX

`/game-history` (auth-guarded `(dashboard)` group). Mobile-first: round cards (game, stake, payout,
WIN/LOSS/PUSH net result, status, time, round id), sticky filters (game / status / date range),
prev/next pagination, loading / empty / error states. Tap a card to open the round traceability
sheet. No horizontal overflow at 375 / 390 / 412.

## Test evidence

- Backend unit: `game-money-history.service.spec.ts` (netResult, ownership, redaction, pagination).
- Backend live: `game-money-history.integration.spec.ts` (`RUN_DB_IT=1`) — real rounds listed with
  correct netResult; details assembled; ownership enforced.
- Live HTTP: `/games/history` listed a real round (`netResult` correct); `/games/history/:roundId`
  returned the full bundle; ownership `403`; date filter empty for a future window.
- Frontend: `game-history-api.test.ts` (contract + no-demo-wallet regression).
