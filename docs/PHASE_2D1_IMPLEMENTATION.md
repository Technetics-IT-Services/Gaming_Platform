# Phase 2D.1 — Implementation

Companions: `PHASE_2D1_AUDIT.md` (Phase A) · `PHASE_2D1_FINAL_REPORT.md`.

**No Prisma migration. No frozen-surface change. No new dependency.**

---

## 1. Data model (Phase B) — existing schema, unchanged

The audit proved the existing `Notification` model already carries recipient, type, title, body,
read state, timestamps, metadata and a source reference. **Nothing was added and no second
notification table was created.** `NotificationPreference` is reused as-is.

## 2. Idempotency (Phase F) — deterministic primary key

`notification-key.util.ts` (new, 47 lines):

```ts
export function notificationId(eventKey: string): string {
  const digest = createHash('sha256').update(NAMESPACE + eventKey).digest();
  const bytes  = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;   // RFC-4122 version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;   // IETF variant
  return /* 8-4-4-4-12 */;
}
```

The `Notification` table has no unique column besides its primary key — so the **primary key itself**
is derived from the domain event. A second insert for the same event violates the PK and is caught as
`P2002`, which the service treats as "already notified" (returns `null`, not an error).

Why this and not the alternatives:

| Alternative | Rejected because |
| --- | --- |
| new `dedupeKey` unique column | requires a migration; the schema is otherwise sufficient |
| partial unique index on `data->>'key'` | requires a migration |
| in-memory `Set` | forbidden by the brief, and **does not survive a restart** |

Properties this gives, all proven by integration test against real Postgres: **concurrency-safe**
(Postgres arbitrates — 8 concurrent creates produced exactly 1 row), **restart-safe** (a brand-new
application graph still deduplicated), **retry-safe**.

## 3. Service (Phase C)

`notifications.service.ts` — replaces the two `NotImplementedException` throws.

| Operation | Scoping |
| --- | --- |
| `listForUser` | `where: { userId, deletedAt: null }`, `orderBy [{createdAt:desc},{id:desc}]` |
| `unreadCount` | `where: { userId, readAt: null }` |
| `getForUser` | `findFirst({ id, userId })` → **404** if not owned (ids cannot be probed) |
| `markAsRead` | ownership checked, idempotent (already-read is not rewritten) |
| `markAllAsRead` | `updateMany where: { userId, readAt: null }` |
| `create` | idempotent, preference-checked |
| `safeEmit` | `create` wrapped so a failure can never propagate |

`userId` is **always** a parameter supplied by the controller from `@CurrentUser('id')` or by a
server-owned domain record. No method reads a request body.

**Pagination determinism:** `id` is a UUIDv7 (monotonic by creation time), so `createdAt DESC, id DESC`
is a total order — rows are never duplicated or skipped between pages even when several land in the
same millisecond. Proven with 25 rows across 3 pages.

## 4. Event orchestration (Phase D)

`notification-events.service.ts` (new) is the **single** place any notification is mapped. Services
inject it; nothing writes notification rows directly.

There is no event bus in this repository (`@nestjs/event-emitter` is not a dependency), so this is a
directly-injected orchestrator rather than a subscriber — no new infrastructure, synchronous after
commit, and fully testable.

**11 real events wired** (every one already existed and already ran):

| Event | Source | Type | Event key |
| --- | --- | --- | --- |
| Deposit requested | `CashierService.createDeposit` | TRANSACTION | `deposit:requested:{id}` |
| Deposit completed | `CashierService.completeDeposit` | TRANSACTION | `deposit:completed:{id}` |
| Deposit rejected | `CashierService.rejectDeposit` | TRANSACTION | `deposit:rejected:{id}` |
| Withdrawal requested | `CashierService.createWithdrawal` | TRANSACTION | `withdrawal:requested:{id}` |
| Withdrawal escalated | `CashierService.createWithdrawal` | TRANSACTION | `withdrawal:escalated:{id}` |
| Withdrawal approved | `CashierService.approveWithdrawal` | TRANSACTION | `withdrawal:approved:{id}` |
| Withdrawal completed | `CashierService.completeWithdrawal` | TRANSACTION | `withdrawal:completed:{id}` |
| Withdrawal rejected + refunded | `CashierService.rejectWithdrawal` | TRANSACTION | `withdrawal:rejected:{id}` |
| Password changed | `AuthService.changePassword` | SECURITY | `security:password-changed:{user}:{ts}` |
| Account locked | `AccountSecurityService.lock` | SECURITY | `security:account-locked:{user}:{ts}` |
| Account unlocked | `AccountSecurityService.unlock` | SECURITY | `security:account-unlocked:{user}:{ts}` |

Security events include the change timestamp in the key because a password may legitimately be changed
more than once — each change is a distinct event the player must see.

## 5. Financial safety (Phase E)

Three independent guarantees, each test-proven:

1. **Downstream by construction** — every `notify.*` call sits *after* the `WalletEngine` movement and
   after the status update has committed.
2. **`safeEmit` swallows everything** — proven by an integration test that mocks `create` to reject:
   the deposit still completes, the balance still moves by exactly the right amount, and the ledger
   stays balanced.
3. **No notification on a no-op** — an already-completed deposit or already-approved withdrawal moves
   no money and therefore emits nothing.

Notification `data` references the authoritative record (`depositId`, `withdrawalId`, `reference`,
`transactionId`); it never *is* the financial record.

## 6. API (Phase H)

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/notifications` | paginated, uses the existing `PaginationQueryDto` |
| GET | `/notifications/unread-count` | badge source |
| PATCH | `/notifications/read-all` | declared **before** `:id` so it is not captured |
| GET | `/notifications/:id` | `ParseUUIDPipe`; 404 if not owned |
| PATCH | `/notifications/:id/read` | `ParseUUIDPipe`; 404 if not owned |

Existing conventions reused throughout: global `JwtAuthGuard`, `TransformInterceptor` envelope,
`@CurrentUser`, `apiClient` + `unwrap()` on the frontend. No route collision — the module previously
declared only `GET /` and `PATCH /:id/read`.

## 7. Frontend (Phases I + J)

| File | Change |
| --- | --- |
| `lib/notifications-api.ts` *(new)* | typed client; never sends a `userId` |
| `app/(dashboard)/notifications/page.tsx` | **rewritten** — was a 310-line hardcoded array with `useState` read tracking lost on reload |
| `components/shared/notifications-menu.tsx` | **rewritten** — was a hardcoded 4-item list with a permanently-fake "new" dot |
| `components/layout/site-header.tsx` | bell moved out of the `md:flex` container so it renders **on phones** |
| `lib/api-client.ts` | `/notifications` added to `DEMO_BLOCKED_PATHS` (user-scoped) |

UI states: real unread badge (absent at zero), list, read/unread visual state, timestamp, type label,
loading skeleton, empty state, error state, mark-read, mark-all-read, deterministic pagination.

Mobile-first decisions:
- **No sixth bottom-nav item** — the nav already has 5 and the brief forbids a second navigation. The
  bell in the existing shell is the entry point.
- **Bell sized in explicit pixels (`minHeight/minWidth: 44`), not `h-11`.** Mobile certification
  measured the rem-based version at **38.5px** — this app's root font scale renders `2.75rem` below
  44px. Since the bell is the only notification entry point on a phone, it is pinned in px.
- All action buttons (`mark read`, `mark all`, pagers) use `minHeight: 44`.

## 8. Providers (Phase K) — audited, not fabricated

| Channel | Finding | Status |
| --- | --- | --- |
| **IN_APP** | `Notification` table + real `/realtime` gateway | **PRODUCTION** |
| EMAIL | `MailService` is a real nodemailer abstraction but logs *"Mailer running in log-only mode (no SMTP configured)"*; **no SMTP host/user/password anywhere** | **NOT PRODUCTION DELIVERY — deferred** |
| SMS | no provider, no client, no credentials | **deferred** |
| PUSH | no FCM/APNs project, no device-token registry | **deferred** |

Only `channel: IN_APP` rows are ever created (unit-tested). The page carries the line *"In-app
notifications only. Email, SMS and push delivery are not configured for this deployment."*

## 9. Preferences (Phase L)

`NotificationPreference` already exists with `@@unique([userId, type, channel])` and
`enabled @default(true)`. It is **enforced server-side** in `create()`: an absent row means enabled;
`enabled: false` suppresses the notification and logs the suppression.

**No preference UI was built** — the client requirement does not ask for one. Current default
behaviour: all in-app notification types enabled for every player. Configurable today: per
`(user, type, channel)` enable/disable via the existing table. Not configurable: channel routing
(only IN_APP exists), digest/batching, quiet hours.

## 10. Observability (Phase M)

Structured Winston logs at exactly four points: `notification created`, `notification deduplicated`,
`notification processing failed`, and preference suppression. Each carries only `notificationId`,
`type`, `userId` and an error message.

**No delivery monitoring was added**, because there is no external delivery to monitor — inventing a
delivery metric would be fabrication.

## 11. Files changed — 16

**New (7)** — `notification-key.util.ts`, `notification-events.service.ts`,
`notifications.service.spec.ts`, `notifications.integration.spec.ts`, `lib/notifications-api.ts`,
`lib/notifications-api.test.ts`, `tests/mobile-cert/p2d1-notifications.spec.ts`

**Rewritten (4)** — `notifications.service.ts`, `notifications.controller.ts`,
`app/(dashboard)/notifications/page.tsx`, `components/shared/notifications-menu.tsx`

**Wired (5)** — `notifications.module.ts`, `wallet/wallet.module.ts`, `wallet/cashier.service.ts`,
`auth/auth.module.ts` + `auth.service.ts`, `auth/services/account-security.service.ts`,
`components/layout/site-header.tsx`, `lib/api-client.ts`

Plus test updates to `wallet/cashier.service.spec.ts`.
