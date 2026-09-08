# Number Lottery — Real Money (Phase 2C.3)

Real-money Number Lottery on the **existing** Game Money Bridge, with a durable, execute-once
**scheduled draw**. No second financial path: money moves only through the frozen
`WalletEngineService` (reserve → commit), and the winning numbers + prize evaluation come only from
the frozen `@gaming-platform/lottery-engine` (`drawNumbers` + `countMatches`) seeded by the frozen
`ProvablyFairService`. Ticket money always settles through the shared `GameMoneyBridgeService`;
recovery is the centralized Phase-2C.1 `GameMoneyRecoveryService`. No frozen module was modified.

## Model — ticket purchase ≠ immediate settlement

```
buy ticket → validate picks → reserve TICKET PRICE → persist ticket (GameRound, drawId, RESERVED)
           → ticket waits for the SHARED scheduled draw
draw time → execute-once (derive winning numbers from the committed seed)
          → evaluate EVERY ticket of the draw against the SAME numbers
          → commit the engine prize per ticket (no second debit) → SETTLED
```

The stake stays represented by the **reservation** from purchase until the draw resolves — the player
is **never** charged again at draw time, and there is no second wallet debit.

## Shared draw (the critical property)

All tickets for a draw evaluate against **one** authoritative set of winning numbers. A `LotteryDraw`
row is the shared source of truth: `drawNumber`, `status` (OPEN→CLOSED→DRAWN→SETTLED), `poolSize`,
`pick`, `ticketPrice`, a committed provably-fair seed, and the derived `winningNumbers`. Every ticket
(`GameRound.drawId → LotteryDraw.id`) is settled against that row. Proven live: four tickets on one
draw all resolve against identical winning numbers.

## Draw execution — durable, execute-once, restart-safe

`LotteryDrawService` + `LotteryDrawScheduler` (a lightweight `setInterval` poller mirroring the
recovery scheduler — no new dependency):

- **Deterministic**: winning numbers = `drawNumbers(new SeededRng(deriveSeed(serverSeed, clientSeed,
  nonce)), pool, pick)`. Any worker computes the **same** numbers.
- **Execute-once**: a guarded `updateMany({ where:{ id, status:{in:[OPEN,CLOSED]} }, data:{ status:
  DRAWN, winningNumbers } })` — only one worker transitions the draw. Two workers can never publish two
  different draws. Proven live (concurrent execution → exactly one, same numbers, no duplicate ledger).
- **Durable + restart-safe**: all state is in `lottery_draws` + `game_rounds`. A restarted process
  re-discovers due draws (to execute) and DRAWN draws with unsettled tickets (to settle). Proven live.

## API (authenticated; `JwtAuthGuard`, userId from the JWT)

| Method & path | Purpose |
|---|---|
| `GET  /api/v1/games/lottery/config` | pool, pick, ticket price, currency, prize tiers. |
| `GET  /api/v1/games/lottery/draw` | The current open draw (id, number, draw time, seed commitment). |
| `GET  /api/v1/games/lottery/tickets` | The caller's recent tickets + results. |
| `POST /api/v1/games/lottery/buy` | Buy one ticket. Body: `{ picks:number[], currency, drawId?, idempotencyKey }`. |

Manual pick (submit chosen numbers), quick pick (numbers generated client-side, still the player's),
and multiple tickets (repeat calls, each with its own idempotency key) are all supported.

Forbidden in the request body (server-derived): `userId`, `walletId`, `payout`, `prize`, `result`,
`winningNumbers`, `balance`, `ticketPrice`, ledger ids.

## Money flow & settlement

1. Purchase: authenticate → validate picks (distinct, in range, exactly `pick`) + currency (must
   match the draw) → idempotency → `reserve(ticketPrice)` → ticket `RESERVED` with `drawId`.
2. Draw: `executeDraw` claims the draw (execute-once) and derives the winning numbers.
3. Settlement (per ticket): guarded `RESERVED → RESOLVED` claim → `matches = countMatches(picks,
   winning)` → `prize = ticketPrice × prizeTiers[matches]` → `commitReservation(prize)` → `SETTLED`.
   Losing ticket → `prize = 0`. On commit failure → `PENDING_SETTLEMENT` (recoverable).

Prize is evaluated **only** by the engine; no client-supplied prize or winning numbers.

## Idempotency

- **Purchase** is idempotent on `(userId, idempotencyKey)` — no duplicate ticket / reservation /
  ledger. Sequential + concurrent duplicate → one ticket (proven live).
- **Draw execution** is execute-once (guarded status transition).
- **Ticket settlement** is idempotent (guarded `RESERVED → RESOLVED` + idempotent `commitReservation`)
  — a re-settle is a no-op; duplicate draw execution adds no ledger rows (proven live).

## Failure recovery

Handled without any `LotteryRecoveryService`:

| Scenario | Handling |
|---|---|
| Ticket bought, draw not executed | The draw scheduler re-discovers the due draw on the next tick / after restart. |
| Draw executed, settlement failed | Ticket → `PENDING_SETTLEMENT` (payout stored) → centralized recovery commits it. |
| Backend restart before settlement | State in DB; the sweep re-settles DRAWN draws' RESERVED tickets. Proven live. |
| Concurrent / duplicate draw execution | Guarded claim → exactly one execution, no double settlement. |
| Duplicate settlement | Guarded ticket claim + idempotent commit → no-op. |
| Pending recovery | `GameMoneyRecoveryService.recoverOne` → `RECOVERED`. Proven live. |

## Provably fair

The draw's `serverSeedHash` is committed at creation and exposed while OPEN; the `serverSeed` /
`clientSeed` / `nonce` and winning numbers are revealed after the draw, so anyone can re-derive the
seed (`deriveSeed`) and reproduce the winning numbers (`drawNumbers(new SeededRng(seed), pool, pick)`).
Unrevealed server secrets are never exposed prematurely.

## Financial invariant (every ticket)

`balanceAfter = balanceBefore − ticketPrice + prize`, `balanceAfter ≥ 0`, `ledger debit === credit`,
`reconcile().balanced === true`, `reconcile().difference === "0"`, no duplicate ledger entries, no
direct SQL balance mutation. Proven live: a jackpot ticket (6 matches → `ticketPrice × 50000`) and a
losing ticket (0 prize) on the same draw, invariant across the whole draw, reconcile balanced; and an
authenticated HTTP flow (2 tickets bought pending → scheduler executed the shared draw → both settled
against the same winning numbers).

## Mobile UX

Mobile-first (`LotteryMoneyBoard`): sticky authoritative balance + draw countdown; a large
touch-friendly 1–pool number grid (tap to toggle, capped at `pick`); Quick Pick / Clear / Confirm
Ticket; selected numbers shown prominently; ticket price, draw time and draw id; a my-tickets history
with winning numbers, matches and payout; and a provably-fair panel (draw commitment). No horizontal
overflow at 375/390/412. Duplicate-tap protection: Confirm requires a full pick and is guarded while
pending.

## Failure cases

| Case | Behaviour |
|---|---|
| Wrong count / out-of-range / duplicate picks | Rejected before reserving → `400`. |
| Insufficient balance | `reserve(ticketPrice)` rejects atomically → `400`; nothing debited. |
| Duplicate / concurrent purchase | One ticket, reserved once. |
| Settlement failure | `PENDING_SETTLEMENT` → automatic centralized recovery. |
| Backend restart | Draw + ticket state durable; the sweep resumes execution + settlement on boot. |
