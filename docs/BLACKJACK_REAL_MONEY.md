# Blackjack — Real Money (Phase 2C.4)

Real-money **interactive** Blackjack on the **existing** Game Money Bridge. It adds NO second
financial path: money moves only through the frozen `WalletEngineService` (reserve → commit), and the
cards, dealer play and payout come only from the frozen `@gaming-platform/card-engine` (`blackjack`
variant). The bridge (`GameMoneyBridgeService`) owns orchestration + the `GameRound` record; recovery
is the centralized Phase-2C.1 `GameMoneyRecoveryService`. No frozen module was modified.

## Model — interactive, one reservation per hand

```
START → reserve stake → deal (player 2, dealer up-card) → RESERVED (active)
      → HIT* (draw a card; bust settles as a loss)
      → STAND (dealer plays out → settle)   OR   DOUBLE (2nd reservation → one card → settle)
      → commit payout → SETTLED
```

The stake is reserved **once** at start and stays reserved while the player acts — it is **never**
re-charged per action. A DOUBLE adds one additional reservation (never a direct deduction); both are
committed together at settlement.

### Restart-safe interactive state (no in-memory engine)

The hand is **deterministic from the provably-fair seed**. The only persisted state is the seed, the
stake, and `action_seq` (the number of player hits taken). On every action the engine is
**reconstructed** from the seed and the hits are replayed — so a backend restart mid-hand loses
nothing; the exact same cards reappear and the player can continue or the hand settles once.

## Actions & engine support

| Action | Supported | How |
|---|---|---|
| HIT | ✅ | `CardEngine.blackjackHit()` — draw one card; a bust settles immediately as a loss. |
| STAND | ✅ | `CardEngine.blackjackResolve()` — dealer plays to `dealerStandValue` (17), then settle. |
| DOUBLE | ✅ | Only on the opening two cards. A second reservation of the stake, then exactly one card + resolve; the engine settles on the doubled bet. |
| SPLIT | ❌ **NOT SUPPORTED BY CURRENT ENGINE** | The engine has no split primitive; not invented. Deferred. |
| INSURANCE | ❌ **NOT SUPPORTED BY CURRENT ENGINE** | The engine has no insurance primitive; not invented. Deferred. |

**Natural blackjack** is settled by the engine's value comparison at the configured even-money
payout (this engine variant has no separate 3:2 tier). Payout is never hardcoded in the bridge.

## API (authenticated; `JwtAuthGuard`, userId from the JWT)

| Method & path | Purpose |
|---|---|
| `GET  /api/v1/games/blackjack/config` | Limits, dealer rule, supported actions, unsupported list. |
| `POST /api/v1/games/blackjack/start` | Reserve + deal. Body: `{ stake, currency, clientSeed?, idempotencyKey }`. |
| `GET  /api/v1/games/blackjack/:roundId` | Read the caller's hand (hole card + server seed hidden while active). |
| `POST /api/v1/games/blackjack/:roundId/action` | Apply `{ action: HIT | STAND | DOUBLE }`. |

Forbidden in the request body (server-derived): `userId`, `walletId`, `payout`, `result`, `cards`,
`dealerCards`, `playerCards`, `balance`, `serverSeed`, ledger ids.

## Idempotency

- **Start** is idempotent on `(userId, idempotencyKey)` — a repeat returns the same hand, no second
  reservation, no duplicate `GameRound`/ledger.
- **Actions** are exactly-once via a guarded optimistic lock: `updateMany({ where:{ id, status:
  RESERVED, actionSeq:S }, data:{ … } })`. Only one action at seq `S` advances; a duplicate/stale
  action returns the current authoritative state. An action after settlement returns the final state
  without a second settlement. Proven live.

## Concurrency

Two simultaneous actions both attempt the guarded `actionSeq` claim — exactly one wins and advances
(or settles); the other reads the current state. No double hit, no double settlement, no negative
balance. A concurrent STAND settles exactly once. Proven live.

## Failure recovery

Reuses the centralized Phase-2C.1 recovery — no Blackjack-specific recovery. Commit failure →
`PENDING_SETTLEMENT` (with the payout stored) → `GameMoneyRecoveryService.sweep()` re-drives the
idempotent `recover()`. A **doubled** hand stores both reservations (`extraReservations`); `recover()`
commits every reservation (all idempotent), so a doubled hand recovers its full stake and payout.
Durable + restart-safe (state in `game_rounds`). Proven live (pending-settlement recovery of a normal
and a doubled hand).

## Provably fair

Reuses the Card engine's provably-fair shoe. While the hand is active only the `serverSeedHash`
commitment is exposed (the hole card and server seed stay hidden). After settlement the round reveals
`serverSeed`/`clientSeed`/`nonce` and the full dealer hand, so the shoe is verifiable via
`CardEngineService.verifyShuffle`. Secrets are never revealed prematurely; never logged.

## Financial invariant (every settled hand)

`balanceAfter = balanceBefore − totalStake + payout` (`totalStake` = stake, or 2× on a double),
`balanceAfter ≥ 0`, `ledger debit === credit`, `reconcile().balanced === true`, `difference === "0"`,
no duplicate ledger entries, no direct SQL balance mutation. Proven live over 10+ interactive hands
and an authenticated HTTP sequence (start → HIT → STAND: 14 vs dealer 20, payout 0, balance
5020−100=4920; DOUBLE: stake→100, payout 200, invariant holds).

## Mobile UX

Mobile-first (`BlackjackMoneyBoard`): sticky authoritative balance; dealer + player hands with
scores (the hole card is a face-down back while active); a **sticky bottom action bar** with large
one-hand **HIT** / **STAND** buttons, and **2×** (DOUBLE) shown only when legal — only legal actions
render, no disabled clutter. Loading / active / win / loss / push / error states; New Hand after
settlement. No horizontal overflow at 375/390/412.

## History

Uses the existing `GameRound` + `WalletTransaction` records (stake, actions via `action_seq`, result,
payout, timestamp, roundId) — no duplicate history model.

## Failure cases

| Case | Behaviour |
|---|---|
| Invalid / insufficient stake | Rejected atomically → `400`; nothing debited. |
| Insufficient to double | Reservation refused → `400`; the hand reverts to actable. |
| Bust on HIT | Settles immediately as a loss (payout 0). |
| Duplicate / concurrent action | Exactly one advances; others return current state. |
| Action after settlement / wrong user | Idempotent replay / `403`. |
| Commit failure | `PENDING_SETTLEMENT` → centralized recovery (both reservations when doubled). |
| Backend restart mid-hand | Deterministic reconstruction from the seed; continue or settle once. |
