# Phase 2C.6 — Real-Money Game Money Architecture (Crash · Plinko · Mines)

This phase onboards **Crash**, **Plinko**, and **Mines** as production real-money games on the
**existing** money architecture. No new money infrastructure was built and no frozen surface was
modified. Game-specific code is limited to DTO mapping, validation, engine invocation, and result
transformation.

## 1. The reused (frozen) money core

Every real-money game routes through one component:

- **`GameMoneyBridgeService`** (`apps/backend/src/modules/gaming-money/game-money-bridge.service.ts`)
  owns the money lifecycle for **all** games. It is *not* a frozen file (it is the extension point),
  but it delegates every financial operation to frozen services and never re-implements wallet math.
  - `reserve(...)` → `WalletEngineService` places a hold (debit-to-reservation) atomically.
  - engine call → the game's pure, deterministic engine produces the authoritative result.
  - `commitReservation(..., payout)` → `WalletEngineService` converts the hold to a settled bet and
    credits any payout, writing balanced `LedgerEntry` rows (debit === credit).
  - Helpers reused unchanged: `loadPlayer`, `loadCurrency`, `assertStake`, `walletView`, `money`,
    `betSummary`, `fail`, `safeRelease`, `currencyCode`, and `recover()`.

- **`WalletEngineService`** (frozen): the only writer of wallets, reservations, ledger, treasury and
  settlement. Enforces `balanceAfter = balanceBefore − stake + payout`, `balanceAfter ≥ 0`, and
  idempotency by `idempotencyKey`.

- **`GameMoneyRecoveryService`** (frozen, Phase 2C.1): drains `PENDING_SETTLEMENT` rounds via
  `recoverOne()` → `commitReservation(payout)`. Crash/Plinko/Mines inherit recovery unchanged.

- **`ProvablyFairService`** (frozen): `createCommit()` → `{serverSeed, serverSeedHash, nonce}`;
  `deriveSeed(serverSeed, clientSeed, nonce)` → hex seed consumed by `SeededRng`.

**No Prisma financial model changed.** `GameRound.actionSeq` (added in 2C.4) is reused for the
interactive Mines lock; no migration was required for 2C.6.

## 2. Two settlement patterns

| Game   | Pattern      | Lifecycle |
|--------|--------------|-----------|
| Plinko | Single-shot  | `reserve(stake)` → `playPlinko(rows, risk, seed)` → payout = `stake × multiplier` → `commit(payout)` |
| Crash  | Interactive (live multiplier) | `reserve(stake)` → running round with hidden `crashPoint` → `cashout` settles at the server multiplier (2C.2) |
| Mines  | Interactive (reveal loop) | `reserve(stake)` → hidden board → N× `reveal` (grow multiplier) → `cashout` (win) or mine-hit (loss) → settle |

### Single-shot (Plinko)
`GameMoneyBridgeService.playPlinko(input)`:
1. `loadPlayer` + `loadCurrency` + `assertStake` (`min 1`, `max 10000`), validate `rows ∈ {8,10,12,14,16}` and `risk ∈ {low,medium,high}`.
2. Idempotency: `GameRound` keyed by `idempotencyKey`; a replay returns the stored result (`replayed: true`) with **no** second debit.
3. `reserve(stake)` → `createCommit()` → `deriveSeed` → `computePlinkoDrop(rows, risk, seed)` (pure).
4. `payout = money(stake × multiplier)` → `commitReservation(payout)`.
5. On settlement failure → `PENDING_SETTLEMENT` (recovery drains it).

### Interactive (Mines)
Mine positions, the multiplier ladder, payout and win/loss are **server-authoritative** and hidden
while the round is live. Actions are serialized **exactly-once** by the guarded `actionSeq`
optimistic lock (the proven blackjack pattern):

```
updateMany where { id, status: RESERVED, actionSeq: S } data { actionSeq: S+1 }  // count===1 wins
```

- `startMines` → `reserve(stake)`, `createCommit`, store hidden `MinesMeta` (seed, tiles, mines, reveals), status `RESERVED`.
- `minesReveal` → claim `actionSeq`, `revealTile(seed, tiles, mines, priorReveals, index)`:
  - **hit** → `settleMines(payout '0')` (loss), reveal board.
  - **cleared** (all safe tiles revealed) → `settleMines(win)`.
  - **safe** → persist the grown reveal set, stay `RESERVED`.
- `minesCashout` → claim `RESERVED→RESOLVED`, `multiplier = cashoutMultiplier(tiles, mines, revealCount)`, `board = mineBoard(tiles, mines, seed)`, `settleMines(win)`.
- Restart-safe: no in-memory engine state; the board is **reconstructed deterministically** from the
  persisted seed on every request, so a mid-round backend restart loses nothing.

## 3. Server authority & the DTO whitelist

Clients may send **only** their choices; the server computes everything else.

| Game   | Client may send | Server owns (rejected if sent) |
|--------|-----------------|-------------------------------|
| Plinko | `rows, risk, stake, currency, clientSeed?, idempotencyKey` | `bin, multiplier, payout, balance, result, serverSeed, walletId, userId` |
| Mines  | `stake, mines, currency, clientSeed?, idempotencyKey` (+ `index` on reveal) | `board, multiplier, payout, balance, result, serverSeed, walletId, userId` |

- `class-validator` DTOs with `whitelist + forbidNonWhitelisted` → any extra field is a **400** (verified live).
- `@CurrentUser('id')` supplies the user id; it is never read from the body.
- Suspended/banned users are refused by `loadPlayer`.

## 4. Provably fair

Reuses `ProvablyFairService`. `serverSeed` is withheld (`''`) while a round is live and revealed only
on settlement — for Plinko immediately (single-shot), for Mines when the round ends (cashout or
mine-hit). The commit hash is available up front so the outcome is verifiable after the fact.

## 5. What was added (all additive)

- `engines/plinko-engine.ts`, `engines/mines-engine.ts` — pure, deterministic result engines (server ports).
- `game-money-bridge.service.ts` — `playPlinko`, `startMines`, `minesState`, `minesReveal`, `minesCashout`, `settleMines`, response builders (Crash added in 2C.2).
- `dto/play-plinko.dto.ts`, `dto/mines.dto.ts`.
- `game-money.controller.ts` — 7 routes (see per-game docs).
- Frontend: `plinko-money-api.ts`, `mines-money-api.ts`, hooks, boards, and routes `/plinko-money`, `/mines-money` (Crash `/crash-money` from 2C.2).

See `PLINKO_MONEY_GAME.md`, `MINES_MONEY_GAME.md`, `CRASH_MONEY_GAME.md`,
`PHASE_2C6_MOBILE_UX.md`, and `PHASE_2C6_FINANCIAL_VERIFICATION.md`.
