# Scheduled Draw Engine (Sprint 4, STEP 4)

A **reusable, additive** coordinator for scheduled, provably-fair draws. Module:
`src/games/lottery/draw-engine.ts`. It owns the draw *lifecycle* — scheduling, countdown, sales window,
execution, publication, replay and a jackpot-pool hook — but **owns no money**: it hands the draw result
to the game engine's settlement step, which runs through the FROZEN runtime/ledger. Only Number Lottery
uses it, but nothing is lottery-specific beyond the number-derivation config (`{ drawMain, range,
bonus }`).

## Lifecycle

```
schedule(id, drawAt)  →  [Scheduled]  → sales open until drawAt − closeBeforeMs
                                       → addTicket(id, ticketRef, contribution)   (accrues jackpotPool)
                       → [sales closed]  (salesOpen === false)
   now ≥ drawAt        → execute(rng, id, drawFairness)  → [Drawn]  → publishes DrawResult
                                       → replay(rng, id)  → re-derives the same result (verification)
```

## API

| Method | Purpose |
|---|---|
| `schedule(id, drawAt, { closeBeforeMs })` | create a draw |
| `countdown(id, now)` | ms until the draw |
| `salesOpen(id, now)` | are tickets still sellable? |
| `addTicket(id, ticketRef, contribution)` | register a ticket + accrue the jackpot pool (throws once sales close) |
| `execute(rng, id, drawFairness, now)` | derive the winning numbers once (idempotent); returns `{ result, tickets }` |
| `replay(rng, id)` | re-derive a published draw from its stored fairness |
| `dueDraws(now)` / `open(now)` | scheduler queries |

## Properties (all test-asserted)

- **Countdown** decreases toward the draw time and clamps at 0.
- **Sales window** closes `closeBeforeMs` before the draw; late `addTicket` throws.
- **Execute** requires `now ≥ drawAt`, is **idempotent** (re-executing returns the same result), and
  transitions to `Drawn`.
- **Replay** reproduces the exact published numbers from the stored fairness.
- **Jackpot pool** accrues from ticket contributions (a future-jackpot hook; not yet paid out).

## Draw derivation (provably fair)

`execute` derives the winning numbers via `deriveDraw(rng, drawFairness, config)` — `drawMain + (bonus?1:0)`
distinct numbers drawn from `1..range` using the frozen provider (`nextFloat({ serverSeed, clientSeed,
nonce*100 + index })`). The first `drawMain` are the sorted main numbers, the last is the bonus. Because
the same draw fairness is passed to every ticket's settlement `step`, all tickets in a draw resolve to
the identical, verifiable numbers.

## Multiplayer / shared draw

Many players' tickets (each a runtime interactive round in `AwaitingSystem`) share ONE draw. When the
draw fires, the engine executes once and the app drives each ticket's `submitAction({ type: 'draw',
payload: drawFairness })`, settling them all against the same numbers through the frozen ledger.

## Future jackpot support

`jackpotPool` accrues a configurable contribution per ticket. A future pari-mutuel jackpot tier can pay
from the pool (roll-over on no-winner) without changing the engine's interface — the hook is already in
place.
