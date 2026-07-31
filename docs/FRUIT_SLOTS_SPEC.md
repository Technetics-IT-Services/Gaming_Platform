# Fruit Slots — Game Specification (Sprint 2)

> A new single-shot Runtime-compatible slot. It plugs into the FROZEN GameRuntime via the existing
> `createRound` engine contract and moves money only through the frozen flexible settlement → ledger.
> No platform/runtime/wallet/ledger change. Module: `src/games/fruit-slots/`; UI:
> `src/components/games/fruit-slots/`; route: `src/app/(casino)/fruit-slots/`.

## Format

Classic **5 reels × 3 rows**, **20 fixed paylines**. Symbols: Cherry, Lemon, Orange, Plum, Bell, Seven,
**Wild**, **Scatter**.

## Reels & spin

Five weighted reel strips (36 cells each; `reels.ts`). A spin picks one **stop** per reel (provably-
fair) and shows a 3-cell window per reel → the 3×5 matrix. `windowFor(strip, stop)` wraps the strip.

## Evaluation

- **Line wins** — each of the 20 paylines is evaluated left-to-right with **wild substitution**: the
  paying symbol is the first non-wild (or wild if the whole prefix is wild); count the leading run of
  `{ symbol, wild }`; 3/4/5 of a kind pays per the paytable (× line bet). Scatter breaks a line.
- **Scatter** — counted anywhere in the window; **3+** pays × total bet and **awards free spins**.
- **Free spins** — the awarded free-spin round is resolved within the same round with a **win
  multiplier** (×2), its wins accumulated into the payout (no re-trigger).
- **Total win** — `payout = round(totalUnits × lineBet)` where `lineBet = stake / 20`.

Settlement uses the frozen **flexible** path (`SettlementType.Custom`, absolute payout classified by
net); the engine never touches the wallet/ledger.

## Features

Free spins · bonus (free-spin) round · wild symbol · scatter symbol · multiplier wins · auto spin ·
turbo mode · quick stop · balance/win animation. See `FRUIT_SLOTS_PAYTABLE.md` and `FRUIT_SLOTS_RTP.md`.

## Provably fair

Each reel stop = `rng.nextFloat({ serverSeed, clientSeed, nonce*100 + spin*10 + reel })` (base spin =
0, free spins = 1..N). Exposed: server seed, hashed server seed, client seed, nonce, reel stops, symbol
matrix, winning lines, verification.

## History

Bet, reel stops, symbol matrix, winning lines, win amount, free spins, seeds, nonce, timestamp.

## Responsible gaming

Reused from the platform — no new implementation (session/bet/loss limits, self-exclusion, reality
checks enforced by the frozen bet engine).

## Runtime integration (frozen APIs only)

```ts
rt.registerEngine(new FruitSlotsEngine());
rt.registerGame({ gameId: 'fruit-slots', engineKey: 'fruit-slots', category: 'instant', capabilities: { provablyFair: true, autoBet: true, ... }, config: defaultSlotConfig() });
const res = await rt.placeBet({ gameId: 'fruit-slots', sessionId, stake, mode: BetMode.Single, selections: [{ pick: {} }], idempotencyKey, clientSeed });
```
