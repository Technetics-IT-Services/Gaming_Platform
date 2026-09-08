# Final Release Gate

**Evaluated 2026-09-08, after Phase 2D.13.** Every mandatory gate must pass for the system to be
called PRODUCTION READY.

| # | Gate | Result | Evidence |
|---|---|---|---|
| 1 | Requirement matrix reconciled | **PASS** | 39+3+0+16 = 58, recounted from IDs |
| 2 | No P0 RED | **PASS** | RED = 0 |
| 3 | No known critical vulnerability | **PASS** | grant-bonus closed, re-probed 404, regression proven non-vacuous |
| 4 | Security suite | **PASS** | 256/256 live probes (83+38+51+46+38) |
| 5 | Financial reconciliation | **PASS** | difference `0.000000000000000000`, 90,510 entries |
| 6 | Backend tests | **PASS** | 801 passed / 0 failed / 0 skipped (63 suites) |
| 7 | Frontend tests | **PASS** | 1097 passed / 0 failed / 0 skipped (77 files) |
| 8 | Mobile tests | **PASS** | 18/18 this phase at 375/390/412; 24/24 in 2D.12 |
| 9 | Production build | **PASS** | 110 static pages |
| 10 | Typecheck | **PASS** | backend + frontend |
| 11 | Lint | **PASS** | 0 errors (4 pre-existing frontend warnings) |
| 12 | No production demo/fake surfaces | **PASS** | demo nav filtered + test-enforced; no fake providers exist |
| 13 | Production configuration verified | **INCOMPLETE** | Secrets, CORS, cookie flags must be set per deployment |
| 14 | Database migration state verified | **INCOMPLETE** | **Drift measured this phase:** 5 migrations exist and are applied (latest `20260820093517`), creating 128 tables; the live database has **136**. Eight tables exist with no migration — `partners`, `partner_users`, `expenses`, `expense_categories`, `support_tickets`, `support_ticket_messages`, `responsible_gaming_limits`, `account_restrictions` — added by `prisma db push` in later phases. Rollback therefore needs a restore, not a down-migration. |
| 15 | **HTTPS / cookie security verified in staging** | **ENVIRONMENT-DEPENDENT** | **No HTTPS available here. Not verified.** |
| 16 | Critical workflows live-tested | **PASS** | Deposit credited end-to-end; withdrawal held → rejected → refunded; ledger balanced throughout |
| 17 | Client decisions documented | **PASS** | 8 decisions, `CLIENT_DECISION_QUESTIONNAIRE.md` |
| 18 | External dependencies documented | **PASS** | 6 providers, `EXTERNAL_DEPENDENCY_MATRIX.md` |
| 19 | Known limitations documented | **PASS** | `FINAL_HANDOVER.md` §8 |
| 20 | Rollback / recovery plan documented | **PASS** | `FINAL_HANDOVER.md` §10 |
| 21 | **Every guarded operator route reachable from the UI** | **PASS** | Machine audit: *"Every admin surface has a frontend caller."* 11 surfaces / 48 routes closed across 2D.12 + 2D.13 |

Gate 21 was added in this phase. It exists because gates 1–20 were all passing while the deposit
approval rail — the way real money reaches a player — had no interface at all. A guarded route with
no operator UI is not a delivered feature; it is a curl command in a runbook.

## Verdict

# CONDITIONAL GO

**18 of 21 gates pass outright.** Three do not, and none is an engineering shortfall:

- **Gate 15 is ENVIRONMENT-DEPENDENT and mandatory.** The refresh-token cookie is `Secure`, so
  authentication behaves differently over HTTPS than over the plain HTTP available here. This must be
  verified on staging before go-live. **We will not claim it.**
- **Gates 13 and 14 are deployment configuration** — production secrets, CORS, cookie flags, and a
  backup taken before the schema is pushed.

### Staging verification procedure for gate 15

1. Deploy behind TLS with `AUTH_COOKIE_SECURE=true`, `BACKEND_ORIGIN` set to the same origin, and
   `CORS_ORIGINS` limited to the real domain.
2. Register a test player over HTTPS; confirm the refresh cookie is set with `Secure`, `HttpOnly`
   and `SameSite`.
3. Sign in, wait for the access token to expire, and confirm a silent refresh succeeds.
4. Sign out; confirm a subsequent refresh returns **401**.
5. Replay a rotated refresh token; confirm **401** and that the token family is burned.
6. Repeat 2–5 for an admin account including the two-factor challenge.
7. Confirm no mixed-content warnings and no cookie set without `Secure`.

Gate 15 passes only when all seven steps pass on staging.

## Not blocking, but the client should decide before launch

- **Large-withdrawal escalation is off** (D-02). Any admin can approve any amount today.
- **No outbound email** until SMTP is supplied — including password resets.
- **Deposits are manually confirmed** — correct and complete, but staff-intensive at volume.
- **Real-money payment integration is on hold** by instruction. Gateway, UPI, bank transfer, payout
  and external FX are intentionally not built.
