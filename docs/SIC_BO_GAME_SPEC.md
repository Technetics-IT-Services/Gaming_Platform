# Sic Bo — Game Specification (Game Expansion v2.0, Sprint 3)

> A new Runtime-compatible table game (single-shot, multiple simultaneous bets). It plugs into the
> FROZEN GameRuntime via the existing `createRound` engine contract and moves money only through the
> frozen flexible settlement → ledger. No platform, runtime, wallet, ledger or API change. Module:
> `src/games/sic-bo/`; UI: `src/components/games/sic-bo/`; route: `src/app/(casino)/sic-bo/`.

## Game flow

```
Player enters stake → selects one or more bet types (chips on the grid) → bets locked
  → three dice rolled (provably-fair RNG)
    → every winning bet evaluated strictly from the dice
      → total payout = Σ winning-bet returns
        → settlement through the FROZEN runtime → wallet credit
```

## Engine

`SicBoEngine implements RuntimeGameEngine` (`engineKey: 'sic-bo'`). `createRound` rolls three
provably-fair dice, evaluates **each** placed bet (`bet.selections[]` = `{ type, value?, amount }`),
sums the total return, and returns an `IGameResult` with **flexible settlement** (`SettlementType.Custom`,
`payout = Σ round(amount × betReturn)`). Losing bets return nothing. The engine never touches the
wallet/ledger.

## Betting system

| Bet | Wins on |
|---|---|
| Small | total 4–10 (loses on any triple) |
| Big | total 11–17 (loses on any triple) |
| Odd / Even | odd / even total (loses on any triple) |
| Single (1–6) | the number appears (tiered by 1/2/3 appearances) |
| Double (1–6) | the number appears ≥ 2 times |
| Triple (1–6) | a specific triple (all three = value) |
| Any Triple | any triple |
| Combo2 (a,b) | two specific different numbers both appear |
| Combo3 (a,b,c) | three specific different numbers all appear |
| Total (4–17) | the exact three-dice total |

Full probabilities + payouts in `SIC_BO_PROBABILITY.md`, `SIC_BO_PAYTABLE.md`, `SIC_BO_RTP.md`. All 72
distinct bets are calibrated to a uniform ~97.2% RTP.

## Provably fair

Each die = `rng.nextFloat({ serverSeed, clientSeed, nonce*100 + dieIndex })`. Exposed: server seed,
hashed server seed, client seed, nonce, dice results, verification (`verifyRoll` re-rolls from the
revealed seeds — players can replay every roll).

## History

Stake, selected bets, dice, winning bets, payout, seeds, nonce, timestamp.

## Responsible gaming

Reused from the platform — no new implementation (session/bet/loss limits, self-exclusion, reality
checks enforced by the frozen bet engine).

## Runtime integration (frozen APIs only)

```ts
rt.registerEngine(new SicBoEngine());
rt.registerGame({ gameId: 'sic-bo', engineKey: 'sic-bo', category: 'instant', capabilities: { multiBet: true, provablyFair: true, ... }, config: { minBet, maxBet, ... } });
const res = await rt.placeBet({ gameId: 'sic-bo', sessionId, stake: { amount: String(totalStake), currency }, mode: BetMode.Single, selections: bets.map((b) => ({ pick: b })), idempotencyKey, clientSeed });
```
