# Card-Game Money Bridge (Phase 2C.4)

How the **card games** (Baccarat, Blackjack) plug into the one shared financial architecture — and
how an **interactive** game (Blackjack) fits the same reserve → engine → commit path used by every
instant game. Additive only; no frozen module changed.

## One money path, two shapes

Both games use the existing `GameMoneyBridgeService` + `WalletEngineService` + `GameRound` +
centralized recovery. They differ only in lifecycle shape:

| Game | Engine | Shape | Reservations | Settlement |
|---|---|---|---|---|
| **Baccarat** | card-engine `baccarat` | single-shot multi-bet | 1 (total stake) | 1 commit (total payout) |
| **Blackjack** | card-engine `blackjack` | interactive (deal → act → resolve) | 1 (+1 on DOUBLE) | 1 commit (2 on DOUBLE) |

The authoritative outcome is always the frozen `@gaming-platform/card-engine`. The bridge only
validates, reserves, invokes the engine, commits, and persists the `GameRound`.

## Baccarat — the familiar single-shot path

Identical in structure to Roulette / Sic Bo: validate bets → `reserve(total)` → `CardEngineService.
play('baccarat', bets)` → `commitReservation(totalWin)` → `SETTLED`. See `BACCARAT_REAL_MONEY.md`.

## Blackjack — interactive on the same path

The novel part is that an **interactive** game spans multiple HTTP requests while holding a single
reservation. Two design choices make this fit the shared path without a new money architecture:

1. **The stake is reserved once at `start` and stays reserved while the player acts.** No action
   re-charges. Settlement is a single `commitReservation` at the end (`STAND` / bust / `DOUBLE`).
2. **The hand is deterministic from the provably-fair seed, so no engine state is kept in memory.**
   The only persisted state is the seed, the stake, and `action_seq` (hits taken). Each action
   reconstructs the engine from the seed and replays `action_seq` hits — making the whole flow
   **restart-safe**: a crash mid-hand loses nothing; the same cards reappear.

### Exactly-once actions (optimistic lock)

Concurrent/duplicate actions are serialized by a guarded transition on the additive `action_seq`
column:

```sql
UPDATE game_rounds SET action_seq = action_seq + 1   -- (or status → RESOLVED for STAND/DOUBLE)
WHERE id = $1 AND status = 'RESERVED' AND action_seq = $S;   -- count=1 ⇒ this action advances; 0 ⇒ someone else did
```

Only one action at sequence `S` advances; a duplicate/stale action returns the current authoritative
state; an action after settlement returns the final state (no second settlement).

### DOUBLE — the second reservation

DOUBLE demonstrates safe additional-stake handling on the existing wallet architecture (never a
direct deduct): a **second `reserve(stake)`** with a distinct reference (`round:{id}:2`), then one
card + resolve, and the engine settles on the doubled bet. Both reservations are committed at
settlement (the extra with win 0 — it just consumes its stake; the primary with the full payout), so
the net is `balanceAfter = balanceBefore − 2·stake + payout`. If settlement fails, both reservation
handles are stored in `result.extraReservations`, and the **centralized** `recover()` commits every
reservation idempotently — no Blackjack-specific recovery.

SPLIT and INSURANCE have **no engine primitive** and are **not invented** — documented as not
supported / deferred.

## Additive schema (Phase 2C.4)

One additive column on `game_rounds`: `action_seq INT DEFAULT 0` — the interactive optimistic lock
and the deterministic replay depth. 0 for all single-shot games. Migration
`20260820093517_game_round_action_seq`. No other schema change; no new history model.

## Guarantees (both games)

- **Invariant**: `balanceAfter = balanceBefore − stake + payout`, `balanceAfter ≥ 0`.
- **Ledger**: double-entry `debit === credit`; `reconcile().balanced === true`, `difference === "0"`;
  no duplicate ledger; no direct SQL mutation.
- **Idempotency**: `@@unique([userId, idempotencyKey])` + idempotent `commitReservation`; plus the
  `action_seq` lock for Blackjack actions.
- **Concurrency**: guarded DB transitions → exactly-once settlement / action.
- **Recovery**: commit failures → `PENDING_SETTLEMENT` → the centralized scheduler; a doubled hand's
  extra reservation recovers too.
- **Restart-safe**: all state durable in `game_rounds`; interactive hands reconstruct from the seed.
- **Provably fair**: the engine's shoe; secrets revealed only at the permitted lifecycle point (hole
  card + server seed hidden while a hand is active).
- **Production auth**: every endpoint behind `JwtAuthGuard`; userId from the JWT; no demo wallet.

## Frozen surface

No change to runtime, registry, session manager, event bus, `WalletEngineService`, wallet-core,
ledger, treasury, settlement, auth/RBAC, the Dice/Crash/Roulette/Sic-Bo/Lottery engines, the **Card
engine** (consumed, not modified), `game-sdk`, or the existing recovery core. New code lives under
`apps/backend/src/modules/gaming-money/`, `apps/frontend/src/{components/games,app/(casino),lib}/`,
the additive `game-money.prisma` column, and `docs/`.
