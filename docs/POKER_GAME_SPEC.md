# Texas Hold'em Poker — Game Specification (Game Expansion v2.0, Sprint 5)

> A production-quality multiplayer Texas Hold'em game built on a reusable **Poker Table Engine**. The
> table engine is a PURE, additive coordinator (seats, dealing, betting, side pots, showdown) that owns
> **no money**; each seat's net result for a hand settles through the **FROZEN** `GameRuntime` (stake =
> chips contributed, settlement payout = chips won) → wallet → ledger. No platform, runtime, wallet,
> ledger or API change. Module: `src/games/poker/`; UI: `src/components/games/poker/`; route:
> `src/app/(casino)/poker/`.

## Money model on a frozen, single-player-stake runtime

The frozen runtime debits **one** stake per round and credits **one** settlement payout. Poker is
player-vs-player with dynamic, growing bets — so the money mapping is:

```
The Poker Table Engine plays the whole hand (deal → betting rounds → showdown → pot distribution),
producing for each seat { contributed, won }.  Then, PER SEAT:
   runtime.placeBet(stake = contributed)  →  PokerHandEngine.createRound  →  settlement.payout = won
     ⇒ wallet net = − contributed + won      (debit at start, credit at settle)
```

Because chips are conserved (Σ contributed = Σ pot = Σ won, rake = 0 by default), the table nets to zero
through the ledger. Uncalled bets are returned naturally by the side-pot math (a lone eligible seat wins
its own layer back). This mirrors how Sprint 4's lottery reconciled a *scheduled* draw with the
synchronous runtime — the coordinator owns timing/logic; the frozen runtime owns money.

## Default rules

- **No-Limit Texas Hold'em**, 2–9 seats, small blind 1 / big blind 2, buy-in 40–400 (configurable).
- Standard hand flow: **blinds → deal 2 hole cards → pre-flop → flop → turn → river → showdown → pot
  distribution → next hand** (button rotates each hand).
- Betting: **check, call, bet, raise, re-raise, fold, all-in**, with minimum-raise enforcement, **side
  pots** (unequal all-ins) and **split pots** (ties, deterministic odd-chip award).

## Components (all in `src/games/poker/`)

| File | Responsibility |
|---|---|
| `cards.ts` | provably-fair 52-card shuffle + deal (reuses `@/lib/deck`) |
| `hand-eval.ts` | best 5-of-7 evaluator, all categories, exact tiebreaks (`POKER_HAND_RANKING.md`) |
| `betting.ts` | single-street betting engine + `buildSidePots` + `distributePots` |
| `table-engine.ts` | reusable `PokerTableEngine` — seats, dealer rotation, hand flow, showdown (`POKER_TABLE_ENGINE.md`) |
| `tournament.ts` | reusable tournament **hooks only** (blind schedule, rebalance, elimination, leaderboard) |
| `provably-fair.ts` | replay/verify a hand from revealed seeds (`POKER_PROVABLY_FAIR.md`) |
| `engine.ts` | `PokerHandEngine` — the FROZEN single-shot runtime adapter (per-seat settlement) |

## Runtime integration (frozen APIs only)

```ts
rt.registerEngine(new PokerHandEngine());               // engineKey 'texas-holdem'
rt.registerGame({ gameId: 'poker', engineKey: 'texas-holdem', category: 'card',
                  capabilities: { multiplayer: true, provablyFair: true, tournament: true, ... },
                  config: POKER_DEFAULT });
// after the table engine plays a hand, settle each seat:
await rt.placeBet({ gameId: 'poker', sessionId, stake: { amount: String(seat.contributed), currency },
                    mode: BetMode.Single, selections: [{ pick: seatSettlement }], idempotencyKey });
```

## History (STEP 8, reused)

Each settled seat records through the frozen history: hand id, seat, hole + board cards, hand name,
contributed, won, net, and the provably-fair seeds + nonce — enough to replay the deal.

## Responsible gaming (STEP 9, reused)

Session limits, bet limits, loss limits, reality checks and self-exclusion are enforced by the frozen
platform around `placeBet`. No new responsible-gaming code.

## Tournament hooks (STEP 7)

Extension points only (`TournamentHooks`): tournament id, blind schedule, `onEliminate`, `onRebalance`,
`onLeaderboard`. The table engine calls them after each hand; tournaments themselves are **not**
implemented.
