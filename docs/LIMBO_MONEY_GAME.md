# Limbo — Real Money (Phase 2C.7)

Single-shot real-money Limbo via the generic instant-game bridge (`playInstant`). The generated
multiplier, win/loss, payout and balance are **server-authoritative** (no demo wallet).

## Rules
The player picks a **target** multiplier (≥ 1.01). The round generates a provably-fair multiplier; the
bet **wins if generated ≥ target** and pays the **target** (`payout = stake × target`), else loses.
Win probability at target T ≈ `edge/T`, so EV = edge (constant house edge, independent of T).

## Existing implementation reused / backend engine
Faithful port of `apps/frontend/src/games/instant/limbo-engine.ts` into
`apps/backend/src/modules/gaming-money/engines/instant-engine.ts`:
`limboMultiplier(r) = clamp( floor((0.99 / (1−r)) · 100)/100 , 1, 1_000_000 )` — **byte-identical** to
the frontend (proven in `backend-parity.test.ts`). `limboOutcome(r, target)` applies the win/pay rule.

## RTP / payout math
`LIMBO_CONFIG = { houseEdgePct: 1, maxMultiplier: 1_000_000 }` → **~99% RTP** for any target
(empirically ≈0.99 over 40 000 rounds in the parity test; live: 10 plays, invariant every play).

## Provably fair
Backend `ProvablyFairService`: `createCommit()` → `{serverSeed, serverSeedHash, nonce}`;
`deriveSeed(serverSeed, clientSeed, nonce)` → seed → `new SeededRng(seed).next()` = the float. The
server seed is revealed on settlement (single-shot). **RNG-source note:** the frontend animates with the
demo xmur3 provider; the money outcome uses the real HMAC-SHA256 seed. Game math identical; float source
differs (documented).

## Money flow
`reserve(stake)` → `computeInstant({target}, seed)` → `payout = stake × multiplier` →
`commitReservation(payout)`. Settlement failure → `PENDING_SETTLEMENT` → centralized recovery.
Stake limits **1–10 000**.

## API
- `GET /api/v1/games/limbo/config` → `{ game, limits, minTarget: 1.01, maxMultiplier, houseEdgePct }`.
- `POST /api/v1/games/limbo/play` → body `{ target≥1.01, stake, currency, clientSeed?, idempotencyKey }`.
  Any of `payout/multiplier/result/balance/serverSeed/walletId/userId` in the body → **400**.
  Returns `{ roundId, game, multiplier, win, result:{generated,target}, stake, payout, balance, provablyFair, replayed }`.

## Idempotency · concurrency · recovery · history
Duplicate `idempotencyKey` → same round, single debit. 10 concurrent plays → no negative balance,
ledger balanced. `PENDING_SETTLEMENT` recovers via `GameMoneyRecoveryService`. Traceable via
`GameRound → reservation → wallet transaction → ledger`.

## Mobile UX
`/limbo-money` — sticky authoritative balance, large target input + quick chips + live win-chance,
stake chips, big Play. 375/390/412, no horizontal overflow, no demo-wallet.

## Security
`@CurrentUser('id')`; DTO whitelist; server owns outcome/payout/balance; suspended/banned refused.

## Tests
`game-money-instant.spec.ts` (unit), `game-money-instant.integration.spec.ts` (live),
`instant-money-api.test.ts` (contract + no-demo-wallet), `backend-parity.test.ts` (parity + RTP).

## Known limitations
Win-chance shown in the UI is display-only; the authoritative result is the server's. Very large
targets approach `maxMultiplier` and are effectively near-zero probability.
