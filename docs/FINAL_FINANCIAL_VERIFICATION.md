# Final Financial Verification

Verified against the live disposable stack (`gp_phase1_pg`:55432 · Redis :56379 · backend :4100)
**after** all work in this session: Phase 2D.7 (analytics hardening, reports, CSV export) and the
responsible-gaming enforcement layer.

---

## 1. Ledger reconciliation

Through the real admin API (`GET /admin/wallet/reconcile`), as a 2FA-verified `super_admin`:

```json
{
  "debit":  "13911449.899999999999998",
  "credit": "13911449.899999999999998",
  "balanced": true,
  "difference": "0"
}
```

| Invariant | Required | Observed |
|---|---|---|
| `difference` | `"0"` | **`"0"`** |
| `balanced` | `true` | **`true`** |
| Negative wallet balances (`available`, `locked`, `pending`, `total`) | 0 | **0** |
| Duplicate financial effects (stress suite) | 0 | **0** — 10/10 |

Reconciliation was run at three points and was balanced at every one: after the 2D.7 report/export
work, after the responsible-gaming live attack run, and after the full regression sweep.

---

## 2. New code is READ-ONLY with respect to money

### 2.1 Analytics and reports (2D.7)

Proven twice:

- **Unit** — the service is built against a Prisma double exposing only read methods; `create`,
  `update`, `delete`, `upsert` assert `undefined`, and `wallet`, `ledger`, `ledgerEntry` are absent
  from the double entirely.
- **Integration** — snapshot ledger debits/credits, a real wallet balance, and
  transaction/round/deposit/withdrawal/ledger-entry/audit counts; build **and export every report**;
  snapshot again. Assertion: `expect(after).toEqual(before)`. **Nothing moved.**

### 2.2 Responsible gaming

RG is a **gate**, not a money mover. It has no wallet, ledger, or bridge collaborator at all, and it
only ever *reads* the financial tables it measures usage from.

| Proof | Result |
|---|---|
| No `wallet`, `walletBalance`, `ledger`, `ledgerEntry`, `walletTransaction` collaborator | asserted `undefined` (unit) |
| `depositRequest` / `gameRound` expose `aggregate` but **no** `create/update/delete/upsert/updateMany` | asserted (unit) |
| Setting limits + restrictions + reading the overview | balance byte-identical, ledger balanced (integration) |
| **A BLOCKED wager** | balance unchanged, **no `game_round` row created**, ledger balanced (integration) |
| Live: blocked play | balance 4990 → 4990, player still had funds |

The last row is the one that matters: the refusal happens **before** any reservation, so a blocked
action leaves no financial trace whatsoever.

---

## 3. Enforcement is upstream of the money core

`ResponsibleGamingGuard` runs as a NestJS guard, i.e. **before the route handler**, therefore before
`GameMoneyBridge` or `CashierService` is entered — upstream of every reservation, debit and ledger
write.

**No frozen financial file was modified by this session's work.** `WalletEngine`, wallet-core, the
ledger, settlement, `GameMoneyBridge`, the game engines, provably-fair and the runtime were not
touched. Outside the new module, this session changed only: two controllers (decorator lines), two
module files (imports), `app.module.ts`, the analytics service/controller/DTO, and the config files
for the two new environment knobs.

**One precision, so the claim is exact:** `wallet-engine/services/wallet-transaction.service.ts`
shows as modified in `git status`. That change is **pre-existing and uncommitted from an earlier
phase** (Phase 2C financial traceability — it adds `fee`, `balanceBefore`, `currency` and `metadata`
to a transaction view). It was already present in the working tree at the start of this session and
was **not** altered here. Stated rather than glossed, because "the frozen core is untouched" would
otherwise be an overstatement of what `git status` actually shows.

---

## 4. Restart persistence

The integration suite rebuilds the **entire Nest application context** — as a restart would — and
re-asserts:

- a wager limit of 5 still blocks a wager of 1;
- the limit is still present with its stored value;
- the active restriction is still ACTIVE.

Enforcement state lives in Postgres, not in memory.

---

## 5. Concurrency and idempotency (unchanged, re-verified)

The **WalletEngine concurrency stress suite** was executed in full this session — it had been
silently skipped in the previous baseline behind a second env flag:

| Scenario | Result |
|---|---|
| S1(2/10/50/100): concurrent same-key credits apply **exactly once** | PASS ×4 |
| S2: 100 concurrent distinct-key debits — exact sum, no negative, ledger balanced | PASS |
| S3(2/10/50): concurrent commits of ONE reservation settle **exactly once** | PASS ×3 |
| S4: 60 × (2 concurrent same-key plays) → always one round, one settlement | PASS |
| S5: 500 mixed operations — reconcile balanced, no negative, no orphan reservations | PASS |

**10/10 passed.**

---

## 6. Live financial data at verification time

| Figure | Value |
|---|---|
| Ledger debits = credits | 13,911,449.899999999999998 |
| Negative balances | 0 |
| RG limits persisted | 35 |
| RG restrictions persisted | 36 |
| RG audit records written | 77 |

Fixture money used in live testing was funded through the **real deposit → operator-credit path**, so
every rupee has a ledger entry. An earlier draft of the harness would have written a balance directly
via SQL; that was rejected precisely because it would have unbalanced the ledger.

---

## 7. Limitations

- **FV-L1** — Verification is against the local disposable stack, not production data or volume.
- **FV-L2** — No load or soak testing of the money paths was performed in this session beyond the
  existing stress suite's bounded concurrency.
- **FV-L3** — One pre-existing flake was measured and left untouched: the Phase 2C.4 blackjack
  integration test's `hitsExercised >= 1` assertion fails roughly 1 run in 6, because across 10
  random hands none happened to deal below 12. It is a **statistical assertion about card deals, not
  a money assertion** — every money invariant passed in the failing runs. Not modified, because
  changing another phase's test to make a run green is out of scope and would weaken it.
