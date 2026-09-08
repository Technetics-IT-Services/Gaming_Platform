# Phase 2D.3 — Security Tests

**56 live HTTP checks, 0 failed.** Every call went over the wire to the running backend, through the
real auth chain and the real controllers. Plus 47 DB-backed integration tests (24 KYC, 23 support).

---

## 1. Authorization matrix (verified live)

| Principal | KYC admin queue | Support admin queue | Support write |
|---|---|---|---|
| Unauthenticated | **401** | **401** | **401** |
| Player (`user`) | **403** | **403** | **403** |
| **Moderator** (holds `support:*`, not `users:verify`) | **403** | **200** | **200** |
| Admin / super-admin | **200** | **200** | **200** |

The moderator row is the useful one: it proves the two permission sets are genuinely independent —
a support agent can work tickets but **cannot** review identity documents.

## 2. IDOR — the mandatory matrix

| # | Attack | Expected | Observed |
|---|---|---|---|
| 14 | A reads A | 200 | **200** |
| 15 | A reads **B** | denied | **404** |
| 16 | A replies to **B** | denied | **404** |
| 17 | A closes **B** | denied | **404** |
| 18 | B reads B | 200 | **200** |
| 19 | B reads **A** | denied | **404** |
| 20 | B modifies **A** | denied | **404** |
| 21 | A's list contains B's tickets | never | **absent** |

Plus (integration): another player's ticket id produces the **same error object and message** as a
non-existent id, so the API cannot be used to discover whether someone else's ticket exists.

KYC has no per-application player route at all — `GET /kyc` is caller-scoped — and
`assertOwnedBy` throws `Forbidden` for a foreign application (integration-tested).

## 3. Mass assignment — the client cannot influence a decision

| Attempt | Result |
|---|---|
| `POST /kyc` with `status=APPROVED` | **400** |
| `POST /kyc` with `reviewedBy=<admin id>` | **400** |
| `POST /kyc` with `verification=true` | **400** |
| `POST /kyc` with `userId=<other player>` | **400** |
| **After all four attempts**, the attacker's own status | **still `NOT_STARTED`** |
| `POST /support/tickets` with `priority=URGENT` | **400** |
| `POST /support/tickets` with `status=RESOLVED` | **400** |
| `POST /support/tickets` with `userId=<other player>` | **400** |

The global pipe runs `whitelist + forbidNonWhitelisted`, and neither DTO declares any of those
fields, so they are rejected before the handler runs.

## 4. Input validation

| Attempt | Result |
|---|---|
| MIME `application/x-msdownload` | **400** |
| Declared size ~100 MB | **400** |
| File name `../../etc/passwd` | **400** |
| Empty document array | **400** |
| Duplicate document type in one submission | **400** |
| Second submission while `PENDING` | **400** |
| Rejection with no reason | **400** |
| Reviewing an already-decided application | **400** |

## 5. Concurrency

Two reviewers deciding the same application simultaneously: **exactly one succeeds**, the other gets
a 400 telling it to reload. Implemented with a conditional `updateMany` whose WHERE still requires an
open status — no silent overwrite of the first decision.

## 6. Leakage

Scanned every KYC and support response for `password`, `refreshToken`, `accessToken`, `totp`,
`serverSeed`, `postgresql://`, `redis://`, `storageKey`, `fileUrl` → **none present**.

- KYC responses never expose `fileUrl` or `storageKey` (internal references).
- The audit trail records document **types**, never contents (`base64`, `data:image` absent).
- Support notifications carry a pointer, not the reply body.
- Internal agent notes are excluded from the player view (verified live).

## 7. A real finding from live testing

The first live run showed six failures where the **moderator** was refused the support queue despite
holding `support:read`. Investigation showed the role and grants were correct in the database.

**Cause: the test harness, not the product.** `RbacService` caches a user's effective authorization
in Redis for 300 s and invalidates it when roles change *through the service*. The harness assigned
the role with raw SQL, bypassing that invalidation, so it read a stale pre-assignment cache. The
harness now performs the same invalidation the product does, and all six pass.

Recorded because a "403" that turns out to be a caching artefact is exactly the kind of result that
gets mis-reported as either a false vulnerability or a false pass.

## 8. Limitations

- **SA-L1** — Testing was over **HTTP**; HTTPS/TLS remains unexercised (environment, unchanged).
- **SA-L2** — No load or DoS testing of the new endpoints.
- **SA-L3** — KYC **document file bytes** are not stored at all, so there is no file-serving surface
  to attack — and equally, no file-based verification is possible. Declared BLOCKED, not faked.
- **SA-L4** — No rate limit specific to ticket creation; the global throttler applies. A dedicated
  anti-spam limit on ticket creation is **not implemented** and would be worth adding.
