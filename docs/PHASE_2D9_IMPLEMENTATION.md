# Phase 2D.9 — Implementation

Five requirement areas were implemented as complete vertical slices:
**X-02** (event pipeline + DAU/MAU), **P-17** (referral attribution), **AD-08** (promotions),
**PA-07** (partner activity report). No database schema change was required for any of them.

---

## 1. X-02 — Activity event pipeline

### 1.1 The store

Writes the **existing** `user_activities` table (0 rows and 0 writers before this phase). No new
model, no new migration.

### 1.2 `ActivityEventService` — `modules/events/activity-event.service.ts`

Three properties make it safe to call from production code paths:

**Deterministic identity.** The row id is a UUIDv5-style SHA-256 digest of the caller's `eventKey`:

```ts
export function activityEventId(eventKey: string): string   // sha256 → RFC-4122 v5 shape
```

So a retried request that resolves to the same underlying object produces the *same* row id, and
Postgres — not application logic — enforces exactly-once. A `P2002` unique violation is treated as
**proof the idempotency worked**, not as an error.

**It cannot break the thing it observes.** `record()` never throws. An analytics row must never be
able to fail a sign-in, a deposit or a bet.

**Credentials cannot reach it.** `sanitiseMetadata()` walks the metadata recursively and drops any
key whose name matches a credential-shaped term (password, token, secret, seed, backup code, jwt,
refresh, authorization). This is a key-name filter applied at every depth, not a top-level check.

### 1.3 Where events are emitted

| Event | Emitted in | Key | Why there |
|---|---|---|---|
| `LOGIN` | `auth/services/account-security.service.ts` (`recordLogin`, success only) | `login:<loginHistoryId>` | Keyed to the login-history row, so the event is exactly as unique as the login it describes. |
| `DEPOSIT` | `wallet/cashier.service.ts` (`createDeposit`) | `deposit:<depositId>` | A replayed idempotent request resolves to the same deposit row and therefore the same event id. |
| `GAME_PLAY` | `gaming-money/game-money.controller.ts` | `round:<roundId>` | **At the controller, after the bridge returns.** `GameMoneyBridge` is frozen and was not touched. |

Metadata carries only non-identifying context (`countryCode`, `gameKey`, `variant`, `currency`,
deposit `status`). No IP-derived identity, no user agent, no token.

### 1.4 DAU / MAU — `AnalyticsService.engagement()` + `GET /analytics/engagement`

Definitions are **returned in the payload** so a reader cannot silently reinterpret them:

- **DAU** — distinct users with ≥1 recorded activity event in a UTC calendar day.
- **MAU** — distinct users with ≥1 recorded activity event in the 30 days ending at `to`.

Counted with `count(DISTINCT user_id)` in Postgres (the same technique 2D.7 introduced to stop
distinct-user counts scaling in application memory).

Three honesty properties:

1. **No backfill is stated, not hidden.** `dataAvailableFrom` is the earliest recorded event and
   `windowFullyCovered` is false whenever the requested window starts before it. When false, an
   extra `coverage` entry explains that earlier figures reflect *absent instrumentation, not absent
   activity*, and the console prints that sentence.
2. **Dormant ≠ quiet.** If the table has never been written, DAU/MAU are `null` **with a reason** —
   never `0`, which would assert "nobody was active".
3. **Retention, LTV, session time and bounce rate are declared unavailable with the specific missing
   input**, and no numeric field for them exists on the payload at all.

The 2D.6 `unavailableMetrics()` wording for `dau`/`mau`/`retention`/`ltv` was factually stale once
the pipeline existed ("user_activities are empty"), so it was rewritten to point at the new endpoint
and keep the caveat. The existing contract test — every reason must contain `NOT AVAILABLE` — was
**not** modified; the new wording satisfies it.

---

## 2. P-17 — Referral attribution

`modules/referral/{referral.service.ts, referral.controller.ts, referral.module.ts}`

**Implemented:** the player's own code (already generated at signup), the referral link, claiming a
code, the referrer↔referred relationship, both directions of the dashboard, and history.

**Deliberately not implemented, and declared:** qualification and reward. The requirement says
"qualifying deposit", but no threshold, currency or window is defined anywhere, and no reward amount
exists. Every relationship therefore stays `PENDING`, no wallet is touched, and **no earnings figure
is rendered** — a `0` would imply a reward had been calculated.

Correctness properties:

- **Duplicate attribution is impossible at the database level.** `ReferralHistory.referredId` is
  already UNIQUE, so two concurrent claims can only ever leave one row; the loser catches `P2002`
  and returns the winner's result instead of failing the caller.
- **Re-claiming the same code is idempotent success**, not an error (`alreadyClaimed: true`).
- **A different code after attribution is refused** and does not overwrite the existing referrer.
- **Self-referral is refused.**
- **No existence oracle.** An unknown code and a code belonging to a deleted user return the exact
  same message.
- **No client-supplied identity.** No route accepts a `userId`; the global validation pipe's
  `forbidNonWhitelisted` turns an attempt into a 400.

Admin view: `GET /admin/referrals`, read-only, behind the existing `users:read`.

---

## 3. AD-08 — Promotions administration

`modules/promotions/{promotions.service.ts, promotions.controller.ts, promotions.module.ts}`

Full CRUD over the **existing** `Promotion` model, plus a player-facing list.

- **Creating never publishes.** A promotion is always created `DRAFT`; `status` is not an accepted
  input at all.
- **Status transitions are table-driven** (`ALLOWED_TRANSITIONS`) and the write is a *conditional*
  `updateMany` on the previously-read status, so two concurrent operators cannot both win.
  `ENDED` is terminal, and an `ENDED` promotion cannot be edited.
- **The player list is computed, never hardcoded**: `ACTIVE` only, inside its scheduled window, and
  not past its redemption cap.
- **Awarding is blocked and says so.** No rule defines what a promotion pays, on what trigger, to
  whom, or how it is accounted for. The service has **no wallet collaborator at all**, there is no
  claim endpoint, and every response carries the reason.
- `maxRedemptions` cannot be lowered below the redemptions already recorded.

Authorization reuses the existing settings permissions rather than inventing new ones: read requires
`settings:read` (admin), every mutation requires `settings:write` (**super-admin only**). Promotions
are platform configuration, and nothing here moves money, so no financial permission is involved.

---

## 4. PA-07 — Partner activity report

`partner.service.ts#myActivityReport` + `GET /partner/report` and `GET /partner/report.csv`

The partner's own recorded history — creation, ownership-share changes, status changes, member
additions — read from the existing `audit_trails` store.

- **Isolation by construction.** The partner id comes from `myPartner(userId)`, i.e. the
  authenticated caller's own membership, and goes *inside* the where clause. No route accepts a
  partner id from a partner; a supplied `partnerId` query parameter is rejected as an unknown field.
- **Identities are withheld.** `IDENTITY_KEYS` strips the acting operator's user id and any member
  user id. A partner learns *what* changed, not which staff account did it.
- **Descriptions are built only from recorded values.** An unrecognised change lists its changed
  fields rather than inventing a sentence.
- **No monetary column exists**, and the blocked partner financials (`netProfit`, `partnerProfit`,
  `availableBalance`, `withdrawals`) are repeated with their reasons instead of an empty money table.
- **Truncation is reported**, never silent: one extra row is fetched to detect it.
- The CSV reuses 2D.7's injection-safe writer (`toCsv` + `safeFilename` + BOM + `nosniff`).

---

## 5. Frontend

| Surface | File | Notes |
|---|---|---|
| Player referral | `app/(dashboard)/referral/page.tsx` | Server-issued code, share link, one-time claim, history, honest "rewards not available" panel. No currency anywhere. |
| Player offers | `app/(dashboard)/offers/page.tsx` | Real `ACTIVE` promotions. A **separate route** from the fictional demo `/promotions` showcase, exactly as the real `/lobby` sits beside the demo `/games` lobby (2C.8 precedent). No claim button, no bonus value. |
| Admin promotions | `app/admin/promotions/page.tsx` | List/create/status. Write controls only for `settings:write`; the page states the server decides. Wide table scrolls inside its own container. |
| Engagement panel | `app/admin/analytics/page.tsx` | DAU/MAU with the server's own definition on screen, "Not available" instead of 0, and the coverage caveat whenever the window is not fully covered. Its `unavailable` reasons are folded into the page's existing honest list. |
| Partner report | `app/partner/page.tsx` | Recorded events, loading/error/empty/truncated states, and a plain statement that it is not a financial report. |

Clients: `lib/referral-api.ts`, `lib/promotions-api.ts`, plus additions to `lib/analytics-api.ts`
and `lib/partner-api.ts`. None declares an earnings, balance, award or commission field.

Navigation: **Offers** and **Refer a friend** added to the player nav; **Promotions** added to the
admin nav beside Settings (same permission family).

Demo isolation: `/referral` and `/promotions` were added to `DEMO_BLOCKED_PATHS`, so a demo session —
which holds no backend credential — is refused locally before a request reaches the wire.

---

## 6. What was deliberately NOT built

- **Referral leaderboard.** Ranking by *what* is unspecified. Choosing "by referral count" would be
  a silent reinterpretation of the requirement; choosing "by earnings" is impossible.
- **Referral rewards / qualifying deposit** — no threshold, currency, window or amount defined.
- **Promotion awarding** — no rule defines the payment, trigger, audience or accounting.
- **Retention / LTV / session time / bounce rate** — cohort definition missing, revenue definition
  missing, no session events, no page views.
- **Partner financial reports** — blocked on F-02.
