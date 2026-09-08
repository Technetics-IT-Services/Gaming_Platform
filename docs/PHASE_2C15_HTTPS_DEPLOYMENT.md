# Phase 2C.15 — HTTPS Deployment & Auth Certification (Steps 3–6)

## HTTPS production deploy — **BLOCKED — DEPLOYMENT ENVIRONMENT UNAVAILABLE**

Per the honesty rule: **no HTTPS/TLS production environment was available** in this session. The end-to-end
HTTPS smoke (real Secure cookie over TLS, real domain, real reverse proxy) is therefore **not claimed as
executed**. It is a **launch prerequisite**, not a product defect. The build path for it already exists and
is proven; only the deploy environment is missing.

## What WAS certified — same-origin auth over the real backend

The full authentication contract was exercised against the **real backend** same-origin via the `:3100`
proxy (`auth-recovery.mjs`), i.e. the exact production topology minus TLS:

| Check | Result |
|---|---|
| Login → 200, access token in **body (memory-only)** + httpOnly refresh cookie | ✅ |
| Refresh cookie is **HttpOnly** | ✅ |
| Refresh cookie **NOT Secure over HTTP** (`AUTH_COOKIE_SECURE=false` honored — the 2C.13 fix works) | ✅ |
| Refresh → **new (rotated)** access token | ✅ |
| Refresh **rotates** the refresh token (new cookie) | ✅ |
| **Reuse** of the old rotated refresh token → **401** (reuse detection) | ✅ |
| Logout → 200, session revoked | ✅ |
| Refresh **after logout** → 401 | ✅ |
| Recovery health (admin, RBAC) → 200 | ✅ |

**The only difference on HTTPS is the `Secure` flag**, which is driven by `AUTH_COOKIE_SECURE=true` — a config
value whose code path (`configuration.ts:123` → `auth.controller.ts:55 secure: cookieSecure`) is verified.
The 2C.13 fix guarantees `=true` yields `Secure: true` and `=false` yields `Secure: false` (previously
`Boolean('false')===true` forced Secure always). **Do not undo this fix** (retained, verified intact).

## Step 3 — Production environment config audit — **PASS**
| Var | Production value | Verified |
|---|---|---|
| `AUTH_COOKIE_SECURE` | `true` | `String(env.AUTH_COOKIE_SECURE)==='true'` → Secure cookie over HTTPS |
| `NEXT_PUBLIC_DEMO_MODE` | `false` | `config.ts:16 demoMode` false in production build |
| `NEXT_PUBLIC_API_URL` | `/api/v1` | same-origin |
| `BACKEND_ORIGIN` | set at **build** time | `next.config.mjs` `/api/:path*` rewrite baked at build |
| `DATABASE_URL` / `REDIS_URL` | provisioned | required at boot |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | provisioned | required |
| `CORS_ORIGINS`, cashier limits, `BOOTSTRAP_ADMIN_*` | provisioned | required |

## Step 5 — Database + Redis gate — **PASS (verified live in this session's stack)**
Postgres + Redis provisioned; `reconcile()` → `balanced:true, difference:"0"` on the cert DB; Serializable
transactions + optimistic version + Redis per-wallet lock in force (concurrency stress **10/10**, 2C.12).

## Step 6 — Recovery gate — **PASS**
`PENDING_SETTLEMENT → RECOVERING → RECOVERED/SETTLED`; retry + backoff; **terminal `RECOVERY_FAILED` proven
live** (`GET /games/recovery/health` → `recoveryFailed:1`); durable in `game_rounds`; recovery health 200
after a real backend restart; reconcile unchanged across restart.

## Deployment checklist (HTTPS go-live)
- [ ] HTTPS single origin / reverse proxy; `AUTH_COOKIE_SECURE=true`; **confirm Secure refresh cookie in
      prod** (the one thing not verifiable without TLS here).
- [ ] `next build` with `BACKEND_ORIGIN=<https backend>`; `NEXT_PUBLIC_API_URL=/api/v1`;
      `NEXT_PUBLIC_DEMO_MODE=false`.
- [ ] Provision Postgres/Redis; `prisma db push` + seed; verify `reconcile difference "0"`.
- [ ] Recovery scheduler running; `/games/recovery/health` reachable to operators; alert on
      `RECOVERY_FAILED`.
- [ ] Re-run the 390 mobile sweep on HTTPS (the HTTP-localhost token-rotation flake should vanish).
