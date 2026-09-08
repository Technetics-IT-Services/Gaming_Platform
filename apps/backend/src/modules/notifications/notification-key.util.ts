import { createHash } from 'node:crypto';

/**
 * Deterministic notification identity (Phase 2D.1, Phase F — idempotency).
 *
 * The `Notification` table has no unique column other than its primary key, and the existing schema is
 * otherwise sufficient — so rather than add a migration we derive the PRIMARY KEY itself from the
 * event. The same domain event therefore always produces the same `id`, and a second insert violates
 * the primary key instead of creating a duplicate row.
 *
 * Why this is the right mechanism rather than an in-memory guard:
 *   - it is enforced by POSTGRES, so two concurrent workers cannot both win;
 *   - it is a table constraint, so it SURVIVES A RESTART (an in-memory Set does not);
 *   - it needs no schema change.
 *
 * The output is a valid RFC-4122 UUID (version 5 bits, IETF variant) so it satisfies the column's
 * `@db.Uuid` type. It is a hash, not a random value: identical input ⇒ identical UUID, forever.
 */

/** Namespace prefix so these ids can never collide with unrelated hashed identifiers. */
const NAMESPACE = 'gaming-platform:notification:v1:';

/**
 * Build the stable identity for one notification.
 *
 * @param eventKey A key that uniquely and PERMANENTLY identifies the underlying domain event —
 *   e.g. `withdrawal:approved:<withdrawalId>`. It must not contain anything volatile (timestamps,
 *   random values, request ids), or the deduplication guarantee is lost.
 */
export function notificationId(eventKey: string): string {
  const digest = createHash('sha256').update(NAMESPACE + eventKey).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));

  // RFC 4122: version 5 (name-based, SHA-1 family slot) + IETF variant.
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
