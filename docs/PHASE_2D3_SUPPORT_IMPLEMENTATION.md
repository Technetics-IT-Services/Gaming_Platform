# Phase 2D.3 — Support Ticketing Implementation

## 1. What existed

**Nothing.** No `Ticket` model anywhere in the 18 schema files, no support module, and `/support`
was a static FAQ page that honestly said it could not file tickets.

## 2. What changed

### Database (new file `support.prisma`, additive)

| Model | Purpose |
|---|---|
| `SupportTicket` | `reference` (TKT-XXXXXXXX), `userId` owner, subject, category, priority, status, `assignedToUserId`, `lastMessageAt`, `closedAt` |
| `SupportTicketMessage` | `ticketId`, `authorUserId`, `isFromAgent`, `isInternal`, `body` |

Enums: `SupportTicketStatus` (OPEN / IN_PROGRESS / WAITING_ON_PLAYER / RESOLVED / CLOSED),
`SupportTicketPriority`, `SupportTicketCategory`. No existing table was modified.

### RBAC — a new narrow pair

`support:read` and `support:write` were added and granted to **MODERATOR** (so `admin` and
`super_admin` inherit). A support agent needs neither `users:write` (over-grants user management)
nor any wallet permission, so neither was reused. `RbacBootstrapService` upserts permissions and
back-fills grants for existing roles at boot, so no manual migration is required.

### API

| Route | Who |
|---|---|
| `GET/POST /support/tickets`, `GET/POST /support/tickets/:id{,/reply,/close,/reopen}` | player, scoped to `@CurrentUser('id')` |
| `GET /admin/support/tickets{,/:id}` | `support:read` |
| `POST /admin/support/tickets/:id/{reply,assign,status,priority}` | `support:write` |

### Frontend

`app/(dashboard)/support/tickets/page.tsx` (player), `app/admin/support/page.tsx` (agent queue),
`lib/support-api.ts`. The old `/support` page now links to real tickets and no longer claims there
is no backend.

## 3. How IDOR is closed — by construction, not by a check

Every player-facing query filters on `userId` **inside the WHERE clause**:

```ts
const t = await this.prisma.supportTicket.findFirst({
  where: { id: ticketId, userId, deletedAt: null },  // ownership is part of the query
  ...
});
if (!t) throw new NotFoundException('Ticket not found.');
```

There is **no code path that loads a ticket and then checks ownership** — a check that could be
forgotten on a new route. Another player's id yields `NotFoundException`, the **same** error as a
genuinely missing ticket, so the API is not an existence oracle for other people's ticket ids
(asserted by a test comparing both error objects).

**Proven live, both directions:** A reads A (200) · A reads B (404) · A replies to B (404) ·
A closes B (404) · B reads B (200) · B reads A (404) · B modifies A (404) · A's list contains none
of B's tickets.

## 4. Privilege boundaries

| Property | Enforcement |
|---|---|
| A player cannot post as an agent | `isFromAgent` is set **server-side** from the authenticated author, never accepted from the body |
| A player cannot self-escalate | `CreateTicketDto` has no `priority`/`status`/`userId`; `forbidNonWhitelisted` rejects them with 400 (verified live) |
| Internal notes never leak | `getMine` filters `isInternal: false`; verified live that an "INTERNAL:" note is absent from the player view while the agent sees it |
| An internal note does not notify the player | verified — notification count unchanged |

## 5. Notifications — reusing the existing system

Two events were added to the **existing** `NotificationEventsService`, using its `safeEmit` and its
deterministic-id deduplication. No second notification system was created.

- `supportAgentReplied` — keyed by ticket + timestamp, so distinct replies notify while a retry of
  the same reply deduplicates.
- `supportTicketStatusChanged` — keyed by (ticket, status), so the same transition never duplicates
  (verified: re-issuing `RESOLVED` adds no second notification).

A notification is a **pointer, not a copy**: the reply body is deliberately excluded, since support
text can contain account detail.

## 6. Audit — one store, reused

Every sensitive action goes through the **existing** `AuditService`: created, agent_reply,
agent_internal_note, assigned, status_changed, priority_changed, player_reply, close, reopen.
Verified live that `admin_audit_logs` remains at **0 rows** — no second audit system was created.

## 7. Evidence

| Check | Result |
|---|---|
| Integration vs real Postgres + Redis | **23 passed** (7 of them IDOR) |
| Live HTTP verification | included in the **56/56** 2D.3 live run |
| Frontend unit | included in the **25** KYC+support tests |
| Mobile certification | 375/390/412 — included in **21/21**, incl. a 600-character unbroken message body that must wrap rather than widen the page |
| Restart persistence | verified |
| Financial safety | ledger byte-identical before/after create + reply + status + close |
