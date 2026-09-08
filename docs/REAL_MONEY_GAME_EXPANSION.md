# Real-Money Game Expansion — Overview

One shared, proven financial path powers every real-money game. New games are wired to it
**additively** — they never re-implement wallet, ledger, settlement or recovery, and never modify a
frozen module.

## The single financial path

```
Authenticated user (userId from JWT)
  → GameMoneyBridgeService            (validate player/currency/stake, idempotency, orchestration)
    → WalletEngineService.reserve()   (available → locked; overdraft-safe, atomic)
    → <frozen game engine>            (authoritative outcome + payout — the sole game authority)
    → WalletEngineService.commitReservation()   (consume stake + credit win + double-entry ledger)
  → GameRound record                  (lifecycle, provably-fair metadata, idempotency)
  → GameMoneyRecoveryService          (centralized durable recovery of PENDING_SETTLEMENT)
```

Money moves **only** through `WalletEngineService`. The client is never trusted for payout, balance,
walletId, userId, result, dice, winning numbers, prize, multiplier or crash point — the server
derives all of them. There is exactly **one** money bridge and **one** recovery service.

## Games on the bridge

| Game | Engine | Shape | Money model |
|---|---|---|---|
| Dice (2B) | dice-engine | single-shot | reserve → roll → commit |
| Crash (2C.2) | crash-engine | two-phase live | reserve (hidden crash point) → cashout at server multiplier → commit |
| Roulette (2C.2) | roulette-engine | single-shot multi-bet | reserve total → spin → commit total |
| **Sic Bo (2C.3)** | dice-engine (`sic-bo`) | single-shot multi-bet | reserve total → roll → commit total |
| **Number Lottery (2C.3)** | lottery-engine | **scheduled shared draw** | reserve ticket price → shared draw executes → commit prize |

See `SIC_BO_REAL_MONEY.md`, `LOTTERY_REAL_MONEY.md`, `CRASH_REAL_MONEY.md`,
`ROULETTE_REAL_MONEY.md`, and `GAMING_MONEY_RECOVERY.md` for per-game detail.

## Guarantees (every game)

- **Financial invariant**: `balanceAfter = balanceBefore − stake + payout`, `balanceAfter ≥ 0`.
- **Ledger integrity**: double-entry `debit === credit`; `reconcile().balanced === true`,
  `difference === "0"`; no duplicate ledger entries; no direct SQL balance mutation.
- **Idempotency**: `@@unique([userId, idempotencyKey])` + idempotent `commitReservation` — duplicate
  and concurrent requests never double-charge or double-pay.
- **Concurrency**: guarded DB state transitions (`RESERVED → RESOLVED`, draw `OPEN/CLOSED → DRAWN`)
  make cash-outs, ticket settlements and draw executions **exactly-once**.
- **Recovery**: commit failures → `PENDING_SETTLEMENT` → the centralized scheduler re-drives the
  idempotent `recover()`; bounded retries; `RECOVERY_FAILED` at the cap (never silently dropped).
- **Restart-safe**: all state is durable in `game_rounds` (+ `lottery_draws`); schedulers re-discover
  work on boot — nothing authoritative is memory-only.
- **Provably fair**: each game reuses its engine's fairness contract; secrets are revealed only when
  the contract permits (e.g. crash point / lottery winning numbers only after settlement).
- **Production auth**: every endpoint is behind `JwtAuthGuard`; no demo wallet, no injected identity.

## Scheduled draw (Number Lottery)

The lottery adds a durable, execute-once shared draw (`LotteryDraw` + `LotteryDrawService` +
`LotteryDrawScheduler`, additive schema only). All tickets of a draw settle against one authoritative
set of winning numbers, derived deterministically from a committed provably-fair seed; a guarded
status transition guarantees two workers can never publish two different draws. Ticket money still
settles through the shared bridge — the scheduler orchestrates, it never touches the wallet/ledger.

## Frozen surface

No modification to runtime, registry, session manager, event bus, `WalletEngineService`, wallet-core,
ledger, treasury, settlement, compliance, auth/RBAC guards, the Dice/Crash/Roulette engines, the Sic
Bo (dice) engine, the Number-Lottery engine, `game-sdk`, or the existing recovery core. New code lives
under `apps/backend/src/modules/gaming-money/`, `apps/frontend/src/{components/games,app/(casino),lib}/`,
additive `game-money.prisma`, and `docs/`.
