# Number Lottery — Game Specification (Game Expansion v2.0, Sprint 4)

> A new Runtime-compatible game built on a reusable **Scheduled Draw Engine**. It plugs into the
> FROZEN GameRuntime via the existing interactive `start`/`step` contract (start = buy ticket → debit;
> the scheduled draw fires step → settle) and moves money only through the frozen flexible settlement →
> ledger. No platform, runtime, wallet, ledger or API change. Module: `src/games/lottery/`; UI:
> `src/components/games/lottery/`; route: `src/app/(casino)/lottery/`.

## Game flow

```
Player buys a ticket → Quick Pick or Manual numbers → ticket stored (held in the runtime round)
  → scheduled draw starts (countdown) → provably-fair draw executed
    → winning tickets determined → prize calculated → settlement through the FROZEN runtime
```

## Default rules

- **Pick 6** numbers from **1–49**.
- Draw **6 main** numbers **+ 1 bonus** ball (7 distinct drawn; first 6 are main, 7th is bonus).
- **Ticket types:** Quick Pick (provably-fair), Manual, Multiple Tickets, Auto Replay.

## Engine (interactive)

`NumberLotteryEngine implements RuntimeGameEngine` (`engineKey: 'number-lottery'`).

- `start` buys the ticket: **manual numbers** (validated: 6 distinct, 1–49) or a **provably-fair quick
  pick**; state `AwaitingSystem` (the ticket is held until the draw), `gameState { numbers, quickPick,
  drawId }`. The runtime debits the ticket price here.
- `step({ type: 'draw', payload: { serverSeed, clientSeed, nonce } })` fires when the scheduled draw
  executes: the winning numbers are **derived from the draw's fairness** (in the payload) via the frozen
  provider — so **every ticket in the same draw resolves to the SAME numbers** and is independently
  verifiable. Matches → prize tier → `payout = ticketPrice × prizeMultiplier`; state `Completed`, flexible
  settlement (Win with the prize, or Loss with 0).

## Prize tiers (STEP 3)

| Tier | Condition |
|---|---|
| Jackpot | 6 matches |
| 5 + Bonus | 5 matches + the bonus is on the ticket |
| 5 | 5 matches |
| 4 | 4 matches |
| 3 | 3 matches |
| 2 | 2 matches |

The prize table is **configurable** and calibrated to a **96–97% RTP** (see `NUMBER_LOTTERY_RTP.md` and
`NUMBER_LOTTERY_PROBABILITY.md`).

## Scheduled Draw Engine

Reusable coordinator (`ScheduledDrawEngine`) — schedule, countdown, sales-window close, execute-once,
publish, replay, jackpot-pool accrual. See `DRAW_ENGINE.md`. Only Number Lottery uses it.

## Provably fair

Draw numbers + quick picks derive from `rng.nextFloat({ serverSeed, clientSeed, nonce*100 + index })`.
Exposed: server seed, hashed server seed, client seed, nonce, draw numbers, bonus, verification
(`verifyDraw` re-derives the draw — players can replay every draw).

## History / responsible gaming

History (reuses the platform model): ticket, numbers, prize tier, prize, draw id, seeds, nonce,
timestamp. Responsible gaming is reused from the platform — no new implementation.

## Runtime integration (frozen APIs only)

```ts
rt.registerEngine(new NumberLotteryEngine());
rt.registerGame({ gameId: 'lottery', engineKey: 'number-lottery', category: 'instant', capabilities: { multiplayer: true, provablyFair: true, ... }, config: LOTTERY_DEFAULT });
const { roundId } = await rt.startInteractive({ gameId: 'lottery', sessionId, stake: { amount: ticketPrice, currency }, mode: BetMode.Single, selections: [{ pick: { quickPick: true, drawId } }], idempotencyKey, clientSeed });
// when the scheduled draw fires:
await rt.submitAction({ roundId, action: { type: 'draw', payload: drawFairness } });
```
