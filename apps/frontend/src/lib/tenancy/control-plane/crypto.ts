/**
 * Control-plane cryptography (Phase 3.2, STEP 8 & 9).
 *
 * Cryptographically secure API-key generation, hash-only storage, timing-safe
 * verification, and domain verification tokens. The database NEVER stores a plaintext key
 * or secret — only a `sha-256` hash + a safe display prefix. Uses Node's `crypto`; this
 * module is server-only (not re-exported from the browser-safe tenancy barrel).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface GeneratedApiKey {
  /** Full secret — shown to the caller EXACTLY ONCE, never stored. */
  plaintext: string;
  /** Safe-to-store/display identifier, e.g. `tk_live_ab12cd`. */
  prefix: string;
  /** sha-256 of the plaintext — the only key material persisted. */
  hash: string;
}

/** Generate a secure API key. `env` distinguishes live/test keys. */
export function generateApiKey(env: 'live' | 'test' = 'live'): GeneratedApiKey {
  const raw = randomBytes(24).toString('base64url'); // 32 url-safe chars
  const plaintext = `tk_${env}_${raw}`;
  const prefix = `tk_${env}_${raw.slice(0, 6)}`;
  return { plaintext, prefix, hash: hashSecret(plaintext) };
}

/** sha-256 hex digest. */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Timing-safe comparison of a presented key against a stored hash. */
export function verifyAgainstHash(presentedPlaintext: string, storedHash: string): boolean {
  const a = Buffer.from(hashSecret(presentedPlaintext), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** A random verification token for domain challenges. */
export function verificationToken(): string {
  return `verify_${randomBytes(18).toString('hex')}`;
}

/** A random correlation id for a control-plane operation. */
export function correlationId(): string {
  return `cor_${randomBytes(9).toString('hex')}`;
}
