# Real-Money Game Bridge (Phase 2B)

The first genuinely production-wired real-money game: authenticated **Dice**, stake → existing engine →
settlement → wallet/ledger. The bridge is **reusable** (game-agnostic orchestration) and consumes the
frozen services through their public interfaces — it never re-implements game math, wallet balances or the
ledger. Modules: `apps/backend/src/modules/gaming-money/`; game-round model
`packages/database/prisma/schema/game-money.prisma`; frontend `apps/frontend/src/components/games/dice-money/`
+ route `/dice-money`.

## Architecture

```
Authenticated POST /api/v1/games/dice/play   (JWT; userId from token, never the client)
        │
        ▼  GameMoneyBridgeService.playDice
  validate player (not blocked) → resolve currency → validate variant/bet/stake
        → idempotency (GameRound by userId+key)
        → WalletEngine.reserve(stake)          ── atomic: available → locked (overdraft-safe)
        → DiceEngine.play(variant,[bet])       ── EXISTING engine: authoritative result + payout
        → WalletEngine.commitReservation(win)  ── atomic: consume stake + credit win + double-entry ledger
        → GameRound SETTLED
        ▼
  { roundId, result, payout, balance (authoritative), provablyFair, … }
```

The bridge owns **orchestration + the `GameRound` record** only. `WalletEngineService` owns all money
(atomic, Serializable, Redis-locked, optimistic-versioned, non-negative); `DiceEngineService` owns the
game math + provably-fair.

## Request lifecycle & API contract

`POST /api/v1/games/dice/play` (auth required):
```json
{ "variant":"sic-bo", "betType":"big", "stake":"10.00", "currency":"INR", "clientSeed":"...", "idempotencyKey":"<uuid>" }
```
The client may send ONLY those fields. It may NOT send `payout`, `balance`, `result`, `walletId`,
`ledgerId` or `userId` — the DTO whitelist rejects extras (userId is always taken from the JWT). Response:
```json
{ "roundId","game":"dice","variant","betType","stake","currency","status",
  "result":{"values":[..],"total","isTriple","won","winningBets":[..]},
  "payout","balance":{"available","total"},"reference",
  "provablyFair":{"serverSeed","serverSeedHash","clientSeed","nonce"},"replayed" }
```
`GET /api/v1/games/dice/config` returns the variant limits + bet options for the client.

## Authentication

Global `JwtAuthGuard`; `@CurrentUser('id')` supplies the authenticated `userId`. Blocked statuses
(`SUSPENDED`/`BANNED`/`CLOSED`/`INACTIVE`) are rejected; `ACTIVE`/`PENDING` may wager (email-verification/KYC
gating is a later phase). No admin override, no anonymous access, no client-supplied identity.

## Wallet & transaction boundaries

All money moves through `WalletEngineService`:
- `reserve()` — a single Serializable Prisma transaction with a Redis wallet lock + optimistic version;
  `Balance.reserve` rejects overdraft. Idempotent on its key.
- `commitReservation()` — consumes the reserved stake and credits winnings, writing the **double-entry**
  ledger (bet: player DEBIT/house CREDIT; win: player CREDIT/house DEBIT) in one transaction. Idempotent.
- `releaseReservation()` — returns a reservation to available (refund).
The bridge never opens a wallet transaction, mutates a balance, or writes a ledger row itself.

## Idempotency

Every request carries an `idempotencyKey`; `GameRound` is uniquely keyed on `(userId, idempotencyKey)`.
A repeat returns the SAME settled round with no extra reserve/commit and zero additional ledger entries.
Concurrent duplicates collide on the unique constraint (one wins; the other resolves to the same round).
Verified live: replaying a key returns the same round with no balance change.

## Concurrency

Per-wallet Redis locks + Serializable isolation + optimistic `WalletBalance.version` serialize all
mutations of one wallet. The available-balance invariant is preserved under parallelism (overdraft
impossible). Verified live: 10 parallel bets on a 50 INR wallet — balance never negative; reconcile
balanced.

## Settlement & failure recovery

| Failure | Policy |
|---|---|
| Invalid player/currency/variant/bet/stake | reject BEFORE any money moves — **no financial mutation** |
| Insufficient balance (reserve) | atomic reject → **400**, round `FAILED`, nothing debited |
| Engine failure AFTER reserve | `releaseReservation` (stake **refunded**), round `FAILED` — never lose the stake |
| Settlement (commit) failure | round `PENDING_SETTLEMENT` — reservation kept, result stored; `recover()` re-commits (commit is idempotent) → `RECOVERED`. Never double-pay, never lose the stake |

Lifecycle: `CREATED → RESERVED → RESOLVED → SETTLED` (+ `FAILED` / `PENDING_SETTLEMENT` / `RECOVERED`).

## Ledger invariant

Financial invariant per round: `balanceAfter = balanceBefore − stake + payout`, `balanceAfter ≥ 0`. After
N rounds, `reconcile()` stays `balanced: true`, `difference: 0`. Verified live over 32 rounds
(debit == credit) and again after a backend restart.

## Game-engine boundary

The Dice engine (`games/dice-engine`, frozen) is called unchanged: `play(variant, [{type,amount}],
clientSeed)` returns the authoritative `settlement.totalBet` (stake) and `settlement.totalWin` (payout) plus
provably-fair metadata. No probability/RTP/fairness/payout code is touched. Payout is NEVER accepted from
the client.

## Frontend / mobile integration

`/dice-money` (mobile-first): sticky authoritative balance, bet chips, numeric stake chips (₹1/5/10/25/50)
+ input, large one-hand Play button, loading/result/error states, safe repeated-tap guard (fresh
idempotency key + pending guard). The balance shown is ALWAYS the server's authoritative value — the demo
wallet is NOT used on this path. Errors are mapped to actionable messages (insufficient balance, session
expired, in-progress, timeout). Verified at 375×812 / 390×844 / 412×915: no horizontal overflow; a live
play updates the balance (e.g. ₹500 → ₹510 on a win).

> Dev note: with `next dev` (`demoMode` on) the login page uses a demo session and the split-origin
> (`:3100`↔`:4100`) blocks `SameSite` cookie refresh; the money page itself is fully real-API-wired. In
> production (same origin behind nginx, `demoMode` off) the normal login → session → play flow works
> natively. The live mobile verification injected a real bearer to exercise the page against the real
> backend under dev.

## Transaction history

Every round produces standard `WalletTransaction` rows (`GAME_BET`, `GAME_WIN`) + `Ledger`/`LedgerEntry`
via the existing engine — surfaced by the existing `transactions` / admin-wallet endpoints. No duplicate
history system.

## Security considerations

Server derives userId (JWT) and every financial value; the client cannot submit payout/balance/result/
wallet/user. DTO whitelist rejects extra fields. No server seed is exposed beyond the engine's fairness
contract. No secrets/passwords/seeds are committed.

## Operational considerations

`PENDING_SETTLEMENT` rounds are recoverable via `GameMoneyBridgeService.recover(roundId)` (idempotent
re-commit) — a scheduled recovery sweep can drain them. Stake limits come from the engine ruleset
(`min`/`max`). Run order stays migrate → seed → boot; the new `game_rounds` table ships as an additive
migration.
