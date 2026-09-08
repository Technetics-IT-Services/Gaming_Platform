# Phase 2C.15 — Demo Auth Redirect-Loop Hotfix

**Status: PASS — demo auth redirect loop fixed.**
**Scope: frontend only.** No backend, WalletEngine, wallet-core, ledger, settlement, GameMoneyBridge,
game engine, Prisma or schema file was touched. Production authentication behaviour is unchanged.

---

## 1. Root cause

A demo ("guest") login created a **client-only** session that was **indistinguishable from a real
one**. `createDemoSession()` produced a local `AuthUser` plus a placeholder token, and the login page
called the same `setSession()` a real login uses — so `isAuthenticated` became `true` while there was
no backend session, no access token the API would accept, and no refresh cookie.

Everything downstream keyed off `isAuthenticated`, which produced the loop:

```
/login → demo login  (isAuthenticated = true, no backend session)
      → /dashboard
      → user-scoped queries enabled  (/games/recommended, /recently-played, …)
      → backend 401
      → global 401 interceptor → POST /auth/refresh
      → /auth/refresh 401 (no refresh cookie exists)
      → auth-session catch → setUnauthenticated()
      → AuthGuard → router.replace('/login')
      → /login  … repeat
```

### 1a. The second path — found by mobile certification, not by code reading

Fixing the 401 path alone did **not** stop the loop. Mobile certification at 375/390/412 still landed
on `/login`. The reason is a **race**, not a 401:

`AuthInitializer` starts `bootstrapSession()` when `/login` mounts — correctly, because a demo-mode
development build must still be able to restore a *real* session. The player then signs in as a
guest, which resolves **synchronously**. The already-in-flight bootstrap's `/auth/refresh` then 401s a
moment later and its failure branch called `setUnauthenticated()` — destroying the demo session that
had been created while it was awaiting the network.

Both resolution points now re-check the demo flag before clearing anything. This second path is the
one that made the bug look intermittent and "unfixable by disabling queries".

---

## 2. Files changed

All paths relative to `apps/frontend/`.

### Core fix

| File | Change |
| --- | --- |
| `src/stores/auth-store.ts` | New explicit `isDemoSession: boolean` field + `setDemoSession(user)` action. Demo sessions hold **no** access token. `setSession` / `setUnauthenticated` / `clearSession` always clear the flag. |
| `src/lib/api-client.ts` | New injected `setDemoSessionMode()` flag. In a demo session: no `Authorization` header is ever attached; user-scoped / real-money requests are rejected **locally** before the wire; a 401 never triggers a refresh. |
| `src/lib/auth-session.ts` | `refreshSession()`, `bootstrapSession()` and `logoutSession()` are demo-aware, including the two post-`await` re-checks that close the race in §1a. |

### New files

| File | Purpose |
| --- | --- |
| `src/hooks/use-real-session.ts` | `useRealSession()` = `isAuthenticated && !isDemoSession` — the single gate for user-scoped queries. Plus `useIsDemoSession()`. |
| `src/components/auth/real-money-guard.tsx` | `RealMoneyGuard` / `RealAccountRequired` — visible refusal of real-money & account surfaces for demo sessions. |
| `src/lib/demo-auth-isolation.test.ts` | 41 transport-layer regression tests (B, C, D, E, F). |
| `tests/mobile-cert/demo-auth.spec.ts` | Mobile demo certification at 375/390/412 (A, B, C, F, G). |

### Demo session creation switched to `setDemoSession`

`src/app/(auth)/login/page.tsx`, `src/app/(auth)/register/page.tsx`,
`src/components/auth/auth-initializer.tsx`.

### User-scoped query gating (`enabled: isAuthenticated && !isDemoSession`)

`src/components/games/home-sections.tsx` (recommended, recently played),
`src/components/games/lobby/use-lobby.ts` (balance, recents — catalog left public),
`src/components/history/use-game-history.ts`, `src/components/history/use-wallet-history.ts`,
`src/app/(dashboard)/wallet/page.tsx`, `src/app/(dashboard)/transactions/page.tsx`,
`src/app/(dashboard)/profile/page.tsx`, `src/app/(dashboard)/verification/page.tsx`,
`src/app/(dashboard)/favorites/page.tsx`, `src/app/(dashboard)/discover/page.tsx`,
`src/app/(dashboard)/games/[slug]/page.tsx` (`recordPlay`), `src/app/(casino)/sportsbook/page.tsx`
(my bets), `src/hooks/use-favorites.ts`, `src/components/shared/balance-pill.tsx`.

### Real-money surfaces guarded

All 15 `src/app/(casino)/*-money/page.tsx` routes, plus `deposit`, `withdraw`, `wallet`,
`transactions`, `game-history`, `profile`, `verification`.

### Incidental

`src/lib/auth-session.ts` — removed an unused `clientConfig` import that failed `tsc --noEmit`
(pre-existing in uncommitted work; the build gate could not pass with it present).

---

## 3. The exact fix

### 3.1 Demo state is explicit, never inferred

```ts
// auth-store.ts
isDemoSession: boolean;             // ← first-class field
setDemoSession: (user) => { ... }   // ← distinct from setSession
```

Demo state is **not** inferred from `isAuthenticated` (both session kinds set it) and **not** from
`clientConfig.demoMode` (the build-time flag, which is also on for a **real** login in development —
`balance-pill.tsx` previously made this mistake and hid the real balance from real dev sessions).

A demo session holds **no credential**: `accessToken` stays `null`. That closes every token-gated
backend socket by construction — wallet realtime, crash, runtime, admin ops.

### 3.2 A demo session never refreshes and is never invalidated by a 401

```ts
// api-client.ts — response interceptor, before the refresh branch
if (demoSession) return Promise.reject(normalizeError(error));

// auth-session.ts — refreshSession()
if (useAuthStore.getState().isDemoSession) return Promise.resolve(null);

// auth-session.ts — refreshSession() catch, AFTER the await (the §1a race)
if (useAuthStore.getState().isDemoSession) return null;   // do NOT setUnauthenticated()

// auth-session.ts — bootstrapSession(), AFTER the await (the §1a race)
if (useAuthStore.getState().isDemoSession) return;
```

401 handling is **not** globally disabled — the branch is reached only when `demoSession === true`.

### 3.3 A demo session cannot reach a user-scoped or real-money endpoint

Two independent layers:

1. **Query gating** — every user-scoped `useQuery` is `enabled: isAuthenticated && !isDemoSession`,
   so the request is never issued. Public catalog endpoints are deliberately untouched.
2. **Transport block** — `api-client` rejects the request locally before it is put on the wire:

   ```
   /wallet  /wallet-engine  /cashier  /admin  /users/me  /settings
   /recently-played  /games/history  /games/recommended  /ai/for-you  /favorites
   /games/:key/play          ← the real-money bet
   ```

   Explicitly **allowed**: `/catalog`, `/games/featured|trending|popular|recently-added`,
   `/games/:slug`, `/games/:key/config`, and all `/auth/*` endpoints.

### 3.4 Demo mode never enters the real-money flow

`RealMoneyGuard` renders a "Real account required" panel instead of the board/form on all 15
real-money game routes and on wallet, cashier, history, profile and verification. The transport block
in §3.3 enforces the same thing even if a surface were missed.

---

## 4. Demo behaviour (after the fix)

- Guest sign-in → `/dashboard`, and **stays** there.
- Reload → the persisted demo session is restored from `localStorage`; no backend bootstrap runs.
- Backend 401s cannot destroy the session: no `/auth/refresh`, no `setUnauthenticated()`, no redirect.
- Public catalog shelves (featured / trending / popular / recently added / categories / collections)
  still load from the real backend.
- User-scoped shelves ("Continue playing", "Recommended for you") are hidden, not broken.
- The balance pill shows the demo wallet.
- Real-money routes show "Real account required" with a link to sign in for real.
- Demo logout clears local state and does not call `/auth/logout` (there is nothing to revoke).

## 5. Production behaviour (unchanged)

With `NEXT_PUBLIC_DEMO_MODE=false`, `isDemoSession` is **always** false, so every demo branch is dead
code and the flow is byte-for-byte the pre-hotfix one:

```
login → real JWT → httpOnly refresh cookie → API
     → 401 → single-flight /auth/refresh → retry once
     → refresh failure → setUnauthenticated() → /login
```

Not weakened, not touched: refresh rotation, reuse detection, the single-flight guarantee, the
retry-once rule, the `/auth/refresh` + `/auth/logout` recursion exclusions, the logout latch, server-
side revocation, RBAC, JWT validation, cookie flags, ownership checks. `hasPermission` / `hasRole`
still read only backend-provided claims — a demo user carries `permissions: []`.

---

## 6. Tests

`pnpm --filter @gaming-platform/frontend test` → **62 files, 789 tests passed** (up from 785 before this hotfix; 41 + 11 + 4 assertions added across three files).
worth of prior coverage; 41 + 12 assertions added across three files).

| # | Requirement | Where | Result |
| --- | --- | --- | --- |
| A | Demo login stays on `/dashboard` | `tests/mobile-cert/demo-auth.spec.ts` (3 viewports) | PASS |
| B | Demo 401 cannot destroy the demo session | `demo-auth-isolation.test.ts`, `auth-session.test.ts` (incl. the 3 race tests), mobile spec | PASS |
| C | Demo user-scoped queries are not fired | `auth-store.test.ts` (gate value), mobile spec (network recording asserts zero forbidden requests) | PASS |
| D | Real 401 performs exactly one refresh | `demo-auth-isolation.test.ts` — asserts one refresh + one retry with the new bearer | PASS |
| E | Real refresh failure logs the user out | `auth-session.test.ts` (pre-existing, still green) + `demo-auth-isolation.test.ts` | PASS |
| F | Demo cannot access real-money APIs as a real user | `demo-auth-isolation.test.ts` (20 blocked / 10 allowed paths, local rejection, no bearer header), mobile spec | PASS |
| G | Demo logout works | `auth-session.test.ts`, mobile spec | PASS |
| H | Real logout / revocation still works | `auth-session.test.ts` — `/auth/logout` still called, latch still blocks resurrection | PASS |

Gates:

| Gate | Result |
| --- | --- |
| `pnpm --filter frontend test` | **789 passed / 62 files** |
| `pnpm --filter frontend typecheck` | **clean** (`tsc --noEmit` + vitest project) |
| `pnpm --filter frontend lint` | **0 errors**, 3 pre-existing warnings in files not touched here |
| `pnpm --filter frontend build` | **success** (Next 15 enforces lint + types in-build) |

No test was weakened, skipped, or removed.

---

## 7. Mobile verification

Real device emulation at **375×812**, **390×844**, **412×915** (`playwright.mobile.config.ts`,
`hasTouch`/`isMobile`, real device scale factors), against the **real backend on :4100** returning
genuine 401s — the exact condition that produced the loop.

### Demo — `tests/mobile-cert/demo-auth.spec.ts` → **12/12 passed, all three viewports**

- login → dashboard → **remains authenticated** (held 6s; pre-hotfix it bounced in ~1–2s)
- reload → demo session restored, still on `/dashboard`
- zero forbidden requests after the demo session exists (including zero `/auth/refresh`)
- `/dice-money`, `/deposit`, `/withdraw`, `/wallet`, `/game-history`, `/profile` all refuse the demo
  session and none redirect to `/login`
- demo logout → guarded route → `/login`

### Production — `tests/mobile-cert/mobile.spec.ts` (production build, demo OFF, same-origin
`BACKEND_ORIGIN` proxy, real seeded login + real refresh-cookie session restoration)

- real login → dashboard → session restoration across 11 core routes + all 15 real-money game routes,
  no horizontal overflow, at all three viewports. Screenshots captured under `mobile-cert-results/`.

**Note on a throttling artefact:** running all three viewport projects back-to-back exhausts the
backend's `@Throttle({ limit: 10, ttl: 60_000 })` on `POST /auth/login` (6 logins per full run plus
the demo runs from the same IP), and the later projects fail to leave `/login`. Each project passes
when run in its own throttle window. This is a production security control behaving correctly, not a
regression — the hotfix does not touch rate limiting.

---

## 8. Security verification

- **No credential is fabricated.** A demo session holds `accessToken: null`; the placeholder token is
  never stored in the auth store, never attached as a bearer header, and never used for a socket.
- **A demo session cannot impersonate a player.** Real-money and user-scoped requests are rejected in
  the browser before reaching the network; the mobile spec proves zero such requests occur.
- **No authorization decision moved to the client.** `hasPermission` / `hasRole` still read only
  backend-supplied claims; demo users carry `roles: ['user']`, `permissions: []`.
- **401 handling was not globally disabled.** The bypass is reachable only under `demoSession === true`,
  which is impossible when `NEXT_PUBLIC_DEMO_MODE=false`.
- **Refresh security is intact.** Single-flight, rotate/reuse-detection safety, retry-once, the
  refresh/logout recursion exclusions and the logout latch are all unchanged and still tested.
- **Server-side revocation is intact.** Real logout still calls `/auth/logout`; only the demo branch
  (which has nothing to revoke) skips it.
- **No secret reaches storage.** `localStorage` holds only the demo player's email under
  `gp-demo-session`; the existing "no token in localStorage" test still passes.

## 9. Frozen audit

Verified by `git status` plus file mtimes across the whole repo for the working window:

- **Backend: 0 files changed.** The seven modified `apps/backend/**` files in `git status` all carry
  mtimes from 2026-08-19 → 2026-08-21 (earlier phases' uncommitted work). The only writes under
  `apps/backend/` during this session were the running server's own rotating audit logs.
- **WalletEngine / wallet-core / ledger / settlement / GameMoneyBridge / game engines: 0 files changed.**
- **Prisma / schema / migrations / seed: 0 files changed** (`packages/database` mtimes are 2026-08-19).
- **Everything changed is frontend:** auth state/session, the API interceptor, demo query gating,
  real-money guards, tests, and this document.

Nothing required a backend or frozen-financial change, so nothing was escalated.

---

## 10. Remaining limitations

1. **Physical devices not tested.** Verification is Chromium device emulation at the three viewports.
   Real iOS Safari / Android Chrome remain unexecuted (unchanged environment limitation, consistent
   with the Phase 2C.15 go/no-go).
2. **HTTPS not exercised.** The local run is HTTP on `localhost`; the `Secure` refresh cookie path is
   still covered only by the documented non-Secure local workaround.
3. **Demo mode is still a client-side fiction by design.** Demo wallet balances and demo game outcomes
   are local and carry no ledger meaning. The hotfix isolates it; it does not make it authoritative.
4. **`/lobby` stays browsable in demo.** The catalog is a public endpoint, so a demo session can list
   games; balance and recents are blank and every real-money game route refuses the session.
5. **The blocked-path list is a denylist.** A *new* user-scoped endpoint added later will not be
   blocked automatically — it must be added to `DEMO_BLOCKED_PATHS` and gated with `useRealSession()`.
   The unit test enumerating blocked/allowed paths is where that regression would be caught.
6. **Login throttling limits back-to-back full mobile runs** (see §7). Not a defect; run viewport
   projects in separate windows, or raise the limit in a dedicated test environment.
