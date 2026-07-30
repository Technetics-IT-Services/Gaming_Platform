/**
 * Payment crypto helpers (Phase 5B).
 *
 * The signature schemes gateways actually use — HMAC-SHA256 (Razorpay/Stripe/
 * Cashfree) and SHA-256 (PhonePe) — plus a timing-safe comparison and secure id
 * generation. Web Crypto (`crypto.subtle`) works in the browser and Node 20+, so
 * this module is framework-agnostic and async (as real gateway verification is).
 * Secrets are only ever used to compute a digest — never logged or returned.
 */

const enc = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64(buf: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
}

/** HMAC-SHA256(message, secret) as lowercase hex (Razorpay/Stripe scheme). */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  return toHex(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(message)));
}

/** HMAC-SHA256(message, secret) as base64 (Cashfree scheme). */
export async function hmacSha256Base64(secret: string, message: string): Promise<string> {
  return toBase64(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(message)));
}

/** SHA-256(message) as lowercase hex (PhonePe X-VERIFY scheme). */
export async function sha256Hex(message: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(message)));
}

/** Constant-time string comparison (no early return on mismatch). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

/** Cryptographically-random, collision-resistant identifier. */
export function secureId(prefix: string): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
