# Coin Flip — Real Money (Phase 2C.7)

Single-shot real-money Coin Flip via the generic instant-game bridge (`playInstant`). The outcome,
win/loss, payout and balance are **server-authoritative** (no demo wallet).

## Rules
The player calls **heads** or **tails**. A provably-fair coin is flipped (`r < 0.5 → heads`). A correct
call pays **1.98×** (a 1% house edge on the fair 2×); a wrong call loses.

## Existing implementation reused / backend engine
Faithful port of `apps/frontend/src/games/instant/coin-flip-engine.ts` into `engines/instant-engine.ts`:
`coinOutcome(r, pick)` — `outcome = r < 0.5 ? 'heads' : 'tails'`, `multiplier = win ? 1.98 : 0`. The
threshold and payout are **identical** to the frontend (proven in `backend-parity.test.ts`).

## RTP / payout math
`COIN_FLIP_PAYOUT = 1.98`, P(win) = 0.5 → **RTP = 0.99** (empirically ≈0.99 over 40 000 rounds; live: 10
plays, invariant every play).

## Provably fair
Backend `ProvablyFairService` seed → `SeededRng().next()` = the flip float; server seed revealed on
settlement. **RNG-source note:** game math identical to the frontend; float source is the real
HMAC-SHA256 engine, not the frontend demo provider (documented).

## Money flow
`reserve(stake)` → `computeInstant({side}, seed)` → `payout = stake × 1.98` (win) or `0` (loss) →
`commitReservation(payout)`. Failure → `PENDING_SETTLEMENT` → recovery. Stake limits **1–10 000**.

## API
- `GET /api/v1/games/coin-flip/config` → `{ game, limits, sides:['heads','tails'], payout: 1.98 }`.
- `POST /api/v1/games/coin-flip/play` → body `{ side∈{heads,tails}, stake, currency, clientSeed?, idempotencyKey }`.
  Forbidden server-owned fields → **400**. Returns `{ roundId, multiplier, win, result:{outcome,pick}, payout, balance, provablyFair, replayed }`.

## Idempotency · concurrency · recovery · history
Duplicate key → same round, single debit. Concurrency safe (frozen wallet lock). `PENDING_SETTLEMENT`
recovers. Traceable through `GameRound → reservation → wallet transaction → ledger`.

## Mobile UX
`/coin-flip-money` — sticky balance, two large heads/tails call buttons, stake chips, big Flip. 375/390/412,
no horizontal overflow, no demo-wallet.

## Security
`@CurrentUser('id')`; DTO whitelist (`side` is `heads|tails` only); server owns outcome/payout/balance.

## Tests
`game-money-instant.spec.ts`, `game-money-instant.integration.spec.ts`, `instant-money-api.test.ts`,
`backend-parity.test.ts`.

## Known limitations
None material — the simplest single-float game; the coin face shown is cosmetic, the result is the
server's authoritative outcome.
