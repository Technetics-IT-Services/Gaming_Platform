/**
 * Shared helpers (Phase 6C) — cryptographically-random ids + PII masking.
 */

export function secureId(prefix: string, bytes = 8): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return `${prefix}_${Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Mask an email/phone for storage/display — never persist raw PII. */
export function maskContact(value: string): string {
  if (value.includes('@')) {
    const [user = '', domain = ''] = value.split('@');
    return `${user.slice(0, 2)}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
  }
  const digits = value.replace(/\D/g, '');
  return digits.length <= 4 ? '*'.repeat(digits.length) : `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}
