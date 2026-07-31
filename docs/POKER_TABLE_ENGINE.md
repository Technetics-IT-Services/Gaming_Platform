# Reusable Multiplayer Poker Table Engine (Sprint 5, STEP 1 & 2)

Module: `src/games/poker/table-engine.ts`. A **pure, additive** coordinator for a Texas Hold'em table.
It owns the **table + hand lifecycle** — seats, dealer rotation, dealing, betting rounds, side pots,
showdown, pot distribution — but **owns no money**: it computes each seat's `{ contributed, won }` and
the FROZEN runtime moves the chips (see `engine.ts` / `POKER_GAME_SPEC.md`). Deterministic: the deck is
derived from the frozen provably-fair provider.

## Seat management (STEP 1)

| Method | Purpose |
|---|---|
| `seatPlayer({ playerId, stack, seat? })` | seat a player (2–9 seats, buy-in bounds enforced) |
| `leave(seat)` | remove a player (between hands) |
| `disconnect(seat)` | mark disconnected — keeps seat + stack, auto-folds in-hand |
| `reconnect(seat)` | re-seat at the **same seat with the same stack** |
| `seats` / `button` / `hands` | table inspection |

## Hand flow (STEP 2)

```
startHand(rng, fairness)
  → rotate the dealer button to the next occupied seat
  → provably-fair shuffle (shuffleDeck) + deal (2 hole cards each, then flop/turn/river off the top)
  → post small & big blinds
  → PRE-FLOP betting  →  FLOP  →  TURN  →  RIVER   (each a StreetBetting round)
  → SHOWDOWN: evaluate best 5-of-7 for each surviving seat
  → build side pots → distribute (split ties) → write final stacks → fire tournament hooks
  → next hand (button moves on)
```

Positions follow standard rules: heads-up, the button posts the small blind and acts first pre-flop
(last post-flop); 3+ handed, the small blind is left of the button and pre-flop action starts left of the
big blind. Folded and all-in seats are skipped automatically. When only one contender remains the hand
ends **without** a showdown; when all-but-one are all-in the board is **run out** and shown down.

## Driving a hand

| Method | Purpose |
|---|---|
| `actor()` | seat to act, or `null` (street resolving / hand over) |
| `legalActions(seat)` | legal action types for the seat to act |
| `toCall(seat)` / `minRaiseTo()` | amounts for the UI |
| `act(seat, type, amount?)` | apply a betting action; auto-advances streets & showdown |
| `autoFold(seat)` | fold a timed-out / disconnected seat if it is their turn |
| `snapshot()` | UI/inspection view (board, pot, actor, per-seat stacks) |
| `holeCards(seat)` | a seat's own hole cards |
| `result` | the finished `HandResult` (per-seat `contributed`/`won`, pots, deck, fairness) |

## Chip conservation (test-asserted)

For every hand: `Σ contributed === Σ won + rake`, and with the default `rake = 0` the table's **total
chips are unchanged** across a hand. Side pots from unequal all-ins and split pots (odd chip to the
lowest seat) both preserve this invariant.

## Tournament extension points (STEP 7 — hooks only)

`config.tournament: TournamentHooks` is called by the engine but never implemented here:

- `blindSchedule` + `createBlindSchedule` / `currentBlindLevel` — blind escalation.
- `onEliminate(playerId, place)` — fired when a stack busts.
- `onRebalance(seatsRemaining)` + `suggestRebalance(seatCounts)` — table balancing.
- `onLeaderboard(standings)` — leaderboard integration.

A future tournament layer consumes these without any change to the table engine or the frozen platform.
