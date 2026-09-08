# Phase 2C.17 — Implementation

Companion to `PHASE_2C17_AUDIT.md` (Phase A). Every change here is additive, uses primitives that
already existed, and required **no Prisma migration**.

---

## 1. P0-5 — Withdrawal approval returned HTTP 500 for every operator (NEW)

**File:** `apps/backend/src/modules/wallet/cashier.service.ts`

`approveWithdrawal` wrote `@CurrentUser('id')` — a `users.id` — into `withdrawal_requests.reviewed_by_id`,
which is FK-constrained to `admin_users(id)`. `admin_users` is a separate, empty table (0 rows vs 522
users), so every approval raised Prisma `P2003` → 500.

```ts
// before
reviewedById: adminId ?? null,                       // a users.id → P2003, always

// after
const reviewedById = actor?.id ? await this.resolveAdminUserId(actor.id) : null;
// resolveAdminUserId() looks the operator up through AdminUser.userId — the model's OWN optional
// unique link to users — and returns null when there is no linked admin record.
metadata: { ...(row.metadata as object ?? {}), reviewedByUserId: actor?.id ?? null }
```

Attribution is not lost: the real operator id is persisted in the existing `metadata` JSON column and
in the audit trail. No second identity system was adopted, no schema changed, and approval still moves
no money (funds are held at request time).

Also made idempotent: an already-`APPROVED` withdrawal returns the current view without a second
update or a duplicate audit record.

**Why no test caught it:** `cashier.integration.spec.ts:93` called `approveWithdrawal(wd.id, undefined)`,
so `reviewedById` was always `null` and the FK was never exercised — while production always passed a
real id. The spec now passes a **real operator**, exactly as `AdminCashierController` does.

## 2. P0-3 — Operator audit records for cashier actions

**Files:** `cashier.service.ts`, `admin-cashier.controller.ts`, `wallet.module.ts`

Reuses the **existing** `AuditService` (no second audit system). `SecurityModule` is now imported by
`WalletModule` to provide it.

The controller assembles the actor from the authenticated principal only — never from the request body:

```ts
private actor(user: AuthenticatedUser, meta: RequestMeta, req: Request): OperatorActor {
  return { id: user.id, roles: user.roles ?? [], requestId: req.id ?? null, meta };
}
```

Recorded transitions:

| Action | `AuditAction` | entityType |
| --- | --- | --- |
| deposit complete | `APPROVE` | `deposit_request` |
| deposit reject | `REJECT` | `deposit_request` |
| withdrawal approve | `APPROVE` | `withdrawal_request` |
| withdrawal reject | `REJECT` | `withdrawal_request` |
| withdrawal complete | `EXECUTE` | `withdrawal_request` |
| escalated approval refused | `EXECUTE` | `withdrawal_request` |

Captured: actor id, **actor roles**, action, target entity, affected user, reference, amount, currency,
from/to status, request id, IP and user-agent (via the existing `@ReqMeta()`), timestamp.

**Blocking policy — answered from the existing architecture, not invented.** `AuditService.record()`
already wraps its write in `try/catch` and only warns. Audit is therefore **non-blocking**, and every
call is placed **after** the money movement has committed, so a failed audit can never change a
financial outcome. Live-verified payload keys:

```
actorRoles affectedUserId amount currencyId escalated fromStatus outcome
reason reference refunded requestId threshold toStatus transactionId
```

No passwords, JWTs, refresh tokens, secrets, server seeds or payment credentials — asserted in both the
unit and integration suites.

## 3. P0-4 — Large-withdrawal escalation (BUSINESS-CONFIG REQUIRED)

**File:** `cashier.service.ts`

No threshold existed anywhere (`WithdrawalStatus` has no escalation state; `CASHIER_MAX_WITHDRAWAL` is
a hard *limit* that rejects, not an escalation). The client supplied no figure, so **none was invented**:

```ts
function largeWithdrawalThreshold(): number | null {
  const raw = process.env.CASHIER_LARGE_WITHDRAWAL_THRESHOLD;
  if (!raw?.trim()) return null;          // unset ⇒ escalation DISABLED ⇒ today's behaviour exactly
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : null;
}
```

- Server-side only; a client value is never read or trusted.
- Escalation is **re-derived from the stored `amount`** at approval, so it is persistent and
  restart-safe by construction, and a later threshold change is honoured with no backfill.
- Stamped into the existing `metadata` JSON at request time (`largeWithdrawal`, `thresholdAtRequest`)
  for transparency and audit.
- When escalated, approval requires the `super_admin` role; an ordinary operator is refused with
  `403`, **and the refusal is itself audited**. The refusal changes nothing — status stays
  `UNDER_REVIEW`, funds stay held.
- Hold/refund semantics are untouched.
- Exposed on `GET /cashier/config` as `largeWithdrawalThreshold` (display only; `null` when unset).

**Operational note found during live testing:** the `admin` role does **not** hold `wallets:adjust` —
only `super_admin` does (`ADMIN_PERMS` grants `wallets:read` + `transactions:read`). So today the
existing `PermissionsGuard` already limits *all* cashier approvals to super-admins, which makes the
escalation gate currently redundant in production. It becomes the operative control the moment a
finance/operator role holding `wallets:adjust` exists — which the client requirements call for.
**`wallets:adjust` was deliberately NOT added to the `admin` role**: widening who may move money is a
business/security decision, not a defect fix.

## 4. P0-1 — `/dashboard` demo money

**New:** `apps/frontend/src/components/dashboard/use-dashboard-money.ts`
**Changed:** `components/dashboard/player-sections.tsx`, `components/wallet/wallet-summary.tsx`

One hook decides where dashboard money comes from:

| Session | Balance | Transactions | Rounds |
| --- | --- | --- | --- |
| **Real** | `GET /wallet-engine/balances` → `available` | `GET /wallet/history` | `GET /games/history` |
| **Demo** | demo store, behind an explicit **Demo** badge | demo store | demo store |

- Every server query is `enabled: isReal` (`useRealSession()` from Phase 2C.15), so a demo session
  fires none of them.
- **No client-side balance arithmetic**: the balance is the server's `available`, rendered as returned.
- "Today" figures are a presentational roll-up of **server rows for today**, fetched with the API's own
  `from` filter — and `todayTruncated` is surfaced honestly when the server reports more rows than were
  fetched.
- Honest states: `—` (not a fabricated `0`) while loading, a visible error panel on failure, and
  loading/error/empty distinguished in the recent-activity cards.
- `PlayerHero` shows the "Demo Account" badge only for a demo session, and takes identity from the
  authenticated user for a real one.

## 5. P0-2 — Admin console authorization boundary

**New:** `apps/frontend/src/lib/admin-access.ts` (pure decision), `components/auth/admin-guard.tsx`
**Changed:** `app/admin/layout.tsx`

```tsx
<AuthGuard>      {/* proves WHO you are */}
  <AdminGuard>   {/* proves you may see this console */}
```

Default-deny on backend-resolved role slugs (`admin`, `super_admin`); demo sessions always denied.
While the session bootstrap is running it renders a neutral "Checking permissions…" shell — **no admin
UI flash, no login flash**. Verified live: a player at `/admin` gets only the "Not authorised" alert —
no header, no sidebar, no `<main>`.

**The backend remains the authority.** Nothing about the global `JwtAuthGuard`/`RolesGuard`/
`PermissionsGuard` or the 17 permission-guarded admin controllers changed.

## 6. Phase G — demo-wallet isolation

**New:** `components/wallet/demo-funds-badge.tsx`

Every remaining `useDemoWallet` consumer was classified:

| Consumer | Class | Action |
| --- | --- | --- |
| `use-dashboard-money.ts` | by design — the demo branch | none |
| `user-menu.tsx`, `mobile-drawer.tsx` | `.reset()` on logout only — displays nothing | none |
| `balance-pill.tsx` | already gated on `isDemoSession` (2C.15) | none |
| `bet-gate.tsx` (`/dice`, `/crash`, `/roulette`) | fun-play gate, never a `*-money` route | **labelled** |
| `lucky-wheel.tsx`, `mystery-chest.tsx` (`/promotions`) | demo-only rewards | **labelled** |
| `/bets`, `/vault`, `/store`, `/marketplace`, `/mailbox`, prototypes | legacy demo surfaces | left as-is, out of the money journey |

The **entire real-money journey** — `/dashboard`, `/lobby`, `/wallet`, `/wallet/history`, `/deposit`,
`/withdraw`, `/transactions`, `/game-history`, `/profile`, `/verification` and all 15 `*-money` routes —
now has **zero** demo-wallet dependency, enforced by a structural regression test.

---

## Files changed (18)

**Backend (5)** — `cashier.service.ts`, `admin-cashier.controller.ts`, `wallet.module.ts`,
`cashier.service.spec.ts`, `cashier.integration.spec.ts`

**Frontend source (9)** — `use-dashboard-money.ts` *(new)*, `player-sections.tsx`,
`wallet-summary.tsx`, `admin-access.ts` *(new)*, `admin-guard.tsx` *(new)*, `app/admin/layout.tsx`,
`demo-funds-badge.tsx` *(new)*, `bet-gate.tsx`, `lucky-wheel.tsx` + `mystery-chest.tsx`

**Tests (4)** — `dashboard-money.test.ts` *(new)*, `admin-access.test.ts` *(new)*,
`tests/mobile-cert/p2c17.spec.ts` *(new)*, plus the two backend specs above

**No** Prisma schema, migration, WalletEngine, wallet-core, ledger, settlement, GameMoneyBridge, game
engine or runtime file was modified.
