# Wheel — Real Money (Phase 2C.7)

Single-shot real-money Wheel via the generic instant-game bridge (`playInstant`). The landed segment,
multiplier, payout and balance are **server-authoritative** (no demo wallet); the segment tables come
from the config API (never hardcoded in the UI).

## Rules
The player picks a **risk** (low / medium / high). The wheel lands on one of 20 segments; the player
wins that segment's multiplier (0 = lose). Each risk has the same ~4% house edge (mean multiplier ≈
0.96) but different variance — low hits small wins often, high hits big wins rarely.

## Existing implementation reused / backend engine
Faithful port of `apps/frontend/src/games/instant/wheel-engine.ts` into `engines/instant-engine.ts`:
`WHEEL_SEGMENTS` tables are **identical** (proven `toEqual` in `backend-parity.test.ts`), and
`wheelOutcome(r, risk)` uses the **identical** landing index `min(len−1, floor(r · len))`.

Segment tables (each mean ≈ 0.96):
- low: sixteen `1.2×` + four `0×`
- medium: four `3×` + four `1.8×` + twelve `0×`
- high: one `10×` + one `5×` + one `4.2×` + seventeen `0×`

## RTP / payout math
Mean multiplier ≈ **0.96 → ~96% RTP** for every risk (asserted to 5 dp in the parity test; empirically
within band over 40 000 rounds; live: 10 plays, invariant every play).

## Provably fair
Backend `ProvablyFairService` seed → `SeededRng().next()` = the landing float; server seed revealed on
settlement. **RNG-source note:** game math identical to the frontend; float source is the real
HMAC-SHA256 engine (documented).

## Money flow
`reserve(stake)` → `computeInstant({risk}, seed)` → `payout = stake × segment` (win) or `0` →
`commitReservation(payout)`. Failure → `PENDING_SETTLEMENT` → recovery. Stake limits **1–10 000**.

## API
- `GET /api/v1/games/wheel/config` → `{ game, limits, risks, segments:{low,medium,high} }` (UI renders the strip from this).
- `POST /api/v1/games/wheel/play` → body `{ risk∈{low,medium,high}, stake, currency, clientSeed?, idempotencyKey }`.
  Forbidden server-owned fields → **400**. Returns `{ roundId, multiplier, win, result:{risk,index,segment}, payout, balance, provablyFair, replayed }`.

## Idempotency · concurrency · recovery · history
Duplicate key → same round, single debit. 10 concurrent plays → no negative balance, ledger balanced.
`PENDING_SETTLEMENT` recovers. Traceable via `GameRound → reservation → wallet transaction → ledger`.

## Mobile UX
`/wheel-money` — sticky balance, config-driven segment strip (highlights the landed index, no horizontal
scroll), risk selector, stake chips, big Spin. 375/390/412, no demo-wallet.

## Security
`@CurrentUser('id')`; DTO whitelist (`risk` enum only); server owns segment/multiplier/payout/balance.

## Tests
`game-money-instant.spec.ts` (all three risks), `game-money-instant.integration.spec.ts`,
`instant-money-api.test.ts`, `backend-parity.test.ts`.

## Known limitations
The UI renders a linear segment strip (not an animated wheel) — a deliberate deadline choice; the
landed index/segment is the server's authoritative result.
