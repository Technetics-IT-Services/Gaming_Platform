/**
 * Control-plane persistence errors (Phase 3.2).
 *
 * Deterministic, framework-agnostic error codes so callers never see raw database
 * details. Every repository/service throws one of these; the control plane maps them to
 * stable codes for auditing and API responses. Additive — no frozen module involved.
 */

export type ControlPlaneErrorCode =
  | 'NOT_FOUND'
  | 'CONFLICT' // optimistic-concurrency version mismatch
  | 'UNIQUE_VIOLATION'
  | 'VALIDATION'
  | 'FORBIDDEN'
  | 'ILLEGAL_TRANSITION'
  | 'PROVISIONING_FAILED'
  | 'DOMAIN_VERIFICATION_FAILED'
  | 'DOMAIN_TAKEOVER'
  | 'KEY_REVOKED'
  | 'KEY_EXPIRED'
  | 'NOT_ACTIVE'
  | 'IMMUTABLE';

export class ControlPlaneError extends Error {
  constructor(
    readonly code: ControlPlaneErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ControlPlaneError';
  }
}

export const notFound = (what: string, id?: string) => new ControlPlaneError('NOT_FOUND', `${what}${id ? ` "${id}"` : ''} not found`);
export const conflict = (what: string, expected: number, actual: number) =>
  new ControlPlaneError('CONFLICT', `${what} was modified concurrently (expected v${expected}, found v${actual})`, { expected, actual });
export const uniqueViolation = (what: string, key: string) => new ControlPlaneError('UNIQUE_VIOLATION', `${what} "${key}" already exists`, { key });
export const validation = (message: string, details?: Record<string, unknown>) => new ControlPlaneError('VALIDATION', message, details);
export const forbidden = (message: string, details?: Record<string, unknown>) => new ControlPlaneError('FORBIDDEN', message, details);
export const illegalTransition = (from: string, to: string) => new ControlPlaneError('ILLEGAL_TRANSITION', `illegal transition ${from} → ${to}`, { from, to });
