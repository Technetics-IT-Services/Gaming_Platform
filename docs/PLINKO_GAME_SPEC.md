# Plinko — Game Specification (Game Expansion v2.0, Sprint 1)

> A new Runtime-compatible game. It plugs into the **frozen** GameRuntime via the existing
> `RuntimeGameEngine` contract and moves money only through the frozen settlement/ledger. No
> platform, runtime, wallet, ledger, treasury or API code was changed. Module: `src/games/plinko/`;
> UI: `src/components/games/plinko/`; route: `src/app/(casino)/plinko/`.

## Game flow

```
Player enters bet → selects risk (Low / Medium / High) → selects rows (8/10/12/14/16)
  → Drop → provably-fair seed determines the path → ball falls through the pegs
  → landing slot → multiplier → settlement through the FROZEN runtime → wallet credit
```

## Engine

- `PlinkoEngine implements RuntimeGameEngine<PlinkoConfig, PlinkoPick, PlinkoState>` (`engineKey:
  'plinko-pro'`). `createRound` derives the path (provably-fair), resolves the landing bin +
  multiplier from the calibrated table, and returns an `IGameResult` with a **flexible settlement**
  (`SettlementType.Custom`, absolute `payout = round(stake × multiplier)`).
- Every drop credits `stake × multiplier` — a sub-1 bin returns part of the stake (a net loss,
  classified by the frozen settlement), a ≥1 bin is a net win. Nothing is hardcoded to win.

## Player choices

| Choice | Options | Effect |
|---|---|---|
| Risk | low / medium / high | selects the multiplier table (variance) |
| Rows | 8 / 10 / 12 / 14 / 16 | board height → number of pegs + slots (rows+1) |
| Bet | integer minor units | stake, validated by the frozen bet engine |

## Runtime integration (frozen APIs only)

```ts
const rt = new GameRuntime(createProviderSet(), player);
rt.registerEngine(new PlinkoEngine());
rt.registerGame({ gameId: 'plinko', engineKey: 'plinko-pro', category: 'instant', capabilities: { provablyFair: true, autoBet: true, ... }, config: { rows: 16, risk: 'medium', ... } });
const res = await rt.placeBet({ gameId: 'plinko', sessionId, stake: { amount, currency }, mode: BetMode.Single, selections: [{ pick: { rows, risk } }], idempotencyKey, clientSeed });
```

The runtime debits the stake, runs the engine, then the **frozen settlement** credits the payout.
The engine's `IGameResult` (with `state`/`fairness`) is delivered on the `ROUND_STARTED` event for the
UI animation.

## Frontend

Animated SVG board (peg grid + ball + slot multipliers), risk + row selectors, bet controls,
auto-play (with on-loss stake adjustment + stop-on-profit/loss), **fast mode**, replay, history strip,
provably-fair panel, sound toggle, dark casino theme, responsive mobile/tablet/desktop
(`layoutFor(viewportWidth, rows)`).

## Game engine internals

`PathGenerator` (`derivePath`), peg-collision walk (per-row ±1 step), `LandingSlotResolver` (count of
right steps), `MultiplierResolver` (`plinkoTable[bin]`), `AnimationTimeline` (`buildTimeline` +
`PlinkoAnimation`), `Replay` (`replayDrop`), `FastMode` (compressed timeline), `AutoPlay`
(`AutoPlayController`).

## History (reuses the existing history model)

Each drop records: bet, risk, rows, landing slot, multiplier, win/payout, server seed (on rotation),
server-seed hash, client seed, nonce, dirs (path), timestamp.

## Responsible gaming

Reused from the platform — **no new implementation**. Session/bet/loss limits, self-exclusion and
reality checks are enforced by the frozen bet engine / platform; a blocked bet surfaces the runtime's
error to the UI unchanged.

## Not modified

Runtime, Game Registry, Session Manager, Event Bus, Wallet, Ledger, Treasury, Payments, Compliance,
Operations, CRM, Partner, Analytics, Infrastructure, Security, Integrations, Resilience, Performance —
and the pre-existing `src/games/plinko-engine.ts` (this is a new, separate module).
