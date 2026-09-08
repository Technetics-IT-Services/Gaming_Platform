import type { ApiErrorResponse, ApiResponse } from '@gaming-platform/types';
import axios, { type AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';

import { clientConfig } from './config';

/**
 * Shared Axios instance pointed at the versioned API. Sends credentials so the
 * refresh-token cookie flows automatically.
 */
export const apiClient: AxiosInstance = axios.create({
  baseURL: clientConfig.apiUrl,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
});

let accessToken: string | null = null;

/** Set or clear the in-memory bearer token used for authenticated requests. */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/**
 * Demo-session isolation (Phase 2C.15 hotfix).
 *
 * A demo session is a CLIENT-ONLY session: it has no backend session, no real access token and no
 * refresh cookie. Before this flag existed, a demo session looked exactly like a real one to this
 * module, so any user-scoped request 401'd, triggered `/auth/refresh` (also 401), and the refresh
 * failure tore the demo session down — the login → dashboard → /login redirect loop.
 *
 * The flag is set by the auth store whenever a demo session starts/ends (injected, not imported, so
 * api-client keeps zero dependencies on the auth layer). It changes NOTHING for real sessions.
 */
let demoSession = false;
export function setDemoSessionMode(value: boolean): void {
  demoSession = value;
}
export function isDemoSessionMode(): boolean {
  return demoSession;
}

/**
 * Endpoints a demo session must never call. These are the user-scoped / real-money surfaces: they
 * require a genuine server-authenticated principal, and a demo session has none. Requests to them
 * are rejected LOCALLY (never put on the wire) so a demo session can never present itself to the
 * backend as an authenticated player. Public surfaces (`/catalog`, `/games/:key/config`, the
 * featured/trending/popular shelves, auth endpoints) are deliberately NOT listed.
 */
const DEMO_BLOCKED_PATHS: RegExp[] = [
  // Phase 2D.4: a demo session has no backend principal, so it can never be a partner.
  /^\/partner(\/|\?|$)/,
  /^\/admin\/partners(\/|\?|$)/,
  /^\/wallet(\/|$)/, // balances, history
  /^\/wallet-engine(\/|$)/, // ledger, bonus, reward, transfers
  /^\/cashier(\/|$)/, // deposits, withdrawals, cashier config
  /^\/admin(\/|$)/, // operator surfaces
  /^\/users\/me(\/|$)/, // profile, verification
  /^\/settings(\/|$)/, // account + security
  /^\/recently-played(\/|$)/, // user-scoped play history
  /^\/games\/history(\/|$)/, // user-scoped round history
  /^\/games\/recommended(\/|\?|$)/, // user-scoped recommendations
  /^\/ai\/for-you(\/|\?|$)/, // user-scoped recommendation feed
  /^\/favorites(\/|$)/, // user-scoped favourites
  /^\/referral(\/|\?|$)/, // user-scoped referral attribution (Phase 2D.9)
  /^\/promotions(\/|\?|$)/, // authenticated offer list — a demo session has no principal (Phase 2D.9)
  /^\/notifications(\/|\?|$)/, // user-scoped notifications (Phase 2D.1)
  /^\/analytics(\/|\?|$)/, // operator analytics — never reachable from a demo session (Phase 2D.6)
  /^\/games\/[^/]+\/play$/, // REAL-MONEY BET — the one that must never be reachable
];

/** Normalize a request URL to a leading-slash path with no query string. */
function requestPath(url: string): string {
  const withoutQuery = url.split('?')[0] ?? '';
  const path = withoutQuery.replace(/^https?:\/\/[^/]+/, '').replace(/^.*\/api\/v\d+/, '');
  return path.startsWith('/') ? path : `/${path}`;
}

/** True when this request targets a user-scoped / real-money endpoint a demo session may not use. */
export function isDemoBlockedRequest(url: string): boolean {
  const path = requestPath(url);
  return DEMO_BLOCKED_PATHS.some((re) => re.test(path));
}

/** The error a blocked demo request rejects with. Shaped like any other normalized API error. */
export const DEMO_BLOCKED_ERROR: NormalizedApiError = {
  statusCode: 401,
  message: 'Demo session: real-money and account endpoints require a real signed-in account.',
  error: 'DEMO_SESSION_BLOCKED',
};

/**
 * A single-flight refresh handler registered by the auth-session module. Kept as an injected
 * function (not a static import) so api-client has no dependency cycle with the auth layer. On a
 * 401, the interceptor awaits ONE shared refresh and retries the original request once.
 */
type RefreshHandler = () => Promise<string | null>;
let refreshHandler: RefreshHandler | null = null;
export function setRefreshHandler(handler: RefreshHandler | null): void {
  refreshHandler = handler;
}

/** Per-request flags the interceptor honours. */
type RetryConfig = InternalAxiosRequestConfig & { _authRetried?: boolean; skipAuthRefresh?: boolean };

apiClient.interceptors.request.use((config) => {
  // A demo session's token is a client-side placeholder, never a backend credential: never present
  // it, and never let a demo session reach a user-scoped / real-money endpoint at all.
  if (demoSession) {
    if (isDemoBlockedRequest(config.url ?? '')) return Promise.reject(DEMO_BLOCKED_ERROR);
    return config;
  }
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorResponse>) => {
    const original = error.config as RetryConfig | undefined;
    const status = error.response?.status;
    const url = original?.url ?? '';
    // Never recursively refresh the refresh/logout endpoints; retry each request at most once.
    const excluded = url.includes('/auth/refresh') || url.includes('/auth/logout');
    // A demo session has no refresh cookie: refreshing would 401 and tear the demo session down.
    // Reject the failed request and leave the session alone. Real sessions are untouched.
    if (demoSession) return Promise.reject(normalizeError(error));
    if (status === 401 && original && refreshHandler && !original._authRetried && !original.skipAuthRefresh && !excluded) {
      original._authRetried = true;
      const token = await refreshHandler(); // single-flight — concurrent 401s share one refresh
      if (token) {
        original.headers = original.headers ?? {};
        (original.headers as Record<string, string>).Authorization = `Bearer ${token}`;
        return apiClient(original); // retry the original request with the fresh token
      }
      // Refresh failed → the auth-session module has cleared the session; fall through to reject.
    }
    return Promise.reject(normalizeError(error));
  },
);

export interface NormalizedApiError {
  statusCode: number;
  message: string;
  error: string;
}

function normalizeError(error: AxiosError<ApiErrorResponse>): NormalizedApiError {
  if (error.response?.data) {
    const { statusCode, message, error: code } = error.response.data;
    return { statusCode, message, error: code };
  }
  return {
    statusCode: error.response?.status ?? 0,
    message: error.message || 'Network error',
    error: error.code ?? 'NETWORK_ERROR',
  };
}

/** Unwrap the standard API envelope, returning just the `data` payload. */
export async function unwrap<T>(promise: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  const response = await promise;
  return response.data.data;
}
