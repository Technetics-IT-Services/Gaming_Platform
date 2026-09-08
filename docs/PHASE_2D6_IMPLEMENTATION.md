# Phase 2D.6 — Implementation

What was built, why it was built that way, and what was deliberately **not** built.

Companions: [PHASE_2D6_AUDIT.md](PHASE_2D6_AUDIT.md) (evidence gathered before any code),
[PHASE_2D6_ANALYTICS_DEFINITIONS.md](PHASE_2D6_ANALYTICS_DEFINITIONS.md) (every metric's formula),
[PHASE_2D6_SECURITY_TESTS.md](PHASE_2D6_SECURITY_TESTS.md),
[PHASE_2D6_FINAL_REPORT.md](PHASE_2D6_FINAL_REPORT.md).

---

## 1. Starting point

| Surface | Before |
|---|---|
| `GET /analytics/summary` | **`501`** — `getDashboardMetrics()` threw `NotImplementedException` |
| `AnalyticsController` | one route, guarded by `@Roles(UserRole.ADMIN)` |
| `/admin/analytics` page | 24-line placeholder: *"Charts render here once the Analytics module aggregates platform data"* |
| `src/lib/analytics/` (frontend, 1,650 LOC) | orphaned simulation — 0 importers, 0 routes, 0 backend calls |

The placeholder was honest, which is why it was safe to replace: it never showed a fabricated number.
The orphaned `src/lib/analytics/` was **not** wired up (see §6).

---

## 2. Backend

### 2.1 Files

| File | Change | Purpose |
|---|---|---|
| `modules/analytics/dto/analytics-query.dto.ts` | **new** | `AnalyticsQueryDto` + `resolveRange()`; `MAX_RANGE_DAYS = 366` |
| `modules/analytics/analytics.service.ts` | **rewritten** (stub → 467 lines) | all aggregation; read-only |
| `modules/analytics/analytics.controller.ts` | **rewritten** | 7 routes, permission-guarded |
| `modules/analytics/analytics.service.spec.ts` | **new** | 35 unit tests |
| `modules/analytics/analytics.integration.spec.ts` | **new** | 14 DB-gated integration tests |

### 2.2 Routes

All `GET`, all under `@RequirePermissions(PERMISSIONS.ANALYTICS_READ)` declared on the **controller**
so no future route can forget it.

| Route | Returns |
|---|---|
| `/analytics/summary` | gaming + financial + users + operations + `meta`, in one round trip |
| `/analytics/gaming` | round counts, stake/payout per currency, outcomes, top games |
| `/analytics/financial` | ledger movements, deposits/withdrawals by status, fees |
| `/analytics/users` | registration, verification, activity counts |
| `/analytics/operations` | settlement queue, audit, security events, notifications |
| `/analytics/daily` | UTC daily series for rounds and cashier |
| `/analytics/unavailable` | the metrics the platform cannot produce, with reasons |

### 2.3 The five decisions that shaped the service

**1. A missing value is `null`, never `0`.**
`payoutToStakeRatio` returns `null` when stake is zero; `depositConversionRate` returns `null` when
there are no registered users. A ratio over zero is undefined, and `0` would read as "we measured it
and it was nothing".

```ts
return { currency: codes[g.currencyId] ?? g.currencyId, ratio: stake > 0 ? payout / stake : null };
```

**2. `meta.unavailable` ships on every response.** Twelve metrics the brief named — DAU, MAU,
retention, LTV, revenue, expenses, profit, partner profit, FX-consolidated totals, marketing
conversion, session time, bounce rate — are returned as an explicit list with the reason and the
missing source. The client renders the reason; it cannot accidentally render a zero.

**3. An unknown currency empties the result rather than being ignored.**

```ts
// An unknown currency filters everything out rather than being ignored — a silent
// "filter not applied" would report platform-wide totals under a currency label.
return row?.id ?? '00000000-0000-0000-0000-000000000000';
```

This is the difference between an empty answer and a **wrong** one. Returning `null` would have meant
"no filter", so `?currency=USDD` would have reported platform totals labelled USDD.

**4. Game-level and ledger-level figures are kept apart and labelled.** `game_rounds` has one row per
round; `wallet_transactions` has one per movement, and interactive games produce several. The audit
measured the gap and explained it fully (§3 there). The service never presents one as the other, and
the UI says so in words.

**5. Raw SQL only where Prisma cannot express the query, always parameterised.** Two places: the
win/tie counts (`payout > stake`, `payout = stake`) and the daily `date_trunc` series. Both are
tagged templates with every value bound. The status filter is written `status::text = ANY(...)` so it
does not depend on the Postgres enum's type name.

### 2.4 Range validation

`resolveRange()` rejects an unparseable date, `from > to`, a future `from`, and any range wider than
**366 days** — rejected with `400`, never silently clamped, because a clamped range would return real
numbers for a period the operator did not ask about. Default when omitted: last 30 days. All UTC.

---

## 3. Frontend

| File | Change |
|---|---|
| `src/lib/analytics-api.ts` | **new** — typed client; `qs()` omits empty filters |
| `src/app/admin/analytics/page.tsx` | **rewritten** from the 24-line placeholder |
| `src/lib/api-client.ts` | added `/^\/analytics(\/|\?|$)/` to `DEMO_BLOCKED_PATHS` |
| `src/app/admin/layout.tsx` | added `min-w-0` to the shell column (§4) |
| `src/lib/analytics-api.test.ts` | **new** — 18 tests |
| `tests/mobile-cert/p2d6-analytics.spec.ts` | **new** — 5 mobile tests × 3 viewports |

The page is gated on `useRealSession()`, so a demo session never renders it, and `/analytics` is
blocked at the transport layer as a second, independent barrier.

`Stat` renders **"Not available"** when its value is `null`, and a dedicated `analytics-unavailable`
panel lists every server-declared unavailable metric with its reason.

---

## 4. The mobile fix — a real pre-existing shell defect

The analytics mobile certification initially failed at 390 px with the **page itself** scrolling
sideways (`docScrollWidth = 594` against a 390 px viewport).

Rather than guess, the overflow was attributed by measuring every element's bounding box against the
viewport and then applying `min-width: 0` to each candidate ancestor one at a time and re-measuring:

```
my page root       [data-testid="admin-analytics"]        594 → 594   no effect
shell <main>       main.flex-1 px-4 py-6                  594 → 594   no effect
shell column       div.flex min-h-screen flex-1 flex-col  594 → 390   FIXES IT
```

The cause was in `app/admin/layout.tsx`, **not** in the new page: the shell's column is a flex item,
so its default `min-width: auto` sizes it to its widest content. Any admin page containing content
wider than the viewport would drag the whole page sideways instead of letting that content scroll in
its own container. It had never surfaced because no existing admin page had wide content —
`/admin` and `/admin/games` both measured 390/390.

The fix is one class, plus the shrink chain inside the analytics page:

```tsx
<div className="flex min-h-screen min-w-0 flex-1 flex-col">
```

This is a genuine bug fix that benefits every admin page, not a workaround for the new one. Prior-
phase admin mobile specs were re-run afterwards to confirm no regression (§7 of the final report).

---

## 5. Tests added

| Suite | Count | Proves |
|---|---|---|
| `analytics.service.spec.ts` | 35 | range validation, settled-status filter, currency separation, **null-not-zero**, unavailable declarations, and **READ-ONLY** (the Prisma mock exposes only read methods; `create/update/delete/upsert` assert `undefined`, and `wallet`/`ledger`/`ledgerEntry` are absent entirely) |
| `analytics.integration.spec.ts` | 14 | every aggregate equals the same figure computed directly in SQL; currencies stay separated; the daily series is never zero-filled; **running every analytics query changes no balance, no ledger total, no row count** |
| `analytics-api.test.ts` (frontend) | 18 | client contract + structural honesty (no demo import, no hardcoded dataset, "Not available" path present, UTC/per-currency wording present) |
| `p2d6-analytics.spec.ts` (Playwright) | 5 × 3 viewports | real server data on screen, honest unavailable panel, tables scroll in their own container, ≥44 px touch targets, **a real non-admin is refused** |

---

## 6. Deliberately NOT done

- **The orphaned `src/lib/analytics/` (1,650 LOC) was not wired up.** It is client-side simulation.
  Connecting it would have put fabricated numbers on an operator dashboard. It remains orphaned and
  is still reported as dead code.
- **No FX conversion.** `exchange_rates` is empty and nothing writes it. Every amount is per-currency.
- **No revenue, profit, expense, or partner metric.** No accounting definition and no source model
  exist. These are declared unavailable rather than approximated from deposits − withdrawals.
- **No DAU/MAU/retention/LTV.** No activity-event pipeline exists. `loggedInInRange` is exposed under
  its own honest name and explicitly labelled *not DAU*.
- **No frozen-module changes.** WalletEngine, wallet-core, ledger, settlement, GameMoneyBridge, the
  game engines, the provably-fair engines, the runtime and the game registry are untouched.
- **No schema change.** No migration was written; analytics reads existing tables only.
- **No caching or materialised aggregates.** Recorded as limitation **L1** rather than quietly
  shipped as a performance claim.
