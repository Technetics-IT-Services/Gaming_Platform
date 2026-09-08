# Phase 2C.5 — Authentication Session Architecture

Production session bootstrap + single-flight refresh that reliably restores an authenticated session
on reload / direct navigation, without weakening backend security. Frontend-only; zero backend
change.

## The one authoritative state

`useAuthStore` (`stores/auth-store.ts`) holds the single source of truth as an explicit state
machine:

```
status: 'bootstrapping' | 'authenticated' | 'unauthenticated' | 'refreshing' | 'logging-out'
```

`initialized` (what `AuthGuard` waits on) is **derived**: `false` only while BOOTSTRAPPING/REFRESHING.
`isAuthenticated` is derived too. The access token lives in memory only (mirrored into Axios); the
refresh token is an httpOnly cookie the JS never sees.

## Session lifecycle

```
app start → AuthProvider mounts AuthInitializer
          → bootstrapSession()            (status: BOOTSTRAPPING; AuthGuard shows the loading shell)
              → refreshSession()          (single-flight POST /auth/refresh, cookie)
                  ├─ token → GET /auth/me → setSession()      (status: AUTHENTICATED → guard renders)
                  └─ no token             → setUnauthenticated() (status: UNAUTHENTICATED → guard → /login)
```

`AuthGuard` **never** redirects while `!initialized`; it only acts once bootstrap resolves. So a valid
refresh cookie always restores the session before any redirect decision — no login flash.

## Single-flight refresh (the fix)

The backend `/auth/refresh` **rotates** the token and burns the whole session family on reuse
(`SessionService.rotate`). The client now guarantees **exactly one** refresh is ever in flight
(`lib/auth-session.ts`):

- `refreshSession()` — module-level shared promise; concurrent callers await the same call. On success:
  set the access token + mark authenticated. On failure: clear + unauthenticated. Passes
  `skipAuthRefresh` so the 401 interceptor never recurses on the refresh call itself.
- `bootstrapSession()` — module-level shared promise; StrictMode double-invokes and remounts reuse it,
  so startup issues **one** refresh + **one** `/me`.
- **api-client 401 interceptor** (`lib/api-client.ts`) — on a 401 (excluding `/auth/refresh` and
  `/auth/logout`), it awaits the **same** single-flight refresh once and retries the original request
  once (`_authRetried` flag → no loop). Concurrent 401s therefore trigger exactly one refresh, and all
  waiting requests retry with the fresh token.

This eliminates the double/concurrent refresh that previously tripped reuse-detection and force-logged
the user out.

## Logout / revocation

`logoutSession()`:
1. `POST /auth/logout` — backend revokes the session + clears the cookie (unchanged, authoritative).
2. Sets a module logout **latch** (`loggedOut = true`) so any in-flight/queued refresh returns null
   instead of resurrecting the session.
3. Clears the in-memory session (`clearSession`) → UNAUTHENTICATED.

Local state is cleared even if the network call fails. A subsequent explicit login (`notifyLogin()`)
clears the latch. After logout, a reload re-inits the module and the cleared cookie makes `/auth/refresh`
return 401 → UNAUTHENTICATED. So a revoked session can never be restored.

## Security model

- Refresh token stays an httpOnly, Secure (prod), SameSite=lax cookie — never in localStorage, never in
  React state.
- The access token is in memory only.
- Authorization identity always comes from the backend (`/auth/me`); the client never derives auth
  from decoded JWT claims or a client-supplied userId.
- Backend JWT rotation, reuse-detection, RBAC, CORS and cookie flags are unchanged and unweakened.
- No token/secret is logged.

## Files

- `lib/auth-session.ts` (new), `lib/api-client.ts` (401 single-flight interceptor + `setRefreshHandler`),
  `stores/auth-store.ts` (explicit status), `components/auth/auth-initializer.tsx` (calls
  `bootstrapSession`), `components/auth/auth-guard.tsx` (loading shell), plus login/register
  (`notifyLogin`) and the two logout handlers (`logoutSession`).

## Deployment requirements

Production is same-origin (nginx / `BACKEND_ORIGIN` proxy) so `withCredentials` carries the cookie to
`/auth/refresh`. `cookieSecure=true` and an appropriate SameSite in production. No new env vars.

## Known limitations

- The logout latch is per page-session (module state); a hard reload re-inits it — correctness is
  preserved by the server-side cookie clear + revocation.
- Access-token lifetime is unchanged; the 401 interceptor now recovers expired tokens mid-session.
