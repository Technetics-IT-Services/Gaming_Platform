# Phase 2D.6 — Analytics Security Tests

Every test below was **executed live** against the running backend (`http://localhost:4100/api/v1`)
with a real 2FA-verified `super_admin`, two freshly-registered real players, and an unauthenticated
client. Nothing here is a plan or a description of intent.

Harness: `analytics_attacks.js` (scratchpad; not committed to the repo — it drives the live API and
shells into the Postgres container).
Automated equivalents that **are** committed:
[analytics.service.spec.ts](../apps/backend/src/modules/analytics/analytics.service.spec.ts) (35 tests),
[analytics.integration.spec.ts](../apps/backend/src/modules/analytics/analytics.integration.spec.ts) (14 tests),
[analytics-api.test.ts](../apps/frontend/src/lib/analytics-api.test.ts) (18 tests).

---

## 1. Threat model

An analytics dashboard is an attractive target for three specific reasons, and each drove tests:

1. **It aggregates the whole platform.** A single leaked response could expose far more than one
   user's data — so responses must contain **no per-user identifiers at all**.
2. **It takes rich filters.** Date ranges, currency codes and game keys reach the database, some via
   raw SQL — so **injection and filter-bypass** must be proven inert.
3. **It is a privileged surface.** It must be unreachable without `analytics:read`, and a client must
   never be able to assert its own identity, role or permissions through it.

---

## 2. Results — 18 live attack tests

| # | Category | Attack | Expected | Observed | Result |
|---|---|---|---|---|---|
| 0 | Authorization | 2FA-verified admin → `GET /analytics/summary` (control: the surface genuinely works) | `200` | `200` | **PASS** |
| 1 | Authorization | Real player token → `GET /analytics/summary` | `403` | `403` | **PASS** |
| 2 | Authorization | Second player token → `GET /analytics/financial` | `403` | `403` | **PASS** |
| 11 | Authorization | Unauthenticated → `GET /analytics/summary` | `401` | `401` | **PASS** |
| 3 | Client-supplied identity | `?userId=<other user's id>` as admin | `400` | `400` | **PASS** |
| 4 | Client-supplied identity | `?role=super_admin` | `400` | `400` | **PASS** |
| 5 | Client-supplied identity | `?permissions=wallets:adjust` | `400` | `400` | **PASS** |
| 15 | Parameter smuggling | `?limit=999999` (arbitrary unknown filter) | `400` | `400` | **PASS** |
| 6 | Filter integrity | `?currency=ZZZ` (nonexistent currency) | **empty**, not platform totals | `roundsTotal === 0` | **PASS** |
| 7 | Range validation | `from > to` | `400` | `400` | **PASS** |
| 8 | Range validation | 11-year range (> 366 days) | `400` | `400` | **PASS** |
| 13 | Range validation | `?from=not-a-date` | `400` | `400` | **PASS** |
| 9 | Filter integrity | `?gameKey=definitely-not-a-game` | **empty**, not all games | `roundsTotal === 0` | **PASS** |
| 10 | Data-scope leakage | `?gameKey=fruit-slots` (a demo/non-real-money key) | no leakage | `200`, empty | **PASS** |
| 14 | Injection | `?gameKey=dice' OR 1=1--` | inert | `200`, `roundsTotal === 0` | **PASS** |
| 14.1 | Injection | `?currency=INR'; DROP TABLE users;--` | inert | rejected/empty; **`users` table intact** | **PASS** |
| 15.1 | Data leakage | Scan full `summary` response for `password`, `passwordHash`, `refreshToken`, `accessToken`, `serverSeed`, `secret`, `totp`, `"userId"`, `"email"` | none present | `none` | **PASS** |
| 12 | Demo isolation | Demo/unauthenticated → `GET /analytics/daily` | `401` | `401` | **PASS** |

**RESULT: 18 passed, 0 failed.** After the injection attempts, the `users` table was queried
directly in Postgres and was still present with its full row count — the injection strings reached
the database as **bound parameters**, never as SQL.

---

## 3. Why each control holds (not just that the test passed)

### 3.1 Authorization is server-side on every route
`@RequirePermissions(PERMISSIONS.ANALYTICS_READ)` is declared on the **controller**, so it applies to
all seven routes; there is no per-route opt-in that could be forgotten on a new endpoint. The global
guard chain (Throttler → JwtAuth → Roles → Permissions → AdminTwoFactor) runs before any handler.
A player token carries no `analytics:read`, hence `403` rather than `404` — the route is
acknowledged but refused, which is correct for an authenticated principal.

### 3.2 Client-supplied identity is structurally impossible
`AnalyticsQueryDto` accepts exactly five fields: `from`, `to`, `currency`, `gameKey`, `granularity`.
The global `ValidationPipe` runs with `forbidNonWhitelisted`, so `userId`, `role`, `permissions` and
`limit` are rejected with `400` **before the handler runs**. The service never reads identity from
the query at all — there is no code path that could honour one.

### 3.3 Injection is inert because nothing is interpolated
Two raw queries exist (win/tie counts and the daily series). Both are Prisma **tagged templates**;
every value — dates, currency id, game key, the status list — is a bound parameter. The status
comparison is written `status::text = ANY(${SETTLED_STATUSES})` rather than casting to the enum type
by name, so it is both parameterised and independent of the Postgres type name.

### 3.4 An unknown filter empties the result rather than being ignored
This is the subtle one, and it is deliberate. `currencyId()` resolves an unknown currency code to a
**sentinel UUID that matches no row** instead of returning `null`:

```ts
return row?.id ?? '00000000-0000-0000-0000-000000000000';
```

Returning `null` would have meant "no currency filter", so a typo like `?currency=USDD` would have
reported **platform-wide totals labelled as USDD**. Empty is the honest answer; silently-unfiltered
is a fabricated one.

### 3.5 The response contains no per-user data
Analytics returns aggregates only — counts, sums, averages, and grouped buckets. No endpoint selects
a `userId`, an email, or a per-player row. `users.playedInRange` is computed with
`distinct: ['userId'], select: { userId: true }` and **only its length is returned**; the ids never
leave the service. Two committed tests assert `"userId"` and `"email"` do not appear anywhere in a
serialised response.

### 3.6 Demo sessions cannot reach analytics at all
`/analytics` is in the frontend's `DEMO_BLOCKED_PATHS`, so a demo session never issues the request.
Server-side the guarantee does not depend on that: a demo session holds no bearer token, and an
unauthenticated analytics request is `401` (test 12).

---

## 4. READ-ONLY — proven, not asserted

The brief requires analytics to be read-only. Two independent proofs exist, both committed:

**Unit (`analytics.service.spec.ts`)** — the service is constructed against a Prisma mock that
exposes *only* read methods. The tests then assert that `create`, `update`, `delete` and `upsert` are
`undefined` on every model the service touches, and that the `wallet`, `ledger` and `ledgerEntry`
models are **absent from the mock entirely**. If someone later adds a write, the suite fails with a
`TypeError` rather than silently passing.

**Integration (`analytics.integration.spec.ts`)** — against real Postgres: snapshot the ledger's
total debits and credits, a real wallet balance, `walletTransaction.count()` and `gameRound.count()`;
run **every** analytics query (`summary`, `gaming`, `financial`, `users`, `operations`, `daily`);
snapshot again. The assertion is `expect(after).toEqual(before)` — nothing moved at all — plus
debits == credits before and after.

---

## 5. Scope and limits of this security testing

Stated plainly rather than implied:

- These 18 tests cover the **analytics surface**. They are not a platform-wide penetration test.
- Rate limiting on analytics routes is the **global** throttler; no analytics-specific quota was
  added, and none was tested beyond the global behaviour.
- No load or denial-of-service testing was performed. **L1 in the definitions doc stands**: wide
  ranges aggregate live with no caching, and the 366-day cap is the only bound. A privileged user
  repeatedly requesting maximal ranges could impose real database load — this is a **known, untested
  risk**, not a cleared one.
- Authorization was tested with a `super_admin` and ordinary players. There is no `finance` or
  `analyst` role in `ROLE_DEFINITIONS`, so no intermediate-privilege case exists to test.
- Testing was against the local disposable stack over HTTP. **HTTPS/TLS behaviour was not
  exercised** — the same environment limitation recorded in Phase 2C.15.
