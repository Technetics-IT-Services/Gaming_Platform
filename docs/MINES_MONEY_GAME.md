# Mines — Real Money (Phase 2C.6)

Interactive real-money Mines on the existing money bridge. The mine positions, multiplier ladder,
payout and win/loss are **server-authoritative** and **hidden** while the round is live. Actions are
serialized exactly-once by the guarded `actionSeq` optimistic lock (the proven blackjack pattern),
and the board is reconstructed deterministically from the persisted seed on every request
(restart-safe — no in-memory engine state).

## Engine — `engines/mines-engine.ts`

Pure and deterministic (server-authoritative). 5×5 grid.

- `MINES_TILES = 25`, `MINES_MIN = 1`, `MINES_MAX = 24`.
- `gridMultiplier(tiles, mines, k) = round2( 0.99 · Π_{i<k} (tiles − i) / (tiles − mines − i) )` — the
  fair multiplier after `k` safe reveals, with a 0.99 house edge. Monotonically increasing in `k`.
- `mineBoard(tiles, mines, seed) = new SeededRng(seed).shuffle([0..tiles−1]).slice(0, mines).sort()` —
  deterministic mine placement from the derived seed.
- `revealTile(seed, tiles, mines, priorReveals, index): MinesRevealOutcome` →
  `{ hit, revealed, multiplier, cleared, board? }`.
- `cashoutMultiplier(tiles, mines, revealCount)` = `gridMultiplier(tiles, mines, revealCount)`.

## Interactive money lifecycle — `GameMoneyBridgeService`

| Step | Method | Behavior |
|------|--------|----------|
| Start | `startMines` | `assertStake` (min 1, max 10 000), validate `mines ∈ [1,24]`, `reserve(stake)`, `createCommit`, store hidden `MinesMeta{seed,tiles,mines,reveals}`, status `RESERVED`. Idempotent by `idempotencyKey`. Board is **null** in the response. |
| State | `minesState` | Returns the live round (board still hidden). |
| Reveal | `minesReveal` | Claim `actionSeq` (`updateMany where {id,RESERVED,actionSeq:S} → S+1`, count===1 wins) → `revealTile`: **hit** → `settleMines('0')` loss + reveal board; **cleared** → `settleMines(win)`; **safe** → persist grown reveals, stay `RESERVED`. |
| Cashout | `minesCashout` | Claim `RESERVED→RESOLVED`, `multiplier = cashoutMultiplier`, `board = mineBoard`, `settleMines(win)`. Guarded: requires ≥1 reveal; a duplicate lands after the status has moved and is a no-op. |

`settleMines` calls `commitReservation(payout)`; on failure it parks the round at
`PENDING_SETTLEMENT` for `GameMoneyRecoveryService` to drain. The stake is **reserved on start** (the
balance drops immediately), so a lost round needs no extra debit — the reservation is simply committed
with payout `0`.

### Concurrency, idempotency, recovery
- **Exactly-once actions:** two concurrent reveals/cashouts race on `actionSeq`; exactly one wins, the
  other is a no-op — verified live (concurrent reveal advances the state once).
- **Restart-safe:** the board is never held in memory; it is recomputed from `meta.seed` each call, so
  a mid-round backend restart reconstructs the exact same board.
- **Recovery:** `PENDING_SETTLEMENT` rounds are drained by the shared 2C.1 recovery service.

## API

- `GET /api/v1/games/mines/config` → `{ tiles, minMines, maxMines, limits:{min,max}, progressions:{ "<mines>": [mult after 1 reveal, 2, …] } }`.
- `POST /api/v1/games/mines/start` → body `{ stake, mines∈[1,24], currency, clientSeed?, idempotencyKey }`. Board hidden. Any `board/multiplier/payout/result/serverSeed/walletId/userId` in the body → **400**.
- `GET /api/v1/games/mines/:roundId` → current state (own round only; wrong user → 403/404).
- `POST /api/v1/games/mines/:roundId/reveal` → body `{ index∈[0,24] }`.
- `POST /api/v1/games/mines/:roundId/cashout` → settles at the current multiplier; response includes the **revealed board**.

Response shape: `{ roundId, active, status, stake, tiles, mines, revealed:[…], multiplier, potentialPayout, board:null|[…], hit, won, payout, balance:{available,total}, provablyFair }`. `board` and `serverSeed` are withheld while `active`.

## Frontend

- `lib/mines-money-api.ts` — `getMinesConfig`, `getMainWallet`, `startMines`, `revealMine(roundId,index)`, `cashoutMines(roundId)`, `buildStartRequest`, `newIdempotencyKey`.
- `components/games/mines-money/use-mines-money.ts` — interactive react-query hook; `sync(r)` sets round state and updates the wallet cache from the **authoritative** `r.balance`; guards double-taps (revealing an already-revealed tile, cashing out with 0 reveals).
- `components/games/mines-money/MinesMoneyBoard.tsx` — mobile-first: sticky authoritative balance + potential cashout, pre-round stake chips + mines-count selector + Start, active 5×5 grid with large touch-target tiles, current multiplier + potential payout, prominent Cash Out (disabled until a reveal, guarded against double-tap), settled state showing the revealed board + win/loss + New Round, error state.
- Route: `app/(casino)/mines-money/page.tsx`.

## Tests

- `game-money-plinko-mines.spec.ts` — unit: start reserves without settling, safe reveal grows the multiplier, mine-hit settles a loss, cashout wins, wrong-user + no-reveal rejected.
- `game-money-plinko-mines.integration.spec.ts` — live: 5 sessions (win via safe reveals + cashout / loss via mine-hit, board recomputed from the DB seed), concurrent reveal advances once, wrong-user + restart reconstruction, pending recovery, final reconcile balanced.
- `lib/mines-money-api.test.ts` — contract (forbidden fields absent, board hidden while active, revealed on settle), balance parsing, error normalization, **no demo-wallet dependency**.
- Live HTTP smoke — 5 sessions (mixed win/loss), stake reserved on start, board hidden while active + revealed on cashout, insufficient balance rejected, reconcile balanced.
