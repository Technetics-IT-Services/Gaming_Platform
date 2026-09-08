# Phase 2D.13 — Implementation Record

Four operator consoles built, closing the last 7 surfaces / 22 guarded routes that had no frontend.

**No database schema change. No frozen surface touched. No backend business logic added** — every
endpoint already existed, guarded and audited; what was missing was the interface.

---

## 1. AD-03 — Game catalogue console

`app/admin/catalog/page.tsx` · `lib/game-catalog-api.ts`

Four guarded surfaces behind one tabbed console:

| Tab | Routes | Operations |
|---|---|---|
| Categories | 5 | list, create, update, reorder, delete |
| Providers | 4 | list, create, update, delete |
| Collections | 5 | list, create, update, set games, delete |
| Launchers | 4 | **list only** |

**Launchers are read-only on purpose.** They are registered by the platform when a game runtime is
installed; offering a "create launcher" form would invite an operator to invent a runtime binding
that does not exist. The page says so instead.

**The console cannot reach money-affecting configuration.** A category, provider or collection is
presentation and routing metadata — it sets no odds, RTP, stake limit or payout. A test asserts the
client contains none of `rtp`, `odds`, `payout`, `stake`, `minBet`, `maxBet`, `houseEdge` or
`variant`, so organising a shelf can never become a way to change what a game pays.

The client tolerates **either** a bare array or a paginated envelope from these four endpoints,
because they do not share one response shape — verified by test rather than assumed.

## 2. AD-12 — Audit trail viewer

`app/admin/audit/page.tsx`

`GET /admin/audit` had been writing since 2D.2 (17 entity types plus the blanket admin-action
interceptor) and nothing rendered it.

- **Read-only by construction.** No mutation call on the page; no edit or delete route exists.
  Live probe: `DELETE /admin/audit/:id` → **404**. An audit trail an operator can alter is not one.
- **The change set renders as text, never markup.** Audit records carry operator-supplied reasons;
  injecting those into the DOM would turn the log into an attack surface. A `summarise()` helper
  flattens the payload to a short string, and a test asserts no `dangerouslySetInnerHTML`.
- **Paged, with the true total** — filtering by entity type genuinely filters, verified live.

## 3. P-10 — Responsible-gaming operator view

Panel on `app/admin/users/page.tsx` · `lib/admin-oversight-api.ts`

Shows one player's self-imposed limits and active restrictions.

**The client exposes exactly two operations — `forUser` and `liftRestriction` — and a test pins that
list.** There is no route to create a limit, raise a limit or add a restriction, because limits
belong to the player; relaxing protection is the only direction that needs an operator at all. Live
probe: `POST /admin/responsible-gaming/users/:id/limits` → **404**. The mobile test asserts the panel
contains zero amount inputs.

## 4. P-17 — Referral oversight

`app/admin/referrals/page.tsx`

Read-only list of who introduced whom, paged and filterable by status.

**No award, adjust or reverse route** — the client exports only `list`, and a live probe confirms
`POST /admin/referrals/award` → **404**. Where a reward column would sit, the server's blocked reason
is printed. A zero would imply a reward had been calculated and found to be nothing.

---

## 5. Files changed

```
apps/frontend/src/lib/game-catalog-api.ts                          new
apps/frontend/src/lib/admin-oversight-api.ts                       new
apps/frontend/src/app/admin/catalog/page.tsx                       new
apps/frontend/src/app/admin/audit/page.tsx                         new
apps/frontend/src/app/admin/referrals/page.tsx                     new
apps/frontend/src/app/admin/users/page.tsx                         + responsible-gaming panel
apps/frontend/src/components/shared/navigation.ts                  + 3 admin entries
apps/frontend/src/lib/admin-oversight.test.ts                      new, 23 tests
apps/frontend/tests/mobile-cert/p2d13-oversight-consoles.spec.ts   new, 6 × 3 viewports
docs/PHASE_2D13_*.md, docs/FINAL_*.md                              audit + matrix updates
```

**Backend: unchanged.** Not one line — every route already existed.

## 6. Test count movement

| Suite | Before | After | Added |
|---|---|---|---|
| Backend | 801 | **801** | — (no backend change) |
| Frontend | 1074 | **1097** | 23 oversight-console tests |
| Live HTTP | — | **38** | this phase's harness |
| Mobile | — | **18** | 6 tests × 3 viewports |

All remain **0 failed, 0 skipped**.

## 7. Two test-side errors I made and fixed

Both were in my own new tests, and both were fixed by making the assertion *more* precise rather
than looser:

1. **Query-parameter order.** I asserted an exact query string; the builder emits keys in object
   order. Rewritten to assert the route plus the presence of every filter — order-independent and
   closer to what actually matters.
2. **A bad slice boundary.** The "audit client is read-only" test sliced the source between
   `adminAuditApi` and the string `P-10` — but the file's header comment also mentions P-10, so the
   slice cut in the wrong place and swept in the responsible-gaming `post`. Re-anchored on a
   declaration that appears exactly once, and strengthened to also assert the block *does* contain a
   `get`.
