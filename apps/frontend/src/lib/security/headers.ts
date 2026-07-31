/**
 * Application security headers (Phase 8, STEP 1).
 *
 * A framework-agnostic builder for the production security-header set: Content
 * Security Policy, HSTS, frame protection, referrer + permissions policy, and secure
 * cookie attributes. It only produces header/cookie strings — it wraps the platform
 * and changes no business logic. Pure TS (no Node/Next).
 */

export interface CSPDirectives {
  [directive: string]: string[];
}

/** A strict, nonce-based default CSP suitable for the app (tighten per deployment). */
export function defaultCSP(nonce?: string): CSPDirectives {
  const scriptSrc = ["'self'", nonce ? `'nonce-${nonce}'` : "'strict-dynamic'"];
  return {
    'default-src': ["'self'"],
    'script-src': scriptSrc,
    'style-src': ["'self'", "'unsafe-inline'"], // inline styles; move to nonce where possible
    'img-src': ["'self'", 'data:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", 'https:'],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    'upgrade-insecure-requests': [],
  };
}

export function serializeCSP(directives: CSPDirectives): string {
  return Object.entries(directives)
    .map(([k, v]) => (v.length ? `${k} ${v.join(' ')}` : k))
    .join('; ');
}

export interface SecurityHeaderOptions {
  nonce?: string;
  csp?: CSPDirectives;
  /** HSTS max-age seconds (default 2 years). Set 0 to omit (e.g. non-HTTPS dev). */
  hstsMaxAge?: number;
  hstsPreload?: boolean;
  permissionsPolicy?: Record<string, string[]>;
  referrerPolicy?: string;
}

const DEFAULT_PERMISSIONS: Record<string, string[]> = {
  geolocation: [],
  camera: [],
  microphone: [],
  payment: ['self'],
  usb: [],
  'interest-cohort': [], // opt out of FLoC/Topics
};

/**
 * The full recommended security-header set. Returns a plain object the app/edge
 * middleware applies to every response (it never mutates a business response body).
 */
export function securityHeaders(opts: SecurityHeaderOptions = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Security-Policy': serializeCSP(opts.csp ?? defaultCSP(opts.nonce)),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': opts.referrerPolicy ?? 'strict-origin-when-cross-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Permitted-Cross-Domain-Policies': 'none',
    'Permissions-Policy': serializePermissions(opts.permissionsPolicy ?? DEFAULT_PERMISSIONS),
  };
  const maxAge = opts.hstsMaxAge ?? 63_072_000;
  if (maxAge > 0) headers['Strict-Transport-Security'] = `max-age=${maxAge}; includeSubDomains${opts.hstsPreload ? '; preload' : ''}`;
  return headers;
}

function serializePermissions(policy: Record<string, string[]>): string {
  return Object.entries(policy)
    .map(([feature, allow]) => `${feature}=(${allow.map((a) => (a === 'self' ? 'self' : `"${a}"`)).join(' ')})`)
    .join(', ');
}

/* -------------------------------- cookies --------------------------------- */

export interface CookieOptions {
  name: string;
  value: string;
  maxAgeSeconds?: number;
  path?: string;
  domain?: string;
  sameSite?: 'Strict' | 'Lax' | 'None';
  /** Force the __Host- prefix (implies Secure, path=/, no Domain). */
  hostPrefix?: boolean;
}

/**
 * Serialize a hardened session cookie: HttpOnly + Secure + SameSite by default. The
 * `__Host-` prefix is the strongest binding (host-only, path=/). Values are not
 * encoded here — pass an already-safe token.
 */
export function secureCookie(opts: CookieOptions): string {
  const secure = true;
  const sameSite = opts.sameSite ?? 'Lax';
  const name = opts.hostPrefix ? `__Host-${opts.name}` : opts.name;
  const parts = [`${name}=${opts.value}`, 'HttpOnly'];
  if (secure) parts.push('Secure');
  parts.push(`SameSite=${sameSite}`);
  // __Host- requires path=/ and forbids Domain.
  parts.push(`Path=${opts.hostPrefix ? '/' : opts.path ?? '/'}`);
  if (!opts.hostPrefix && opts.domain) parts.push(`Domain=${opts.domain}`);
  if (opts.maxAgeSeconds !== undefined) parts.push(`Max-Age=${opts.maxAgeSeconds}`);
  if (sameSite === 'None' && !secure) throw new Error('SameSite=None requires Secure');
  return parts.join('; ');
}
