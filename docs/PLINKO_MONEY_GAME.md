# Plinko — Real Money (Phase 2C.6)

Single-shot real-money Plinko on the existing money bridge. The landing bin, multiplier, payout and
balance are **server-authoritative**; the multiplier tables come from the config endpoint (never
hardcoded in the UI).

## Engine — `engines/plinko-engine.ts`

A faithful, mechanically-verified port of the frontend `apps/frontend/src/games/plinko/math.ts`.

- `PLINKO_ROWS = [8, 10, 12, 14, 16]`, `PLINKO_RISKS = ['low','medium','high']`.
- `TARGET_RTP = 0.965`; shape `{ low:{gain:5,curve:2}, medium:{gain:35,curve:2.5}, high:{gain:400,curve:3.1} }`.
- `binomialProbs(rows)` — landing distribution across `rows+1` bins (fair coin per peg).
- `buildTable(rows, risk)` — the multiplier table (cached in `plinkoTable`), normalized so
  `Σ p_i · m_i = TARGET_RTP`.
- `playPlinko(rows, risk, seed): PlinkoResult` — derives the path from `new SeededRng(seed)`; per row
  `step = rng.next() >= 0.5 ? 1 : 0`; `bin = Σ steps`; `multiplier = table[bin]`. Returns
  `{ bin, multiplier, dirs, table }`.

### Parity with the frontend (proven)

`apps/frontend/src/games/plinko/backend-parity.test.ts` (23 tests, passing) imports **both** the
frontend math and this backend engine and asserts, for **all 15 boards** (rows × risk):

1. identical multiplier table, 2. identical expected RTP, 3. identical binomial probabilities,
4. identical landing-bin calculation, 5. identical payout multiplier, and 6. empirical RTP over
40 000 rounds within 0.02 of theoretical.

**RNG-source note (documented, not a game-math discrepancy):** the frontend animates the ball with a
per-row `nextFloat()`, while the server draws the whole path from a single `SeededRng` stream. This
is a difference in *where the randomness is sourced*, not in the game math — the multiplier table,
probabilities, landing-bin rule and payout formula are byte-identical. The original frontend engine
was **not modified**; only a test file was added to its directory.

## Money flow — `GameMoneyBridgeService.playPlinko`

`reserve(stake)` → `createCommit` → `deriveSeed` → `computePlinkoDrop` → `payout = stake × multiplier`
→ `commitReservation(payout)`. Idempotent by `idempotencyKey` (replay returns the stored result,
`replayed: true`, no second debit). Settlement failure → `PENDING_SETTLEMENT` (recovery drains it).

Stake limits: **min 1, max 10 000**.

## API

### `GET /api/v1/games/plinko/config`
Returns `{ rows, risks, limits:{min,max}, boards:[{ rows, risk, multipliers:[…] }] }` — the UI renders
slots directly from `boards[*].multipliers`.

### `POST /api/v1/games/plinko/play`
Body (DTO-whitelisted): `{ rows∈{8,10,12,14,16}, risk∈{low,medium,high}, stake, currency, clientSeed?, idempotencyKey }`.
Any of `payout/bin/multiplier/result/serverSeed/walletId/userId` in the body → **400**.
Returns the authoritative `{ roundId, rows, risk, bin, multiplier, table, stake, payout, balance:{available,total}, provablyFair, replayed }`.

## Frontend

- `lib/plinko-money-api.ts` — types + `getPlinkoConfig`, `getMainWallet`, `playPlinko`, `buildPlinkoRequest` (client sends only its choices), `newIdempotencyKey`.
- `components/games/plinko-money/use-plinko-money.ts` — react-query config+wallet; state `rows/risk/stake`; on success the balance is **synced from the server response** (never `prev − stake + payout`).
- `components/games/plinko-money/PlinkoMoneyBoard.tsx` — mobile-first: sticky authoritative balance, result multiplier + winning bin, slot row from config (fluid grid, no horizontal scroll at 375 px), rows/risk/stake selectors, large Drop button.
- Route: `app/(casino)/plinko-money/page.tsx`.

## Tests

- `backend-parity.test.ts` — 23 tests (parity + empirical RTP + server-authority assertions).
- `game-money-plinko-mines.spec.ts` — unit: reserve/commit once, `payout = stake × mult`, unsupported rows/risk rejected, insufficient balance.
- `game-money-plinko-mines.integration.spec.ts` — live: 10 drops (invariant every drop, reconcile balanced, wins & losses), insufficient + duplicate, pending recovery.
- `lib/plinko-money-api.test.ts` — contract (forbidden fields absent), balance parsing, error normalization, **no demo-wallet dependency**.
- Live HTTP smoke — 10 drops invariant, duplicate idempotencyKey → single debit, DTO rejects forbidden field + `rows=7`, reconcile balanced.
