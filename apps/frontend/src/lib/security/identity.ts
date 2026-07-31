/**
 * Identity security (Phase 8, STEP 2).
 *
 * MFA (RFC 6238 TOTP over Web Crypto), a WebAuthn provider interface, a password
 * policy framework, an account-lockout policy, and a secure session platform with
 * refresh-token rotation + reuse detection + revocation + an access-token blacklist.
 * It wraps authentication — it owns no money and changes no business logic.
 */

/* ---------------------------------- TOTP ---------------------------------- */

/** Decode an RFC 4648 base32 secret to bytes (padding optional). */
export function base32Decode(input: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

async function hmacSha1(keyBytes: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', keyBytes as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, msg as BufferSource);
  return new Uint8Array(sig);
}

/** HOTP (RFC 4226) for a counter with dynamic truncation. */
export async function hotp(keyBytes: Uint8Array, counter: number, digits = 6): Promise<string> {
  const buf = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i -= 1) {
    buf[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const hash = await hmacSha1(keyBytes, buf);
  const offset = hash[hash.length - 1]! & 0x0f;
  const code = ((hash[offset]! & 0x7f) << 24) | ((hash[offset + 1]! & 0xff) << 16) | ((hash[offset + 2]! & 0xff) << 8) | (hash[offset + 3]! & 0xff);
  return (code % 10 ** digits).toString().padStart(digits, '0');
}

/** TOTP (RFC 6238) for a Unix time (ms). */
export async function totp(keyBytes: Uint8Array, timeMs: number, opts: { stepSeconds?: number; digits?: number; t0?: number } = {}): Promise<string> {
  const step = opts.stepSeconds ?? 30;
  const counter = Math.floor((Math.floor(timeMs / 1000) - (opts.t0 ?? 0)) / step);
  return hotp(keyBytes, counter, opts.digits ?? 6);
}

export class MFAService {
  constructor(private readonly clock: () => number = () => Date.now()) {}

  /** Verify a submitted code, allowing ±`window` steps for clock drift. */
  async verifyTotp(base32Secret: string, code: string, opts: { window?: number; stepSeconds?: number; digits?: number } = {}): Promise<boolean> {
    const key = base32Decode(base32Secret);
    const window = opts.window ?? 1;
    const now = this.clock();
    for (let w = -window; w <= window; w += 1) {
      const candidate = await totp(key, now + w * (opts.stepSeconds ?? 30) * 1000, { stepSeconds: opts.stepSeconds, digits: opts.digits });
      if (candidate.length === code.length && constantTimeEqual(candidate, code)) return true;
    }
    return false;
  }

  /** Provisioning URI for an authenticator app (otpauth://). */
  provisioningUri(account: string, base32Secret: string, issuer = 'GamingPlatform'): string {
    return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${base32Secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* -------------------------------- WebAuthn -------------------------------- */

/** WebAuthn / passkey provider interface (implemented by a real library adapter). */
export interface IWebAuthnProvider {
  readonly name: string;
  registrationOptions(input: { userId: string; userName: string }): Promise<Record<string, unknown>>;
  verifyRegistration(input: { userId: string; response: unknown }): Promise<{ credentialId: string; publicKey: string; counter: number }>;
  authenticationOptions(input: { userId: string }): Promise<Record<string, unknown>>;
  verifyAuthentication(input: { userId: string; response: unknown }): Promise<{ ok: boolean; newCounter: number }>;
}

/* ----------------------------- password policy ---------------------------- */

export interface PasswordPolicy {
  minLength: number;
  requireUpper: boolean;
  requireLower: boolean;
  requireDigit: boolean;
  requireSymbol: boolean;
  /** Reject passwords found in this denylist (breached/common). */
  denylist?: string[];
}
export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = { minLength: 12, requireUpper: true, requireLower: true, requireDigit: true, requireSymbol: true, denylist: ['password', '12345678', 'qwerty'] };

export function checkPassword(password: string, policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (password.length < policy.minLength) issues.push(`must be ≥ ${policy.minLength} characters`);
  if (policy.requireUpper && !/[A-Z]/.test(password)) issues.push('must contain an uppercase letter');
  if (policy.requireLower && !/[a-z]/.test(password)) issues.push('must contain a lowercase letter');
  if (policy.requireDigit && !/\d/.test(password)) issues.push('must contain a digit');
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) issues.push('must contain a symbol');
  if (policy.denylist?.some((d) => password.toLowerCase().includes(d))) issues.push('is a commonly-breached password');
  return { ok: issues.length === 0, issues };
}

/* ---------------------------- account lockout ----------------------------- */

export interface LockoutPolicy {
  maxAttempts: number;
  windowMs: number;
  lockMs: number;
}
export const DEFAULT_LOCKOUT: LockoutPolicy = { maxAttempts: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 };

export class AccountLockout {
  private readonly attempts = new Map<string, number[]>();
  private readonly lockedUntil = new Map<string, number>();
  constructor(private readonly policy: LockoutPolicy = DEFAULT_LOCKOUT, private readonly clock: () => number = () => Date.now()) {}

  isLocked(id: string): boolean {
    const until = this.lockedUntil.get(id);
    return until !== undefined && this.clock() < until;
  }
  recordFailure(id: string): { locked: boolean; remaining: number } {
    const now = this.clock();
    const recent = [...(this.attempts.get(id) ?? []).filter((t) => now - t < this.policy.windowMs), now];
    this.attempts.set(id, recent);
    if (recent.length >= this.policy.maxAttempts) {
      this.lockedUntil.set(id, now + this.policy.lockMs);
      this.attempts.delete(id);
      return { locked: true, remaining: 0 };
    }
    return { locked: false, remaining: this.policy.maxAttempts - recent.length };
  }
  recordSuccess(id: string): void {
    this.attempts.delete(id);
    this.lockedUntil.delete(id);
  }
}

/* --------------------------- secure session platform ---------------------- */

export interface Session {
  id: string;
  userId: string;
  createdAt: number;
  lastRotatedAt: number;
  revoked: boolean;
}

function secureId(prefix: string, bytes = 24): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return `${prefix}_${Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Sessions with **refresh-token rotation** and **reuse detection**: each refresh
 * issues a new token and invalidates the old one; presenting a used token signals
 * theft and revokes the whole session family. Plus an access-token (jti) blacklist.
 */
export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly activeRefresh = new Map<string, string>(); // sessionId → current refresh token
  private readonly usedRefresh = new Set<string>();
  private readonly blacklist = new Set<string>();
  constructor(private readonly clock: () => number = () => Date.now()) {}

  create(userId: string): { session: Session; refreshToken: string } {
    const now = this.clock();
    const session: Session = { id: secureId('sess'), userId, createdAt: now, lastRotatedAt: now, revoked: false };
    const refreshToken = secureId('rt');
    this.sessions.set(session.id, session);
    this.activeRefresh.set(session.id, refreshToken);
    return { session, refreshToken };
  }

  /** Rotate the refresh token. Reuse of a spent token revokes the session (theft). */
  rotate(sessionId: string, presentedToken: string): { ok: true; refreshToken: string } | { ok: false; reason: string } {
    const session = this.sessions.get(sessionId);
    if (!session || session.revoked) return { ok: false, reason: 'no active session' };
    if (this.usedRefresh.has(presentedToken)) {
      this.revoke(sessionId); // reuse detected → breach response
      return { ok: false, reason: 'refresh token reuse detected — session revoked' };
    }
    if (this.activeRefresh.get(sessionId) !== presentedToken) return { ok: false, reason: 'stale or invalid refresh token' };
    this.usedRefresh.add(presentedToken);
    const next = secureId('rt');
    this.activeRefresh.set(sessionId, next);
    session.lastRotatedAt = this.clock();
    return { ok: true, refreshToken: next };
  }

  revoke(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (s) s.revoked = true;
    this.activeRefresh.delete(sessionId);
  }
  revokeAllForUser(userId: string): number {
    let n = 0;
    for (const s of this.sessions.values()) if (s.userId === userId && !s.revoked) { this.revoke(s.id); n += 1; }
    return n;
  }
  isActive(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.revoked === false;
  }

  /** Access-token (JWT jti) blacklist — checked on every request. */
  blacklistToken(jti: string): void {
    this.blacklist.add(jti);
  }
  isBlacklisted(jti: string): boolean {
    return this.blacklist.has(jti);
  }
}
