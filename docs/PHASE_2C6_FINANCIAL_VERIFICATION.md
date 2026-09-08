# Phase 2C.6 — Financial Verification (Crash · Plinko · Mines)

Environment: **live Postgres + Redis** — container `gp_phase1_pg` (port 55432, db
`gaming_platform_phase1`) and `gp_phase1_redis` (port 56379), schema migrated + seeded. Backend built
(`nest build`) and booted on `:4100`; verification run over both the **service layer** (integration
specs) and the **HTTP layer** (authenticated smoke).

## Invariants asserted

For every settled action:
- `balanceAfter = balanceBefore − stake + payout` (exact, tolerance 1e-6)
- `balanceAfter ≥ 0` (no negative balance)
- ledger `debit === credit` (balanced double-entry)
- `reconcile.balanced === true` and `reconcile.difference === "0"`

## 1. Service-layer integration (`RUN_DB_IT=1`) — 8/8 passing

`game-money-plinko-mines.integration.spec.ts` (real services, real reservations, real ported engines,
no faked money):

- **Plinko:** 10 real drops — invariant holds every drop, reconcile balanced, both wins & losses seen; `table.length === rows+1`.
- **Plinko:** insufficient balance rejected; duplicate `idempotencyKey` → single debit.
- **Plinko:** `PENDING_SETTLEMENT` → recovery drains to settled.
- **Mines:** 5 sessions — wins via safe reveals + cashout, losses via mine-hit; the board is recomputed from the persisted DB seed and matches.
- **Mines:** concurrent reveal advances the state **exactly once** (actionSeq guard).
- **Mines:** wrong-user rejected; **restart reconstruction** (board rebuilt from seed after app re-init).
- **Mines:** `PENDING_SETTLEMENT` → recovery; final ledger reconcile balanced.

## 2. HTTP-layer smoke (authenticated, over the wire) — all green

Booted backend + logged in as the seeded super-admin; funded via `POST /admin/wallet/credit`; ran the
full flow through the controllers:

| Check | Result |
|-------|--------|
| Auth guard on `/games/plinko/config`, `/games/mines/config` | `401` when unauthenticated ✅ |
| DTO whitelist — `payout` in Plinko body | `400` (forbidNonWhitelisted) ✅ |
| DTO validation — `rows: 7` | `400` ✅ |
| Plinko — 10 drops | invariant held **every** drop (1 win, 9 losses) ✅ |
| Plinko — duplicate `idempotencyKey` | single debit, same `roundId` ✅ |
| Mines — 5 sessions (1 & 24 mines) | mixed win/loss; stake reserved on start; board **hidden** while active, **revealed** on settle; invariant on cashout & loss ✅ |
| Insufficient balance (`stake 999999`) | rejected ✅ |
| `GET /admin/wallet/reconcile` | `{"debit":"16581.1","credit":"16581.1","balanced":true,"difference":"0"}` ✅ |

## 3. Regression suites

| Suite | Result |
|-------|--------|
| Backend `tsc --noEmit` | 0 errors ✅ |
| Backend jest (unit) | **137 passing**, 51 skipped (DB-gated), 27 suites ✅ |
| Backend jest (integration, `RUN_DB_IT=1`, plinko/mines) | **8 passing** ✅ |
| Frontend `tsc --noEmit` | 0 errors ✅ |
| Frontend vitest (full) | **681 passing**, 55 files ✅ |
| Plinko parity (`backend-parity.test.ts`) | **23 passing** ✅ |
| New money-api contract tests (plinko + mines) | **16 passing** (part of the 681) ✅ |
| ESLint (new files) | clean ✅ |
| Frontend `next build` (production) | exit 0; `/plinko-money`, `/mines-money`, `/crash-money` compiled ✅ |

## Conclusion

The financial invariant holds across the service and HTTP layers for all three games; the ledger
reconciles to a zero difference; idempotency prevents double debits; the `actionSeq` guard prevents
double settlement; and recovery drains parked rounds. **No frozen financial surface was modified.**
