# Final Security Audit

Covers the security testing executed in this session: Phase 2D.7 (reports & CSV export) and the
responsible-gaming enforcement layer. Earlier phases' audits remain valid and are referenced, not
repeated.

---

## 1. Results summary

| Suite | Tests | Result |
|---|---|---|
| Analytics attack tests (2D.6, re-run) | 18 | **18 passed, 0 failed** |
| Report & export attack tests (2D.7) | 36 | **36 passed, 0 failed** |
| Responsible-gaming live HTTP verification | 24 | **24 passed, 0 failed** |
| CSV serialisation / injection unit tests | 38 | **38 passed** |
| Backend security-hardening integration (2D.2) | included in full run | **passed** |
| **Total executed this session** | **116** | **0 failed** |

---

## 2. Responsible gaming — authorization and IDOR

The whole IDOR surface of this module is closed **by construction**: no player route accepts a user
id. Identity always comes from `@CurrentUser('id')`.

| Attack | Expected | Observed |
|---|---|---|
| Unauthenticated → `GET /responsible-gaming` | 401 | **401** |
| Player → `GET /admin/responsible-gaming/users/:id` | 403 | **403** |
| Player lifting their OWN restriction (operator-only action) | 403 | **403** |
| Player A reading player B's limits | impossible | **A sees only WAGER (A's); B only DEPOSIT (B's)** |
| `?userId=<other>` smuggled onto a player route | not honoured | **ignored — the route has no such parameter** |
| Negative limit amount | 400 | **400** |
| Unknown limit type (`EVERYTHING`) | 400 | **400** |
| Cooling-off with no end date | 400 | **400** |

Lifting a restriction is guarded by the **existing** `users:lock` permission — the permission already
used for restricting/unrestricting an account. **No new permission was invented and no financial
permission is involved.**

### 2.1 Enforcement cannot be bypassed from the client

- Limits and restrictions are **server state**; the client only reads and writes them.
- The frontend holds **no** `localStorage`, `sessionStorage`, `setTimeout` or `setInterval` state
  that could imitate enforcement (asserted by test).
- Usage and remaining headroom are **computed server-side** from authoritative tables; the client
  does no arithmetic on them (asserted by test).
- A failed save tells the user the limit was **NOT** changed rather than showing optimistic success.

### 2.2 A real gap found and closed

The first live run exposed that **deposit limits were not enforced at all** (200 where 403 was
required) while gameplay blocking worked. Cause: `Reflect.metadata` does not place method metadata
where Nest's `Reflector` reads it, so the method-level marker on `POST /cashier/deposits` was
invisible to the guard. Fixed with `SetMetadata`; re-verified 403. **Only live HTTP testing could
have caught this** — the unit tests passed throughout.

---

## 3. Reports & CSV export (Phase 2D.7)

| Category | Result |
|---|---|
| Player → admin report / export | **403 / 403** |
| **Moderator** (real role, holds `audit:read` but not `analytics:read`) | **403 / 403** |
| Unauthenticated → report / export | **401 / 401** |
| `userId` / `role` / `permissions` / arbitrary params smuggled in | **400** (whitelist + `forbidNonWhitelisted`) |
| Unknown currency | **empty result, never platform-wide totals** |
| Unknown / traversal-shaped report type | **400** |
| Excessive range (11 years) | **400**, message states "NOT truncated" |
| Path traversal in filename | **400**; `Content-Disposition` contains no separator or `..` |
| **CSV formula injection from the database** | **neutralised** — and the test proves the payload actually reached the file, so it cannot pass vacuously |
| Legitimate negative money (`-1250.00`) in CSV | **not corrupted** |
| Secrets / user identifiers in any export | **none** |
| Database intact after injection attempts | **confirmed** |

### 3.1 CSV injection — the subtlety that matters

A cell beginning `=`, `+`, `-`, `@`, TAB or CR is prefixed with `'` **unless it parses as a plain
number**. Without that exception the defence would corrupt `-1250.00` and cause the very financial
misstatement it exists to prevent. The numeric pattern is strict, so `-1+1`, `-1e3-cmd` and `+1-2+3`
are still escaped.

---

## 4. Standing guarantees re-verified

| Guarantee | Status |
|---|---|
| Client-supplied `userId` / `role` / `permission` / `balance` / `payout` never trusted | **holds** |
| No password, JWT, refresh token, TOTP secret, backup code, server seed or payment credential is logged, stored in analytics, or exported | **holds** — asserted across all six report types and the analytics summary |
| Admin surfaces unreachable by mere authentication (2D.2 rule) | **holds** — moderator refused |
| Global guard chain (Throttler → JwtAuth → Roles → Permissions → AdminTwoFactor) | **unmodified** |
| Rate limiting | **not weakened.** The login throttle was waited out between test runs, never raised |

---

## 5. Limitations

- **SA-L1** — Testing was over **HTTP** against the local disposable stack. **HTTPS/TLS behaviour was
  not exercised** (environment limitation, unchanged since 2C.15).
- **SA-L2** — No load, soak or denial-of-service testing. Analytics still aggregate live with no
  caching (an evidence-based decision, see `PHASE_2D7_PERFORMANCE.md` §6); a privileged user
  repeatedly requesting maximal ranges could impose real load. **Known and untested.**
- **SA-L3** — No penetration test of the platform as a whole; these are targeted suites for the
  surfaces built in this session.
- **SA-L4** — RG has **no operator UI**; the admin API exists, is permission-guarded and audited, but
  was not exercised through a browser.
