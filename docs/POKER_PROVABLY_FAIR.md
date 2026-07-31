# Texas Hold'em — Provably Fair (Sprint 5, STEP 5)

Modules: `src/games/poker/cards.ts` (shuffle) + `src/games/poker/provably-fair.ts` (replay/verify). Every
hand's deck is a deterministic function of the revealed seeds, using the **FROZEN**
`IProvablyFairProvider` — no new RNG.

## Deriving the deck

A fresh ordered 52-card deck is shuffled with a **Fisher-Yates** pass whose every swap draws an
independent float from the frozen provider:

```
for i = 51 downto 1:
    f = rng.nextFloat({ serverSeed, clientSeed, nonce: nonce*100 + (51 − i) })
    j = floor(f · (i + 1))
    swap(deck[i], deck[j])
```

The per-swap sub-nonce (`nonce*100 + swapIndex`) keeps each draw independent and lets a whole hand live
under one round nonce. The shuffle is a pure function of `(serverSeed, clientSeed, nonce)` — identical
seeds always yield the identical deck.

## Dealing

`deal(deck, seatCount)` takes cards off the **top** of the shuffled deck exactly as a live dealer would:
two hole cards to each seat (one at a time, alternating), then a burn before the **flop** (3), a burn
before the **turn** (1), and a burn before the **river** (1). Because it is positional off a fixed deck,
the entire deal is reproducible.

## What is exposed

Per hand the player receives: **Server Seed**, **Hashed Server Seed** (committed *before* the hand),
**Client Seed**, **Nonce**, the **Shuffled Deck**, their **Hole Cards**, and the **Board**.

## Verification & replay

| Function | Purpose |
|---|---|
| `shuffleDeck(rng, fairness)` | derive the deck from seeds |
| `verifyShuffle(rng, { serverSeed, clientSeed, nonce, expected })` | confirm a deck matches the seeds |
| `replayHand(rng, { serverSeed, clientSeed, nonce, seatCount })` | re-derive `{ deck, holes, board }` |
| `verifyHand(rng, { …, expectedDeck })` | confirm a full hand's deal |

The provider **commits** the hashed server seed before the hand and **reveals** the server seed after —
so a player can, after the fact, reproduce the exact shuffle, their hole cards and the community cards,
and confirm nothing was altered. Every hand is replayable.

## Tested guarantees (`poker.test.ts`)

- The shuffle is deterministic (same nonce → same 52-card deck; different nonce → different order).
- The deal yields 2 cards per seat + a 5-card board with **no card dealt twice**.
- `verifyShuffle` accepts the true deck and rejects a wrong nonce.
- `replayHand` / `verifyHand` reproduce the full deal from the revealed seeds.
