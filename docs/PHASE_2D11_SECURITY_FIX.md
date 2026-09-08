# Phase 2D.11 — Security Fix Record

**Two defects fixed.** One was the CRITICAL authorization hole carried since 2D.10; the second was
found during this phase's regression runs and is a genuine production robustness defect.

---

## FIX 1 (CRITICAL) — `POST /wallet-engine/grant-bonus`

### 1.1 Why the change was necessary

Any authenticated player could grant themselves an arbitrary bonus and convert it into withdrawable
main-wallet funds. Reproduced live on 2026-09-07 with a freshly registered `user`-role account:

```
POST /wallet-engine/grant-bonus { amount: "1000000", wageringRequirement: "0" }  → 200
POST /wallet-engine/bonus/<id>/convert                                            → 200
balance after: 1,000,000.000000000000000000
```

The route carried **no `@RequirePermissions`, no role check, no environment guard and no amount
cap**, and bound the recipient to `@CurrentUser('id')` — the caller. Reconciliation stayed at
`difference: 0` throughout, because the credit was a correct double-entry posting. **The ledger was
never wrong; the authorization was.**

### 1.2 Choosing the narrowest fix — and why no client decision was needed

The proposal (`FROZEN_CHANGE_PROPOSAL_2D10_GRANT_BONUS.md`) offered two options. Before choosing, the
intended permission semantics were checked against the existing RBAC model rather than invented:

- `wallets:adjust` is already the platform's established permission for granting promotional credit.
- It is already exercised by `POST /admin/bonuses` (built in 2D.10): permission-guarded, idempotent
  on an operator reference, audited to the acting operator, and it grants to a **named** player.

**Guarding the frozen route in place would have required changing its shape**, because it has no
`userId` — an authorized version must grant *to* someone. That would have duplicated
`POST /admin/bonuses` exactly, creating a second source of truth for one operation.

A repository-wide search found **zero callers**: no frontend code, no test, no script. The only
source references were the route itself and a doc comment. (`lib/crm/crm-service.ts` also defines a
`grantBonus`, but that is quarantined simulation with 0 importers, enforced by the X-08 guard test.)

**There was therefore no ambiguity requiring a client decision.** Option A — remove the route — is
the narrowest change that closes the hole, removes no capability, and creates no duplicate.

### 1.3 Exactly what changed

**One file: `apps/backend/src/modules/wallet-engine/wallet-engine.controller.ts`**

1. The `grantBonus` handler and its `@Post('grant-bonus')` decorator were deleted, replaced by a
   comment recording what was removed, why, and where the authorized path lives.
2. `GrantBonusDto` was dropped from that file's import list (it had no other use there).

**Deliberately NOT changed:**

- `GrantBonusDto` remains in `wallet.dto.ts`. Deleting it is an unrelated edit to a frozen file, and
  an unused exported type has no runtime surface. Minimal scope.
- `BonusWalletService`, `WalletEngineService`, the ledger, settlement, `GameMoneyBridge`, the game
  engines, the runtime, the registry and the Prisma schema: **untouched**.

### 1.4 Why wallet accounting semantics are unchanged

This deletes an **entry point**, not a calculation. No money-handling code was modified: the same
`BonusWalletService.grant` still runs, unchanged, when an operator calls `POST /admin/bonuses`.
Conversion still enforces the wagering requirement. Reconciliation before and after: `difference:
0.000000000000000000`, 0 unbalanced ledgers, 0 negative balances.

### 1.5 The authorization boundary, stated

| Operation | Route | Requires |
|---|---|---|
| Grant a bonus to a player | `POST /admin/bonuses` | `wallets:adjust` + admin 2FA + audited + idempotent |
| List granted bonuses | `GET /admin/bonuses` | `wallets:read` + admin 2FA |
| Expire a bonus | `POST /admin/bonuses/:id/expire` | `wallets:adjust` + admin 2FA + audited |
| A player viewing their own bonuses | `GET /wallet-engine/bonus` | authenticated, self-scoped |
| A player converting a cleared bonus | `POST /wallet-engine/bonus/:id/convert` | authenticated, self-scoped, wagering enforced |
| **A player granting themselves a bonus** | **— no route exists —** | **impossible** |

### 1.6 Verification

**The regression test was proven non-vacuous.** The vulnerable route was temporarily reinstated and
the suite re-run: exactly the 3 exploit assertions turned red while the 10 covering the replacement
path stayed green. The route was then removed again and all 13 pass.

| Check | Result |
|---|---|
| Original probe replayed live against the running server | **404 at the first call** |
| Route present in the boot log's route table | **absent** |
| The 9 sibling `wallet-engine` routes | **all still mapped** |
| `grant-bonus-regression.integration.spec.ts` | **13/13 pass** |
| Live security suites (2D.9 + 2D.9b + 2D.10) | **172/172 pass** |
| Reconciliation after | **`difference: 0`, 0 negative balances** |

### 1.7 Cleanup of the probe artifact

The ₹1,000,000 created by the 2D.10 probe was reversed through the audited
`POST /admin/wallet/debit` path (never by deleting ledger rows, which would have unbalanced the
books). Verified: probe account balance `0.000000000000000000`; combined net position of every probe
account `0.000000000000000000`; the single `BONUS_CREDIT` posting in the database is that probe, with
its matching `PENALTY` reversal carrying an explanatory description.

---

## FIX 2 — the monitoring sampler could kill the process

### 2.1 How it was found

A full serial backend run terminated with a Prisma error thrown from `MonitoringService.sample` →
`AlertService.rules`. It did not reproduce on the next run, so it was investigated rather than
dismissed.

### 2.2 The defect

`apps/backend/src/modules/operations/services/monitoring.service.ts`

```ts
this.sampleTimer = setInterval(() => void this.sample(), SAMPLE_INTERVAL_MS);
```

`void` discards the promise. Any rejection inside a sampling cycle — a transient database or Redis
error — became an **unhandled promise rejection**, and under Node 18+ an unhandled rejection
terminates the process.

**This is a production defect, not a test artifact.** A momentary Postgres blip during a routine
5-second monitoring sample would take the entire API down. Observability must never be able to kill
the thing it observes.

### 2.3 The fix

The rejection is now caught, counted and logged at warning level; the sampler continues. One file,
one call site. `operations` is **not** a frozen surface, so no proposal was required.

### 2.4 Verification

A regression test in `operations.spec.ts` asserts the dangerous shape cannot return and that the
promise is caught. It strips comments first — the fix's own note quotes the old shape to explain it,
and a raw scan would have flagged that explanation.

---

## Files changed in this phase

```
apps/backend/src/modules/wallet-engine/wallet-engine.controller.ts   (FROZEN — see §1.3)
apps/backend/src/modules/wallet-engine/grant-bonus-regression.integration.spec.ts   (new)
apps/backend/src/modules/operations/services/monitoring.service.ts
apps/backend/src/modules/operations/services/operations.spec.ts
apps/frontend/src/components/shared/navigation.ts
apps/frontend/src/components/layout/header.tsx
apps/frontend/src/components/layout/sidebar.tsx
apps/frontend/src/lib/orphaned-simulation.test.ts
```

## Frozen-surface exception

**One, authorised by the Phase 2D.11 brief** ("Apply the smallest possible security fix").
`wallet-engine.controller.ts`: one route handler removed, one import name removed. No service, no
engine, no ledger, no settlement, no bridge, no schema. Verified by modification time — every other
frozen file is untouched.
