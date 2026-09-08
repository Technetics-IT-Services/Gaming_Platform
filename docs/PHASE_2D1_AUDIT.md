# Phase 2D.1 — Notifications: Audit before code

**No code written at the time of this document.** Companions: `PHASE_2D1_IMPLEMENTATION.md`,
`PHASE_2D1_FINAL_REPORT.md`. Prior context: `PHASE_2C18_*`.

---

## 1. Existing notification schema — sufficient, NO MIGRATION REQUIRED

`packages/database/prisma/schema/notifications.prisma`:

```prisma
model Notification {
  id         String              @id @default(uuid(7)) @db.Uuid
  userId     String              @map("user_id") @db.Uuid
  templateId String?             @map("template_id") @db.Uuid
  type       NotificationType                     // SYSTEM TRANSACTION PROMOTION SECURITY GAME ACCOUNT KYC
  channel    NotificationChannel @default(IN_APP) // IN_APP EMAIL PUSH SMS
  status     NotificationStatus  @default(PENDING)// PENDING QUEUED SENT DELIVERED READ FAILED
  title      String
  body       String              @db.Text
  data       Json?               @db.JsonB
  sentAt     DateTime?
  readAt     DateTime?
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  deletedAt  DateTime?
  @@index([userId, status]) @@index([userId, createdAt]) @@index([type])
}
```

Requirement-by-requirement check (Phase B):

| Needed | Column | Verdict |
| --- | --- | --- |
| recipient user | `userId` (FK, cascade) | ✔ |
| notification type | `type` enum (7 values) | ✔ |
| title | `title` | ✔ |
| body/message | `body @db.Text` | ✔ |
| read/unread | `readAt` + `status` | ✔ |
| createdAt | `createdAt` (indexed with userId) | ✔ |
| metadata | `data Json? @db.JsonB` | ✔ |
| source/reference | inside `data` | ✔ |
| **deduplication / idempotency** | **no unique key exists** | **see §5** |

`NotificationPreference` also exists: `@@unique([userId, type, channel])`, `enabled Boolean @default(true)`.

**Conclusion: the existing schema is sufficient. No migration will be created, and no second
notification table will be introduced.**

## 2. Existing service — a stub that throws

`apps/backend/src/modules/notifications/notifications.service.ts`:

```ts
listForUser(...)  { throw new NotImplementedException('Notification storage is pending the platform data model'); }
markAsRead(...)   { throw new NotImplementedException('Notification storage is pending the platform data model'); }
pushRealtime(userId, payload) { this.gateway.notify(userId, payload); }   // ← real, unused
```

Live-confirmed: `GET /api/v1/notifications` → **501 Not Implemented**.

`notifications.controller.ts` already declares `@Get()` and `@Patch(':id/read')` with
`@CurrentUser('id')` — the route conventions are correct; only the service body is missing.

`notifications.gateway.ts` is **real**: `@WebSocketGateway({namespace:'/realtime'})`, verifies the
access token on handshake and places each socket in a `user:{id}` room. It is currently never called
by anything.

## 3. Event architecture — there is NO event bus

- `@nestjs/event-emitter` is **not a dependency**; `EventEmitterModule` / `@OnEvent` appear **nowhere**.
- There is no message queue consumer for domain events.

**Design consequence.** The brief says "use the existing event architecture" and "do not scatter
direct Prisma notification writes throughout controllers". Since no bus exists, the faithful reading is
a **single central orchestration service** injected into the services that already own each event —
not a new dependency, and not scattered writes. Adding an event-bus package would be new
infrastructure this phase does not need and would make delivery asynchronous and harder to test.

## 4. Event sources — traced from source → service → persistence

Only events that **actually exist and already run** are listed. Nothing here is inferred from a type.

| # | Event | Owning service (traced) | Frozen? | Wire it? |
| --- | --- | --- | --- | --- |
| 1 | Deposit requested | `CashierService.createDeposit` | no | **YES** |
| 2 | Deposit completed (money credited) | `CashierService.completeDeposit` | no | **YES** |
| 3 | Deposit rejected | `CashierService.rejectDeposit` | no | **YES** |
| 4 | Withdrawal requested (funds held) | `CashierService.createWithdrawal` | no | **YES** |
| 5 | Withdrawal approved | `CashierService.approveWithdrawal` | no | **YES** |
| 6 | Withdrawal completed | `CashierService.completeWithdrawal` | no | **YES** |
| 7 | Withdrawal rejected + refunded | `CashierService.rejectWithdrawal` | no | **YES** |
| 8 | Large-withdrawal escalation refused | `CashierService.approveWithdrawal` (2C.17) | no | **YES** |
| 9 | Password changed | `AuthService.changePassword` | no | **YES** |
| 10 | Account locked (failed attempts) | `AccountSecurityService.lock` | no | **YES** |
| 11 | Account unlocked | `AccountSecurityService.unlock` | no | **YES** |
| — | Game settlement | `GameMoneyBridgeService` | **FROZEN** | **NO — see §8** |
| — | Game recovery outcome | `GameMoneyRecoveryService` | **FROZEN (financial)** | **NO** |
| — | Bonus granted | `BonusWalletService.grant` | no | deferred (admin-only path, no player trigger yet) |
| — | 2FA enabled/disabled | no dedicated service method found | — | **NO — event does not exist** |
| — | Login success | `AuthService.login` | no | **NO — see §8** |
| — | Referral / promotion / partner / finance / support alerts | **no source exists** | — | **NO — would be fabrication** |

**11 real events will be wired.** Every one is on a non-frozen surface that already executes today.

## 5. Idempotency — solvable without a migration

The `Notification` table has **no unique constraint** other than its primary key. Options considered:

| Option | Verdict |
| --- | --- |
| Add a `dedupeKey` unique column | needs a **migration** — rejected, schema is otherwise sufficient |
| Partial unique index on `data->>'key'` | needs a **migration** — rejected |
| In-memory `Set` of seen keys | **rejected outright** — the brief forbids it, and it does not survive restart |
| **Deterministic primary key derived from the event** | **CHOSEN** |

`id` is `String @id @db.Uuid` and Prisma allows supplying it explicitly. A stable event key
(e.g. `withdrawal:approved:<withdrawalId>`) is hashed with SHA-256, truncated to 16 bytes, and stamped
with RFC-4122 version/variant bits to form a valid UUID. Inserting the same event twice therefore
violates the **primary key**, which:

- is enforced **by the database**, so it is concurrency-safe (one insert wins, the other gets `P2002`);
- is **durable across restarts**, because it is a table constraint, not process state;
- requires **no migration**.

`P2002` on create is caught and treated as "already notified" — not an error.

## 6. Delivery channels — audited (Phase K)

| Channel | Evidence | Classification |
| --- | --- | --- |
| **IN_APP** | `Notification` table + real `/realtime` gateway with per-user rooms | **PRODUCTION — implement now** |
| EMAIL | `MailService` is a real nodemailer abstraction, but `onModuleInit` logs *"Mailer running in log-only mode (no SMTP configured)"*; **no SMTP host/user/password in config or `.env`** | **NOT PRODUCTION DELIVERY — deferred** |
| SMS | no provider, no client, no credentials anywhere | **deferred** |
| PUSH | no FCM/APNs project, no device-token registry | **deferred** |

**Nothing will claim that an email, SMS or push was sent.** Only `channel: IN_APP` rows will be
created, and the documentation and UI will say so.

## 7. Preferences, authorization, mobile (Phases G, I, L)

- **Preferences:** `NotificationPreference` exists with a natural key and `enabled` defaulting to true.
  It will be **enforced server-side at creation time** (absent row = enabled). No new preference UI is
  built this phase — the client requirement does not call for one.
- **Authorization:** every operation derives the user from `@CurrentUser('id')`. The client will never
  supply `userId`. Ownership is enforced in the `where` clause of every query and mutation, so
  Player A cannot read or mutate Player B's rows. No admin notification surface is added — the client
  requirement does not ask for notification administration.
- **Mobile:** `/notifications` exists today as a **310-line page with a hardcoded `NOTIFICATIONS`
  array and `useState` read tracking that is lost on reload** — it must be replaced entirely. There is
  **no notification API client** in `src/lib`. The bottom navigation already has 5 items and is full,
  so the entry point will be a header bell + unread badge, **not** a sixth nav item.

## 8. Deliberate exclusions, with reasons

| Excluded | Reason |
| --- | --- |
| **Game settlement notifications** | `GameMoneyBridgeService` is **frozen** and there is **no non-frozen seam** between the controller and the bridge. Independently, a notification per round would be UX noise — a player who plays 100 rounds would get 100 notifications. This is both the safe call and the correct product call. A safe seam is proposed for a later phase in the final report. |
| **Login-success notifications** | Every login would notify, on every session — noise, not signal. Real platforms notify on *anomalous* login, which requires the risk signal that does not exist yet. `LoginHistory` already records logins and is surfaced in `/settings/security`. |
| **2FA enable/disable** | No dedicated service method exists to hook; wiring it would mean inventing the event. |
| **Referral / promotion / partner / finance / support alerts** | **No source events exist.** Creating them would be fabrication. |
| **Email / SMS / push** | No credentials (§6). |
| **A second navigation system** | Explicitly forbidden; the bell goes in the existing shell. |

## 9. Risk assessment before coding

| Risk | Mitigation |
| --- | --- |
| A notification failure breaks a financial transaction | All notify calls are placed **after** the money movement commits and are wrapped so a failure can never propagate; proven by test. |
| Duplicate notifications on retry/restart | Database-enforced deterministic primary key (§5). |
| Frozen-surface modification | Only `CashierService`, `AuthService`, `AccountSecurityService`, the notifications module and the frontend are touched. |
| Pagination drift between pages | Order by `createdAt DESC, id DESC` — `id` is a UUIDv7, monotonic by creation, giving a stable tie-breaker. |
| XSS via notification content | Content is **server-generated**; React escapes by default and no `dangerouslySetInnerHTML` will be used. |
| Secret leakage into `data` | `data` carries only references and non-sensitive financial metadata; asserted by test. |

**No blocker found. The existing schema safely supports the required behaviour. Proceeding to
implementation with no migration.**
