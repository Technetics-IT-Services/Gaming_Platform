/**
 * Input validation, output encoding & request-safety framework (Phase 8, STEP 1).
 *
 * Defense-in-depth building blocks that wrap the platform: a declarative input
 * validator, context-aware output encoders (HTML/attr/JS/URL), CSRF token
 * issue/verify (double-submit / synchronizer), and an SSRF URL guard. Pure functions
 * — no business logic, no money movement.
 */

/* ------------------------------ input validation -------------------------- */

export type Validator<T> = (value: unknown, field: string) => { ok: true; value: T } | { ok: false; error: string };

export const V = {
  string(opts: { min?: number; max?: number; pattern?: RegExp; trim?: boolean } = {}): Validator<string> {
    return (raw, field) => {
      if (typeof raw !== 'string') return { ok: false, error: `${field} must be a string` };
      const value = opts.trim ? raw.trim() : raw;
      if (opts.min !== undefined && value.length < opts.min) return { ok: false, error: `${field} must be ≥ ${opts.min} chars` };
      if (opts.max !== undefined && value.length > opts.max) return { ok: false, error: `${field} must be ≤ ${opts.max} chars` };
      if (opts.pattern && !opts.pattern.test(value)) return { ok: false, error: `${field} has an invalid format` };
      return { ok: true, value };
    };
  },
  integer(opts: { min?: number; max?: number } = {}): Validator<number> {
    return (raw, field) => {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isInteger(n)) return { ok: false, error: `${field} must be an integer` };
      if (opts.min !== undefined && n < opts.min) return { ok: false, error: `${field} must be ≥ ${opts.min}` };
      if (opts.max !== undefined && n > opts.max) return { ok: false, error: `${field} must be ≤ ${opts.max}` };
      return { ok: true, value: n };
    };
  },
  email(): Validator<string> {
    return (raw, field) => {
      if (typeof raw !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return { ok: false, error: `${field} must be a valid email` };
      return { ok: true, value: raw.toLowerCase() };
    };
  },
  enum<T extends string>(values: readonly T[]): Validator<T> {
    return (raw, field) => (values.includes(raw as T) ? { ok: true, value: raw as T } : { ok: false, error: `${field} must be one of ${values.join(', ')}` });
  },
};

export class ValidationError extends Error {
  constructor(readonly issues: { field: string; error: string }[]) {
    super(`Validation failed: ${issues.map((i) => i.error).join('; ')}`);
    this.name = 'ValidationError';
  }
}

/** Validate an input object against a schema of validators. Aggregates all errors. */
export function validate<S extends Record<string, Validator<unknown>>>(input: Record<string, unknown>, schema: S): { [K in keyof S]: S[K] extends Validator<infer T> ? T : never } {
  const issues: { field: string; error: string }[] = [];
  const out: Record<string, unknown> = {};
  for (const [field, validator] of Object.entries(schema)) {
    const result = validator(input[field], field);
    if (result.ok) out[field] = result.value;
    else issues.push({ field, error: result.error });
  }
  if (issues.length) throw new ValidationError(issues);
  return out as never;
}

/* ------------------------------ output encoding --------------------------- */

const HTML_ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const NON_ALNUM = /[^a-zA-Z0-9]/g;

/** Context-aware encoders — the correct escape for each output sink (anti-XSS). */
export const encode = {
  html(input: string): string {
    return input.replace(/[&<>"']/g, (c) => HTML_ENTITIES[c] as string);
  },
  htmlAttr(input: string): string {
    // Encode everything non-alphanumeric to a hex entity — safe inside quoted attrs.
    return input.replace(NON_ALNUM, (c) => `&#x${c.charCodeAt(0).toString(16)};`);
  },
  js(input: string): string {
    // Escape every non-alphanumeric to a \uXXXX form — safe inside a JS string literal.
    return input.replace(NON_ALNUM, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  },
  url(input: string): string {
    return encodeURIComponent(input);
  },
};

/* --------------------------------- CSRF ----------------------------------- */

function secureToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string compare (prevents token-timing oracles). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Double-submit CSRF: issue a token (cookie + form) and verify they match. */
export const csrf = {
  issue(): string {
    return secureToken();
  },
  verify(cookieToken: string | undefined, requestToken: string | undefined): boolean {
    if (!cookieToken || !requestToken) return false;
    return timingSafeEqual(cookieToken, requestToken);
  },
};

/* --------------------------------- SSRF ----------------------------------- */

const PRIVATE_RANGES = [/^127\./, /^10\./, /^192\.168\./, /^169\.254\./, /^0\./, /^::1$/, /^fc00:/, /^fe80:/, /^172\.(1[6-9]|2\d|3[01])\./];

/**
 * SSRF guard for outbound-fetch targets: only https, host must be allow-listed, and
 * literal private/loopback/link-local IPs are rejected. Returns a reason on failure.
 */
export function assertOutboundUrlSafe(rawUrl: string, allowHosts: string[]): { ok: true } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'invalid URL' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'only https is allowed' };
  const host = url.hostname.toLowerCase();
  if (PRIVATE_RANGES.some((re) => re.test(host))) return { ok: false, reason: 'private/loopback address blocked' };
  const allowed = allowHosts.map((h) => h.toLowerCase());
  if (!allowed.includes(host)) return { ok: false, reason: `host ${host} not in allow-list` };
  return { ok: true };
}
