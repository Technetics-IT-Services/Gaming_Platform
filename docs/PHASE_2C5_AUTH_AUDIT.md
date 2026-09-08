# Phase 2C.5 — Authentication / Session Restoration Audit

Read-first audit of the frontend auth bootstrap + backend refresh flow, identifying the exact race
behind the "protected page redirects to /login before the session is restored" symptom.

## 1. Current authentication architecture

- **One frontend auth state** — `useAuthStore` (Zustand, `stores/auth-store.ts`): `{ user, accessToken,
  isAuthenticated, initialized }`. The access token lives **in memory only** and is mirrored into the
  Axios client via `setAccessToken` (`lib/api-client.ts`). No token in localStorage.
- **Bootstrap** — `AuthInitializer` (`components/auth/auth-initializer.tsx`), mounted once in
  `AppProviders` (root layout). On mount it silently refreshes: `authApi.refresh()` → `setAccessToken`
  → `authApi.me()` → `setSession`; on failure → `setInitialized(true)`.
- **Guard** — `AuthGuard` (`components/auth/auth-guard.tsx`) wraps `(dashboard)`, `(casino)`, `(game)`,
  `admin`, `collections` layouts. While `!initialized` it shows a full-screen `<Spinner>`; once
  `initialized`, guests → `router.replace('/login')`, authenticated → children.
- **Backend** — `POST /auth/login` (sets httpOnly `gp_refresh` cookie, SameSite=lax, Secure per env),
  `POST /auth/refresh` (reads cookie, **rotates**), `POST /auth/logout` (revokes session + clears
  cookie), `GET /auth/me` (bearer-guarded). Same-origin in production via the nginx/`BACKEND_ORIGIN`
  proxy so `withCredentials` carries the cookie.

## 2. Current session lifecycle

`login` → access token in memory + `gp_refresh` cookie → app renders authenticated. On **reload /
direct navigation** the in-memory token is gone; `AuthInitializer` silently refreshes from the cookie
to restore it. `logout` revokes the session and clears the cookie.

## 3. Current refresh flow

`authApi.refresh()` → `POST /auth/refresh` (cookie or body token) → `SessionService.rotate()`:
verifies the token, looks up its `RefreshToken` record by hash, and **rotates** (marks the presented
token consumed, issues a new pair + new cookie). There is **no client-side single-flight**: the only
refresh today is the one-shot in `AuthInitializer`. There is **no 401→refresh interceptor** — an
expired access token mid-session is not recovered until a manual reload.

## 4. AuthGuard lifecycle

`AuthGuard` is **correct in isolation**: it renders a spinner while `!initialized` and only
redirects **after** bootstrap resolves (`initialized === true && !isAuthenticated`). It does **not**
redirect during loading. So a wrong redirect can only occur if **bootstrap itself resolves to
unauthenticated** — i.e. the silent refresh *fails*.

## 5. Exact race condition

The backend refresh is **rotating with reuse-detection** (`SessionService.rotate`,
`session.service.ts:119-122`):

```ts
if (record.status !== TokenStatus.ACTIVE) {
  // Reuse of a rotated/revoked token → compromise. Burn the whole family.
  await this.handleReuse(record.userId, record.family, record.sessionId, meta);
  throw new UnauthorizedException('Refresh token reuse detected. All sessions were revoked.');
}
```

If `/auth/refresh` is called **twice with the same cookie token** — concurrently, or twice in quick
succession — the first rotation flips the record out of `ACTIVE`; the second presents the now-rotated
token, trips reuse-detection, and **burns the entire session family** (revoking even the freshly
issued token). The silent refresh then fails → `AuthGuard` sees `initialized && !isAuthenticated` →
redirects to `/login`.

Double-refresh is easy to trigger with the current client:
- **React StrictMode** (`reactStrictMode: true`) double-invokes effects in development → two
  `AuthInitializer` refreshes with the same token.
- Any future/parallel refresh (e.g. adding a naïve 401 interceptor) → concurrent refreshes.
- A remount of the provider tree re-runs the one-shot with the same cookie.

There is no client guard preventing two in-flight refreshes for the same token.

Secondary contributors:
- `AuthInitializer` marks `isAuthenticated` (via `setAccessToken`) **before** `me()` resolves; a
  `me()` failure leaves an incoherent "authenticated but no user" state.
- Bootstrap is not idempotent — the effect can run more than once with no shared promise.

## 6. Root cause

**Missing client-side single-flight / idempotent bootstrap around a rotating, reuse-detecting refresh
endpoint.** Concurrent or repeated refresh calls present an already-rotated token, the backend burns
the session family, and the guard then correctly (but undesirably) redirects the now-unauthenticated
user to `/login`. The backend is behaving *correctly* — the defect is entirely on the client, which
must ensure **exactly one** refresh is ever in flight and the bootstrap runs **once**.

## 7. Security implications

The backend reuse-detection is a genuine security control (stolen-token defence) and **must not be
weakened**. The fix must make the *legitimate* client issue one refresh at a time — never suppress or
bypass reuse-detection, never move the refresh token to JS-readable storage, never trust client
claims for authorization. Logout must remain authoritative (server revokes) and a revoked cookie must
never restore a session.

## 8. Recommended architecture

Smallest production-safe change, all additive on the client (zero backend change):

1. **Single-flight session module** (`lib/auth-session.ts`): a module-level, deduped `refreshSession()`
   (concurrent callers share one in-flight promise) and an idempotent `bootstrapSession()` (shared
   promise so StrictMode / remounts run it once). A `markLoggedOut()` latch so a bootstrap after
   logout resolves to unauthenticated without hitting refresh.
2. **Explicit auth state machine** in the store: `status: 'bootstrapping' | 'authenticated' |
   'unauthenticated' | 'refreshing' | 'logging-out'` (keep `isAuthenticated`/`initialized` derived for
   back-compat). One authoritative state.
3. **AuthInitializer** → calls the idempotent `bootstrapSession()`.
4. **api-client 401 interceptor** → on 401 (excluding `/auth/refresh` and `/auth/logout`), await the
   shared single-flight refresh **once**, retry the original request once; on refresh failure clear the
   session. No infinite loop (one retry flag); refresh endpoint never recursively refreshed.
5. **AuthGuard** — keep the "wait for bootstrap" logic; replace the bare spinner with a lightweight,
   overflow-safe mobile shell.
6. **Mobile shell** — add `viewportFit: 'cover'` (so `env(safe-area-inset-*)` actually applies);
   verify bottom-nav safe-area + content bottom padding + no horizontal overflow at 375/390/412.

## 9. Files that need modification

- `apps/frontend/src/lib/auth-session.ts` — **new** (single-flight refresh + idempotent bootstrap + logout).
- `apps/frontend/src/stores/auth-store.ts` — add explicit `status`; keep derived flags.
- `apps/frontend/src/components/auth/auth-initializer.tsx` — call `bootstrapSession()`.
- `apps/frontend/src/lib/api-client.ts` — add single-flight 401→refresh interceptor.
- `apps/frontend/src/components/auth/auth-guard.tsx` — mobile loading shell (logic unchanged).
- `apps/frontend/src/app/layout.tsx` — `viewport.viewportFit: 'cover'`.
- Possibly small tweaks to `bottom-nav` / dashboard layout padding if the audit finds overflow.
- Tests + docs.

## 10. Files that must remain frozen

Backend auth (`auth.controller`, `session.service`, `token.service`, JWT guard, cookie config, CORS),
and the entire financial/game core (WalletEngine, ledger, treasury, settlement, reservations,
recovery, GameMoneyBridge, all game engines, RTP/payout math). No schema change.

## 11. Test strategy

- **Unit (Vitest)**: single-flight refresh dedupes concurrent callers to one backend call; bootstrap
  idempotent; refresh failure → unauthenticated + cleared token; logout latch prevents resurrection;
  no refresh of `/auth/refresh`/`/auth/logout`; store state-machine transitions; guard waits during
  `bootstrapping`, redirects only when `unauthenticated`, allows when `authenticated`; refresh token
  never written to localStorage; identity comes from `me()` (backend), never a client userId.
- **Live (Playwright, real login + cookie + refresh)**: Flows A–F (reload / direct nav to
  `/wallet/history`, `/game-history`, `/dice-money`; in-memory token cleared → cookie restores;
  logout → reload → login; refresh-after-logout → 401) + no-login-flash on restore.

## 11b. Live finding (post-implementation, honest correction)

Live browser instrumentation revealed the **primary** blocker behind the "protected page → /login" symptom
across all earlier phases was **not** the reuse-detection race but a **test-harness build bug**: Git
Bash / MSYS path-mangled the build-time `NEXT_PUBLIC_API_URL=/api/v1` into `C:/Program Files/Git/api/v1`,
so the compiled SPA's Axios `baseURL` was invalid (`Unsupported protocol C:`) and `/auth/refresh` **never
fired** (network trace showed zero auth calls; the bootstrap immediately resolved unauthenticated).
Providing the value via a build-time env file (`.env.production.local`, immune to shell mangling) fixed
the `baseURL`, after which the new single-flight bootstrap restored the session cleanly on every reload /
direct navigation. The reuse-detection double-refresh gap identified above is a genuine latent defect and
is still closed by the single-flight/idempotent design (it would have surfaced once refresh actually fired,
e.g. under StrictMode or the new 401 interceptor). Real production (nginx/HTTPS, non-Git-Bash env) sets the
URL correctly, so this was environment-specific — but the client hardening remains the correct fix.

## 12. Mobile verification strategy

Playwright at 375×812 / 390×844 / 412×915: login → protected route → reload → still authenticated, no
horizontal overflow, bottom-nav reachable and not covering content, loading shell stable (no flash of
login or empty dashboard). If headless authenticated rendering hits the (now-fixed) restoration path
it should succeed; any residual environment limitation is reported honestly with HTTP-level evidence.
