# Hi-Lo — Game Specification (Game Expansion v2.0, Sprint 2)

> A new **interactive** Runtime-compatible game. It plugs into the FROZEN GameRuntime via the existing
> `start`/`step` engine contract and moves money only through the frozen flexible settlement → ledger.
> No platform, runtime, wallet, ledger or API change. Module: `src/games/hilo/`; UI:
> `src/components/games/hilo/`; route: `src/app/(casino)/hilo/`.

## Game flow

```
Player enters bet → first card dealt
  → predict Higher / Lower / Equal(optional)
    → next card revealed
      → correct  → multiplier grows → Continue or Cash Out
      → wrong    → lose the wager (bust)
```

## Engine (interactive)

`HiLoEngine implements RuntimeGameEngine` (`engineKey: 'hi-lo'`).

- `start` deals the first card (provably-fair) → `gameState { current, multiplier: 1, remaining deck,
  odds }`, state `AwaitingPlayer`, actions `['higher','lower','equal','cashout']`.
- `step`:
  - `higher | lower | equal` → draw the next card; **correct** ⇒ `multiplier ×= stepMultiplier`, new
    card, stays `AwaitingPlayer` (auto cash-out if the deck empties); **wrong** ⇒ `Completed`, loss
    settlement (payout 0).
  - `cashout` → `Completed`, win settlement, `payout = round(stake × multiplier)`. Cashing out is only
    allowed after at least one prediction (multiplier > 1).

Settlement uses the frozen **flexible** path (`SettlementType.Win` on cash-out, `Loss` on bust); the
engine never touches the wallet/ledger.

## Features

Multiple consecutive rounds · progressive multiplier · instant cash-out · auto cash-out · fast mode ·
auto play · replay · provably-fair verification. Live odds are shown per prediction; illegal
predictions (e.g. "higher" on an Ace) are disabled.

## Deck & probability

Standard 52-card deck (ranks 2..14, Ace high), drawn **without replacement**. Probabilities update as
the deck depletes. Full mathematics + RTP in `HI_LO_MATH.md`.

## Provably fair

Each card is drawn from the remaining deck via `rng.nextFloat({ serverSeed, clientSeed, nonce*100 +
drawIndex })`. Exposed: server seed, hashed server seed, client seed, nonce, cards, verification
(`verifyRound` replays the exact draws).

## History (reuses the existing history model)

Bet, outcome (win/bust), multiplier, cards, win amount, seeds, nonce, timestamp.

## Responsible gaming

Reused from the platform — no new implementation. Session/bet/loss limits, self-exclusion and reality
checks are enforced by the frozen bet engine; a blocked bet surfaces the runtime error.

## Runtime integration (frozen APIs only)

```ts
rt.registerEngine(new HiLoEngine());
rt.registerGame({ gameId: 'hilo', engineKey: 'hi-lo', category: 'instant', capabilities: { cashOut: true, provablyFair: true, autoBet: true, ... }, config: { allowEqual: true, houseEdge: 0.035, ... } });
const { roundId, step } = await rt.startInteractive({ gameId: 'hilo', sessionId, stake, mode: BetMode.Single, selections: [{ pick: {} }], idempotencyKey, clientSeed });
await rt.submitAction({ roundId, action: { type: 'higher' } });
await rt.submitAction({ roundId, action: { type: 'cashout' } });
```
