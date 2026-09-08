# Crash — Real Money (Phase 2C.6 · reused from Phase 2C.2)

Crash was already delivered as a production real-money game in **Phase 2C.2** on the same money
bridge. Phase 2C.6 **reuses it unchanged** — it is documented here for completeness and re-verified
live (see `PHASE_2C6_FINANCIAL_VERIFICATION.md`). No Crash code was modified in 2C.6.

See also the original `CRASH_REAL_MONEY.md`.

## Pattern — interactive, live multiplier

Crash is interactive with a live-rising multiplier and a hidden crash point:

1. `POST /games/crash/play` → `reserve(stake)`, `createCommit`, the round starts **running** with the
   `crashPoint` computed server-side and **withheld** from the client. The response carries no crash
   point (`crashPoint: null`) and no server seed.
2. The client renders a **display-only** multiplier curve (`multiplierAt(...)`, purely cosmetic — it
   never determines money).
3. `POST /games/crash/cashout` → the server settles at its **authoritative** multiplier:
   `won` if the cashout landed before the hidden crash point; `payout = stake × cashoutMultiplier`;
   otherwise the round busts and the reservation commits with payout `0`.
4. Optional `autoCashout` target is honored server-side.

Settlement writes balanced ledger rows via `commitReservation`; a settlement failure parks the round
at `PENDING_SETTLEMENT` for the shared recovery service (2C.1).

## API

- `GET /api/v1/games/crash/config` → variant, limits `{min,max,tableMax}`, `minMultiplier`, `maxMultiplier`, `growthRatePerSecond` (curve params for the display-only animation).
- `GET /api/v1/games/crash/state` → the caller's active running round, if any (crash point withheld).
- `POST /api/v1/games/crash/play` → body `{ variant, stake, currency, autoCashout?, clientSeed?, idempotencyKey }`. Server owns `payout/crashPoint/balance/result/walletId/userId` (rejected in the body).
- `POST /api/v1/games/crash/cashout` → body `{ roundId }`; returns the authoritative settled result `{ won, cashoutMultiplier, crashPoint, payout, balance }`.

## Frontend

- `lib/crash-money-api.ts` — `getCrashConfig`, `getMainWallet`, `playCrash`, `cashoutCrash`, `buildCrashPlayRequest`, `multiplierAt` (display-only), `newIdempotencyKey`.
- `components/games/crash-money/use-crash-money.ts`, `CrashMoneyBoard.tsx` — mobile-first; balance is synced from the authoritative response.
- Route: `app/(casino)/crash-money/page.tsx`.

## Verification (2C.6 re-run)

- `crash-money-api.test.ts` — contract (no server-owned fields in the request), authoritative-balance parsing, display-only curve monotonicity, error normalization, **no demo-wallet dependency**.
- Backend jest — crash engine + bridge specs green (part of the 137-test suite).
- The interactive live-multiplier lifecycle mirrors the Mines interactive pattern (reserve → hidden state → settle) and shares the same recovery path.
