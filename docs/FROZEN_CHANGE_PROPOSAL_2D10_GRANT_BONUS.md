# FROZEN CHANGE PROPOSAL — `POST /wallet-engine/grant-bonus`

**Raised:** Phase 2D.10, 2026-09-07 · **Severity: CRITICAL** · **Status: PROPOSED — NOT IMPLEMENTED**

This document exists because the defect below sits on a **frozen surface**. Per the standing
instruction, the change has **not** been made. It requires explicit approval.

---

## 1. The defect

`apps/backend/src/modules/wallet-engine/wallet-engine.controller.ts:92`

```ts
// Used to provision a starter wallet & demo funds in non-production play.
@Post('grant-bonus')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Claim a promotional bonus (if eligible)' })
grantBonus(@CurrentUser('id') userId: string, @Body() dto: GrantBonusDto) {
  return this.bonus.grant({
    userId,
    currencyId: dto.currencyId,
    amount: dto.amount,                       // ← client-supplied AMOUNT
    wageringRequirement: dto.wageringRequirement,  // ← client-supplied REQUIREMENT
  });
}
```

The route has:

- **no `@RequirePermissions`** — the whole controller is authenticated-only; no route on it carries a
  permission decorator;
- **no role check** — any principal holding a valid access token reaches it;
- **no environment guard** — the comment says "non-production play", but nothing enforces that;
- **no amount cap** and **no eligibility check** — despite the summary saying "if eligible";
- **client-supplied `wageringRequirement`**, so the caller can set their own clearing condition to
  zero and convert immediately.

An ordinary player therefore grants themselves an arbitrary bonus and converts it into a
**withdrawable main-wallet balance** through the real ledger.

## 2. Evidence — reproduced live on 2026-09-07

Run against the running backend on `:4100` with a freshly registered account holding only the
`user` role:

```
player            : probe777355260@t.local
roles             : ["user"]
balance before    : 0

POST /wallet-engine/grant-bonus  { amount: "1000000", wageringRequirement: "0" }
grant-bonus status: 200
bonus_wallets row : 1000000.000000000000000000 / wagering 0.000000000000000000

POST /wallet-engine/bonus/<id>/convert
convert status    : 200
balance after     : 1000000.000000000000000000

ledger before     : 54006 entries | 40542910.599999999999996000
ledger after      : 54008 entries | 42542910.599999999999996000
ledger difference : 0.000000000000000000
```

**A `user`-role player created ₹1,000,000 of withdrawable balance in two HTTP calls.**

### 2.1 Why every existing control missed it

- **Reconciliation cannot detect it.** `WalletEngineService.credit` writes a correct double-entry
  pair, so `SUM(CREDIT) − SUM(DEBIT)` stays exactly `0` before and after. The ledger is not wrong —
  it faithfully records an authorised-looking credit. The defect is *authorisation*, not accounting.
  This is why 2C.11 through 2D.9 all reported `difference: "0"` while the hole was open.
- **The permissions guard never fires.** `PermissionsGuard` only acts where
  `@RequirePermissions` is present; a route with no decorator is simply allowed for any
  authenticated caller.
- **`AdminTwoFactorGuard` does not apply.** It is scoped to paths matching `/admin/`, and this route
  is `/wallet-engine/grant-bonus`.
- **The frontend never calls it**, so no UI test would have exercised it. `/wallet-engine` is in
  `DEMO_BLOCKED_PATHS`, but that is a client-side guard for demo sessions only — it does nothing for
  a real player with a real token, and nothing at all for a direct API call.
- **No existing test covers the route.** The wallet-engine suites test the *service*, which behaves
  correctly; the missing control is at the controller boundary.

### 2.2 Blast radius

| Question | Answer |
|---|---|
| Who can exploit it? | Any registered, active player. No elevated role, no 2FA. |
| Is the money withdrawable? | **Yes** — `convert()` credits `WalletType.MAIN` through the engine. From there `/cashier/withdrawals` is a normal flow. |
| Is it rate-limited? | Only by the global throttler. Amount per call is unbounded. |
| Does it leave a trace? | A `bonus_wallets` row and a `BONUS_CREDIT` ledger entry — but **no audit trail entry**, because `BonusWalletService.grant` does not call `AuditService`. |
| Has it been exploited in this database? | The only occurrence is the 2D.10 probe itself (account `probe777355260@t.local`), which was **reversed** through the audited `POST /admin/wallet/debit` path. Ledger difference confirmed `0` afterwards. |

### 2.3 Adjacent routes — checked, and clean

The same controller was reviewed end to end. The other money routes are **not** affected:

- `POST /wallet-engine/transfer` — moves the caller's own funds between their own wallet types; the
  engine enforces the balance.
- `POST /wallet-engine/bonus/:id/convert` — scoped to the caller's own bonus and refuses until the
  wagering requirement is met. Dangerous only because `grant-bonus` can create the bonus.
- `POST /wallet-engine/reward/redeem` — verified: checks the points balance and only **decrements**
  points; it credits no money.

The defect is confined to one route.

---

## 3. Why an existing seam cannot solve it

I looked for a fix outside the frozen surface first. None works:

1. **A new guard registered globally** would have to identify this route by path, i.e. a
   path-matching allowlist maintained in a second place. That is precisely the fragile pattern
   `AdminTwoFactorGuard` avoided by being *path-scoped to a prefix that fails closed*; here there is
   no prefix to key on, and a future rename silently disables the protection.
2. **Removing the route from the router at bootstrap** is not supported by Nest without editing the
   controller or the module — both frozen.
3. **A reverse-proxy / gateway block** is deployment configuration, not application code. It would
   protect one deployment and silently leave every other environment exposed, and it cannot be
   covered by the repository's own test suite.
4. **Leaving it and compensating** (alerting on `BONUS_CREDIT` entries) detects theft after the money
   is gone. Withdrawals are operator-reviewed, but relying on a human to catch it is not a control.

The correct fix is at the route itself, which is frozen.

---

## 4. Exact proposed change

**File:** `apps/backend/src/modules/wallet-engine/wallet-engine.controller.ts`
**Scope:** one route. No service, no engine, no ledger, no schema change.

### Option A — remove the route (recommended)

```diff
-  // Used to provision a starter wallet & demo funds in non-production play.
-  @Post('grant-bonus')
-  @HttpCode(HttpStatus.OK)
-  @ApiOperation({ summary: 'Claim a promotional bonus (if eligible)' })
-  grantBonus(@CurrentUser('id') userId: string, @Body() dto: GrantBonusDto) {
-    return this.bonus.grant({
-      userId,
-      currencyId: dto.currencyId,
-      amount: dto.amount,
-      wageringRequirement: dto.wageringRequirement,
-    });
-  }
```

Nothing in the frontend calls it (verified: zero references to `grant-bonus` outside this file and
its DTO). Operator-granted bonuses are served by the **new** `POST /admin/bonuses` surface added in
Phase 2D.10 — permission-guarded, amount-validated, idempotent and audited — which lives outside the
frozen directory and calls `BonusWalletService.grant` on the operator's behalf.

### Option B — guard it in place (if the route must survive)

```diff
   @Post('grant-bonus')
   @HttpCode(HttpStatus.OK)
+  @RequirePermissions(PERMISSIONS.WALLETS_ADJUST)
   @ApiOperation({ summary: 'Grant a promotional bonus to a player (operator action)' })
-  grantBonus(@CurrentUser('id') userId: string, @Body() dto: GrantBonusDto) {
+  grantBonus(@Body() dto: AdminGrantBonusDto) {
     return this.bonus.grant({
-      userId,
+      userId: dto.userId,          // an operator grants TO a player; never to themselves implicitly
       currencyId: dto.currencyId,
       amount: dto.amount,
       wageringRequirement: dto.wageringRequirement,
     });
   }
```

Option A is preferred: it removes the surface entirely rather than leaving a money-granting route on
a controller whose every other route is deliberately player-scoped and unguarded-by-design.

**Either option is a one-route change. Neither touches `WalletEngineService`, `BonusWalletService`,
the ledger, settlement, `GameMoneyBridge`, any game engine, the runtime, the registry, or the
Prisma schema.**

---

## 5. Financial risk

| | |
|---|---|
| **Risk of applying the change** | **Very low.** Option A deletes a route with zero callers in this repository. Option B adds a permission requirement to a route that should never have been reachable by a player. Neither alters how money is calculated, recorded or settled. |
| **Risk of NOT applying it** | **Unbounded.** Every registered player can mint withdrawable balance at will. This is the single highest-severity issue found in any phase of this project, and it is live in the current build. |
| **Migration/data risk** | None. No schema change, no backfill, no existing row is altered. |
| **Behavioural risk to players** | None for Option A — no client calls the route. Any deployment relying on it to "provision demo funds" must instead use the operator surface, which is the correct path anyway. |

---

## 6. Tests required before the change is accepted

1. **Regression proof of the defect** — an integration test asserting a `user`-role principal
   receives **403/404** from `POST /wallet-engine/grant-bonus`, so the hole cannot silently reopen.
2. **Operator path still works** — the new `POST /admin/bonuses` grants a bonus with
   `wallets:adjust`, is refused without it, is idempotent under replay, and writes an audit entry.
3. **Convert path unchanged** — an operator-granted bonus with a wagering requirement still refuses
   conversion until the requirement is met, then converts exactly once.
4. **Full wallet-engine suite** re-run unchanged (currently green) to prove the service layer is
   untouched.
5. **Reconciliation** — `difference: "0"`, zero negative balances, before and after.
6. **Live HTTP re-probe** — the exact two-call sequence in §2 must fail at the first call.

---

## 7. Recommendation

**Apply Option A before the 10 September delivery.** Until it is applied, the platform cannot be
described as financially safe in production, regardless of the reconciliation result — the ledger
balances precisely *because* the fraudulent credit is recorded correctly.

Awaiting approval. No frozen file has been modified.
