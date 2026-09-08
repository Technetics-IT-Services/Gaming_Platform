# Final Financial Integrity Report

**Verified directly against PostgreSQL on 2026-09-08, after Phase 2D.12.**

## Invariants

| Check | Result |
|---|---|
| `SUM(CREDIT) − SUM(DEBIT)` across **87,756** ledger entries | **0.000000000000000000** |
| Individually unbalanced ledgers | **0** |
| Negative wallet balances | **0** |
| Duplicate `wallet_transactions` idempotency keys | **0** |
| Duplicate `game_rounds` idempotency keys | **0** |
| Unauthorised balance creation | **0** |
| Users belonging to more than one partner | **0** |
| Partners with share > 100 | **0** |

## Reconciliation across the new money workflow

Phase 2D.12 made the operator deposit rail reachable. The ledger was measured **before and after**
every action performed through it:

| Action | Ledger difference |
|---|---|
| Player requests a deposit (PENDING) | unchanged |
| Operator credits the deposit (+₹2,500) | **still exactly 0** |
| Player requests a withdrawal (funds held) | **still exactly 0** |
| Operator rejects the withdrawal (funds refunded) | **still exactly 0** |
| Operator records and confirms an expense | **unchanged — an expense touches no player money** |

The last line matters: expenses are accounting records. `FinanceOpsService` and `ExpenseService`
create no ledger entry and hold no wallet collaborator, and the live harness asserts the ledger is
untouched by expense operations.

## Authorisation is verified SEPARATELY from accounting

A balanced ledger does **not** prove authorisation — the grant-bonus vulnerability balanced perfectly
while a player minted money, because the fraudulent credit was recorded correctly. The two are
therefore tested independently:

| Property | How verified |
|---|---|
| Accounting | Direct SQL over `ledger_entries` and `wallet_balances` |
| Authorisation | 218 live HTTP probes; per-route guard inventory of all 481 routes |

Both must pass. Both do.

## Money-route invariant

Across all 77 money-shaped mutating routes:

- routes accepting a **client-supplied `userId`**: **0**
- routes that **credit the caller**: **0**
- admin routes with **no permission or role**: **0**

The cashier console reinforces this at the UI layer: it contains **no amount input at all** — the
figure always comes from the player's own request, and the mobile suite asserts zero numeric inputs
on that screen. An operator decides *whether*, never *how much*.

## Test-data identification

Disposable accounts are prefixed `it_`, `p9`, `p10`, `p11`, `q9`, `m9`, `r10`, `s12`, `probe`.
Three non-terminal game rounds exist at handover, all owned by `it_*` integration-test accounts.
No real user holds a non-terminal round, and the ledger balances exactly.

The single historical `BONUS_CREDIT` posting (the Phase 2D.10 security probe, ₹1,000,000) carries a
matching audited `PENALTY` reversal; every probe account's combined net position is **0**.
