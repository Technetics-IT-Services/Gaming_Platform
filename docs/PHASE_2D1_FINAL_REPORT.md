# Phase 2D.1 — Final Report: Production Notifications

Companions: `PHASE_2D1_AUDIT.md` (Phase A) · `PHASE_2D1_IMPLEMENTATION.md`.
**Nothing committed. No Prisma migration. No frozen-surface change. No new dependency.**

---

## 1. Existing architecture

| Component | State before this phase |
| --- | --- |
| `Notification` / `NotificationTemplate` / `NotificationPreference` models | existed, **never written by any code** |
| `NotificationsService` | both methods threw `NotImplementedException` — live `GET /notifications` returned **501** |
| `NotificationsController` | routes declared with `@CurrentUser('id')`; conventions correct, service missing |
| `NotificationsGateway` | **real** — `/realtime` namespace, token-verified handshake, per-user rooms — and never called by anything |
| Event bus | **none** — `@nestjs/event-emitter` is not a dependency; `@OnEvent` appears nowhere |
| Frontend `/notifications` | 310-line page with a **hardcoded array** and `useState` read state lost on reload |
| Header bell | hardcoded 4-item list with a **permanently-fake "new" dot**, hidden below `md` |

## 2. What was missing

Persistence, read/unread state, unread count, event emission (nothing in the backend called
`NotificationsService`), deduplication, preference enforcement, a real UI, and a mobile entry point.

## 3. What was implemented

A production in-app notification system on the **existing schema**: real service, one central
orchestration layer, 11 wired real events, durable database-enforced idempotency, server-side
preference enforcement, and a mobile-first UI — with email/SMS/push honestly declared as deferred.

## 4. Event sources wired — 11

Deposit requested · deposit completed · deposit rejected · withdrawal requested · withdrawal escalated
· withdrawal approved · withdrawal completed · withdrawal rejected+refunded · password changed ·
account locked · account unlocked.

Every one already existed and already ran. **Nothing was invented.**

**Deliberately not wired, with reasons:** game settlement (`GameMoneyBridgeService` is **frozen** with
no non-frozen seam — and a notification per round would be UX noise: 100 rounds = 100 notifications);
login success (every login would notify — real platforms notify on *anomalous* login, which needs a
risk signal that does not exist); 2FA enable/disable (no service method exists to hook); referral /
promotion / partner / finance / support alerts (**no source events exist** — wiring them would be
fabrication).

## 5. API endpoints

`GET /notifications` · `GET /notifications/unread-count` · `GET /notifications/:id` ·
`PATCH /notifications/:id/read` · `PATCH /notifications/read-all`

All authenticated, all user-scoped from the JWT, `read-all` declared before `:id`, UUIDs validated by
`ParseUUIDPipe`. No admin notification surface (not a client requirement).

## 6. Persistence

Existing `Notification` table. `status: SENT` + `sentAt` on creation (in-app is delivered when
persisted), `status: READ` + `readAt` on read. Ordering `createdAt DESC, id DESC` — `id` is a UUIDv7,
so the tie-breaker is monotonic and pagination is deterministic (proven: 25 rows across 3 pages, 25
distinct ids, none duplicated or skipped).

## 7. Idempotency

The primary key is derived from the domain event via SHA-256 → RFC-4122 UUID. A duplicate insert
violates the PK, is caught as `P2002`, and returns `null` (success, not an error). Proven against real
Postgres:

| Scenario | Result |
| --- | --- |
| Same event twice | **1 notification** |
| 8 concurrent creates of the same event | **exactly 1 winner, 1 row** |
| Same event after a **full application restart** | **still deduplicated, 1 row** |
| Duplicate operator "complete deposit" (live) | `deposit.completed` × **1** |
| Duplicate operator "reject withdrawal" (live) | `withdrawal.rejected` × **1**, refunded once |
| Live database check | **44 notifications, 44 distinct ids** |

No in-memory deduplication anywhere.

## 8. Security

| Probe | Result |
| --- | --- |
| Player B lists notifications | sees **0** of Player A's |
| Player B `GET /notifications/{A's id}` | **404** (not 403 — ids cannot be probed) |
| Player B `PATCH .../read` on A's row | **404**, and A's row stays unread |
| `markAllAsRead` by A | B's unread count **unchanged** |
| Unauthenticated list / unread-count / read-all | **401** |
| `?userId=` injected on list | **400** |
| `userId` injected in the mark-read body | **ignored** — the route has no body DTO and the service reads only the JWT |
| Non-UUID id | **400** |
| Secret audit on changed backend files | clean — only comments mention credentials |
| Live `data` keys stored | `amount, currency, depositId, kind, reason, reference, refunded, transactionId, withdrawalId` — no secrets |
| XSS | no `dangerouslySetInnerHTML` anywhere on the surface; bodies render as text |

> One probe returned 200 where I had predicted 404: Player A marking **their own** notification while
> a spoofed `userId` was in the body. That is correct — the body is ignored and the row is A's. My
> expectation was wrong, not the product. Cross-player IDOR is covered by the 404s above.

## 9. Mobile UI

`/notifications` rewritten: real unread badge (**absent at zero** — no permanent fake dot), list,
read/unread visual state, timestamps, type labels, loading skeleton, empty state, error state,
mark-read, mark-all-read, deterministic pagination, and an explicit line that only in-app delivery
exists.

Entry point: the header bell, **now rendered at every breakpoint** (it was `md:`-only). No sixth
bottom-nav item was added.

**Certified 4/4 at 375×812, 390×844 and 412×915:** bell reachable and ≥44×44px, list server-backed
with real rows, mark-read persists across a reload, mark-all-read clears the badge and persists, zero
horizontal overflow.

> Mobile certification caught a real defect: the bell rendered at **38.5px**, because this app's root
> font scale makes Tailwind's `h-11` (2.75rem) smaller than 44px. Since the bell is the *only*
> notification entry point on a phone, it is now pinned in explicit pixels. This also explains a chunk
> of the 2C.18 touch-target findings — rem-based sizing is systematically under-target in this app.

## 10. Provider status — audited, never fabricated

| Channel | Status |
| --- | --- |
| **IN_APP** | **PRODUCTION** |
| EMAIL | `MailService` is a real nodemailer abstraction, but runs **log-only — no SMTP configured**. Classified **NOT PRODUCTION DELIVERY**. Deferred. |
| SMS | no provider, no credentials. Deferred. |
| PUSH | no FCM/APNs, no device-token registry. Deferred. |

Only `channel: IN_APP` rows are created (unit-tested). Neither the UI nor the docs claim an external
message was sent.

## 11. Tests

| Suite | Result |
| --- | --- |
| `notifications.service.spec.ts` *(new)* | **20 passed** |
| `notifications.integration.spec.ts` *(new, real Postgres)* | **11 passed** |
| `cashier.service.spec.ts` (+12 notification-wiring tests) | **37 passed** |
| `notifications-api.test.ts` *(new, frontend)* | **15 passed** |
| `p2d1-notifications.spec.ts` *(new, mobile × 3 viewports)* | **12 passed (4 × 3)** |
| **Backend total** (`RUN_DB_IT=1`, `--runInBand`) | **310 passed**, 43/44 suites, 0 failed *(was 277)* |
| **Backend stress** (`RUN_STRESS=1`) | **10 passed** |
| **Frontend total** | **834 passed / 65 files** *(was 819 / 64)* |

**+63 tests. Nothing skipped, disabled, weakened, or made to pass with fake data.**

Two of my own test defects were found and fixed rather than worked around: a `count()` race that made
a mobile test silently skip, and the bell-size expectation that exposed the real rem-scaling defect.

## 12. Financial regression

| Invariant | Result |
| --- | --- |
| `reconcile` endpoint | `balanced: true, difference: "0"` |
| Negative balances | **0** |
| Duplicate settlement / refund / deposit credit | **none** |
| Concurrency stress (100 same-key ops, 500 mixed) | **10/10 passed** |
| Notification failure during a deposit | deposit still **COMPLETED**, balance moved **exactly once**, ledger balanced |
| Notification on a no-op transition | **none emitted** |

**Zero financial side effects.**

## 13. Mobile verification

375×812 ✔ · 390×844 ✔ · 412×915 ✔ — 4/4 each. No horizontal overflow; tap targets ≥44px on every
notification control.

## 14. Frozen-surface audit

`wallet-engine/**`, `gaming-money/**`, `packages/database/prisma/**`: **zero files changed, no
migration.** Changes are confined to the notifications module, the cashier request-lifecycle layer,
two auth services, module wiring, the frontend notification surface, and tests.

## 15. Secret audit

No credential material in any changed file (only comments naming what must never be stored) and none
in the live `data` payloads. Logs carry `notificationId`, `type`, `userId` and error messages only.

## 16. Demo-wallet audit

`page.tsx`, `notifications-menu.tsx`, `notifications-api.ts`: **zero** demo-wallet references (the one
grep hit is a comment stating there is none). `/notifications` is additionally in
`DEMO_BLOCKED_PATHS`, so a demo session cannot reach the endpoint and is shown the real-account notice.

## 17. Updated client requirement coverage

| Area | Before | After |
| --- | --- | --- |
| **Notifications** | **0.0%** | **33.3%** |
| **OVERALL** | **44.0%** | **47.3%** |

Notification requirements are scored against the client's own list of **12 types**:

**Now GREEN (4):** deposit success · withdrawal status · withdrawal approved · large-withdrawal alert.

**Still RED (8):** bonus · referral reward · promotion · partner daily profit · monthly report ·
server alert · finance alert · support alert — **every one blocked by a missing source system**, not
by notification plumbing. The moment referral, partner, finance or support exists, wiring it is a
one-method change in `NotificationEventsService`.

The three security notifications (password changed, account locked/unlocked) are **real and shipped
but not counted** — they are not among the client's 12 listed types, and I will not inflate the score
with them.

## 18. Remaining gaps

1. Game-settlement notifications — needs a non-frozen seam (proposal in §19).
2. Email / SMS / push — provider credentials.
3. Notification preference UI — models and enforcement exist; no screen (not a client requirement).
4. Admin notification/broadcast surface — `Announcement` model exists, unused.
5. Realtime push to the open socket is best-effort only; the UI polls the unread count every 60s.

## 19. Next recommended phase

**Phase 2D.2 — Audit Completion & Security Hardening** (~3 days, no external dependency): audit records
for login, logout, admin login, game-configuration and settings changes (4/9 → 9/9), enforce admin 2FA,
add idle-timeout logout. It is small, additive, and closes the last security gaps before more surface
area is added.

Then **2D.6 derivable analytics**. Together with this phase that puts coverage near **57%** with no
third-party dependency.

**Proposal for game-settlement notifications (a later phase, needs approval):** rather than modify the
frozen bridge, add a thin non-frozen `GameNotificationService` invoked from the `gaming-money`
controller after `play()` returns, notifying only on **significant** outcomes (e.g. wins above a
configured multiple of stake) so the mailbox stays signal, not noise. The threshold would be
**BUSINESS-CONFIG REQUIRED** — I will not invent it.
