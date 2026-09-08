# Final Production Readiness

**2026-09-08.** Each item is classified so nothing ambiguous is presented as done.

Categories: **PASS** · **CONFIGURATION REQUIRED** · **CLIENT ACTION** · **ENGINEERING** ·
**ENVIRONMENT-DEPENDENT**

## Security and authentication

| Item | Status |
|---|---|
| RBAC — 214 permission/role-guarded routes, 0 unguarded admin routes | **PASS** |
| Admin 2FA enforced at the admin API boundary | **PASS** |
| Refresh rotation + reuse detection + logout revocation | **PASS** |
| Idle session enforcement (`SESSION_IDLE_TIMEOUT_MINUTES`) | **PASS** |
| Rate limiting / throttling | **PASS** — observed enforcing repeatedly, never weakened |
| Audit logging — 17 entity types + blanket admin-action interceptor | **PASS** |
| Input validation, mass-assignment protection (`forbidNonWhitelisted`) | **PASS** |
| grant-bonus vulnerability | **PASS — CLOSED**, re-probed 404 |
| `AUTH_COOKIE_SECURE=true` over HTTPS | **ENVIRONMENT-DEPENDENT** — no HTTPS here; staging procedure in the release checklist |
| CORS restricted to the real domain | **CONFIGURATION REQUIRED** |
| Production JWT secrets | **CONFIGURATION REQUIRED** |
| CSRF posture | **PASS** — bearer auth + `SameSite` refresh cookie; no cookie-authenticated state-changing route |

## Data tier

| Item | Status |
|---|---|
| PostgreSQL reachable, health-checked | **PASS** |
| Redis reachable, health-checked | **PASS** |
| Schema application | **CONFIGURATION REQUIRED** — `prisma db push`; **no migration files exist** |
| Rollback | **CONFIGURATION REQUIRED** — needs a database restore, not just a code rollback |
| Automated backups | **ENGINEERING/OPS** — documented, not automated in-repo |
| Connection limits under load | **PASS** for the tested profile; size the pool for production traffic |

## Runtime and reliability

| Item | Status |
|---|---|
| Health endpoint (`/api/v1/health`: database, redis, heap) | **PASS** |
| Settlement-recovery sweeper, restart-safe | **PASS** |
| `RECOVERY_FAILED` alerting | **CONFIGURATION REQUIRED** — the service logs `ALERT: ... MANUAL settlement recovery required`; route it to a pager |
| Monitoring cannot crash the process | **PASS** — unhandled rejection fixed in 2D.11 |
| Recurring async operations handle rejection | **PASS** — swept for `setInterval(() => void ...)` and fire-and-forget patterns |
| Structured logging | **PASS** |
| Error handling / normalised responses | **PASS** — global exception filter |
| Graceful shutdown | **PASS** — `onModuleDestroy` clears timers |

## Performance

| Item | Status |
|---|---|
| Analytics aggregates without caching | **PASS** — benchmarked in 2D.7; p95 22.9 ms after the `count(DISTINCT)` fix. Caching deliberately **not** added: the evidence did not justify it |
| Maximum analytics date range enforced | **PASS** — `ANALYTICS_MAX_RANGE_DAYS`, rejected not truncated |
| Unbounded queries | **PASS** — every list endpoint is paginated or capped, and the cap is reported |
| Cashier queue pagination | **PASS** — fixed in 2D.12 after a silent-truncation defect was found |
| Report row cap | **PASS** — 50,000, stated in the response |

## Application configuration

| Variable | Status |
|---|---|
| `NEXT_PUBLIC_DEMO_MODE=false` | **PASS** — set and built with |
| `BACKEND_ORIGIN` | **PASS** in certified builds |
| `DATABASE_URL`, `REDIS_URL` | **CONFIGURATION REQUIRED** |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | **CONFIGURATION REQUIRED** |
| `CORS_ORIGINS` | **CONFIGURATION REQUIRED** |
| `CASHIER_LARGE_WITHDRAWAL_THRESHOLD` | **CLIENT ACTION** (D-02) — escalation off while unset |
| `MAIL_*` | **CLIENT ACTION** — no email leaves the platform until supplied |

## Demo / fake surfaces

| Item | Status |
|---|---|
| Demo destinations in production navigation | **PASS** — 0, filtered and test-enforced |
| Real-money pages touching the demo wallet | **PASS** — 0, test-enforced |
| Quarantined simulation (~23k LOC) | **PASS** — 0 importers, test-enforced |
| Fake providers anywhere | **PASS** — none exist |

## Operational prerequisites

- Every admin account enrolled in two-factor authentication (**OPERATIONAL**)
- `RECOVERY_FAILED` alert routed to a human (**CONFIGURATION REQUIRED**)
- Backup taken and a restore rehearsed (**REQUIRED**)
- Reconciliation (`GET /admin/wallet/reconcile`) scheduled and monitored (**RECOMMENDED**)
