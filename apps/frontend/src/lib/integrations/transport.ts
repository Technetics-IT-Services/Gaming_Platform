/**
 * Integration transport & crypto core (Phase 9).
 *
 * The shared plumbing every production adapter uses: an injectable `HttpTransport`
 * (so adapters are contract-testable without live network), a retry/backoff wrapper
 * with idempotency, a normalized `ProviderError`, and Web Crypto helpers (HMAC/SHA/
 * base64/hex) for signatures. Adapters implement the FROZEN platform interfaces —
 * nothing here changes business, financial or architectural logic.
 */

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';
  url: string;
  headers?: Record<string, string>;
  body?: string;
  /** Per-request timeout hint (ms). */
  timeoutMs?: number;
}
export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** The seam adapters depend on. Production binds `FetchTransport`; tests bind a mock. */
export interface HttpTransport {
  request(req: HttpRequest): Promise<HttpResponse>;
}

export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly code: 'network' | 'auth' | 'invalid_request' | 'server' | 'rate_limited' | 'verification_failed',
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(`[${provider}] ${code}: ${message}`);
    this.name = 'ProviderError';
  }
}

/** A `fetch`-backed transport (the production default). */
export class FetchTransport implements HttpTransport {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}
  async request(req: HttpRequest): Promise<HttpResponse> {
    const controller = new AbortController();
    const timer = req.timeoutMs ? setTimeout(() => controller.abort(), req.timeoutMs) : undefined;
    try {
      const res = await this.fetchImpl(req.url, { method: req.method, headers: req.headers, body: req.body, signal: controller.signal });
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k] = v));
      return { status: res.status, headers, body: await res.text() };
    } catch (e) {
      throw new ProviderError('http', 'network', (e as Error).message, undefined, true);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  factor?: number;
  maxDelayMs?: number;
  /** Async sleeper (injectable for deterministic tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Decide whether a caught error is retryable (default: ProviderError.retryable). */
  isRetryable?: (err: unknown) => boolean;
}

/** Retry an async op with exponential backoff. Retries only retryable failures. */
export async function withRetry<T>(op: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const base = opts.baseDelayMs ?? 200;
  const factor = opts.factor ?? 2;
  const maxDelay = opts.maxDelayMs ?? 5_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const retryable = opts.isRetryable ?? ((e: unknown) => e instanceof ProviderError && e.retryable);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await op(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !retryable(err)) throw err;
      await sleep(Math.min(maxDelay, base * factor ** (attempt - 1)));
    }
  }
  throw lastErr;
}

/* --------------------------------- crypto --------------------------------- */

const enc = new TextEncoder();

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  // btoa exists in browsers + modern Node global scope.
  return btoa(bin);
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input) as BufferSource);
  return toHex(new Uint8Array(digest));
}

async function hmacRaw(key: Uint8Array, msg: string, hash: 'SHA-256' | 'SHA-1'): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg) as BufferSource);
  return new Uint8Array(sig);
}
export async function hmacSha256(key: Uint8Array, msg: string): Promise<Uint8Array> {
  return hmacRaw(key, msg, 'SHA-256');
}
export async function hmacSha256Hex(key: string | Uint8Array, msg: string): Promise<string> {
  return toHex(await hmacSha256(typeof key === 'string' ? enc.encode(key) : key, msg));
}
export async function hmacSha1Base64(key: string, msg: string): Promise<string> {
  return toBase64(await hmacRaw(enc.encode(key), msg, 'SHA-1'));
}

/** Constant-time compare of two strings (signature verification). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Read a value from an injected config map, throwing a clear error when missing. */
export function requireConfig(config: Record<string, string | undefined>, key: string, provider: string): string {
  const v = config[key];
  if (!v) throw new ProviderError(provider, 'invalid_request', `missing config: ${key}`);
  return v;
}
