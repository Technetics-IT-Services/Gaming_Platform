import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ActivityType, Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';

/**
 * Platform activity events (X-02).
 *
 * WHY THIS EXISTS: `page_views`, `player_sessions` and `user_activities` have existed in the schema
 * since the beginning with **zero writers**, which is exactly why DAU, MAU, retention and session
 * metrics were reported as NOT AVAILABLE. This is the missing writer.
 *
 * DURABLE, NOT IN-MEMORY. Events are rows in `user_activities`, so they survive a restart. An
 * `EventEmitter` would lose every event on restart and could never back a DAU figure.
 *
 * **NO SCHEMA CHANGE.** `UserActivity` already has `userId`, `type`, `metadata`, `ipAddress` and
 * `occurredAt`, indexed on `(userId, occurredAt)` and `(type, occurredAt)` — precisely the shape a
 * distinct-user-per-day query needs.
 *
 * IDEMPOTENCY: the same technique Phase 2D.1 used for notifications — the PRIMARY KEY is derived
 * deterministically from the event key, so a duplicate is rejected by Postgres rather than by an
 * in-memory guard. Two concurrent emitters cannot both win, and it survives a restart.
 *
 * NEVER FABRICATED: no historical backfill is performed. Only events that genuinely occur after this
 * module is deployed are recorded, so any metric derived from them is honest about its start date.
 */

const NAMESPACE = 'gaming-platform:activity-event:v1:';

/**
 * Keys that must never reach `metadata`.
 *
 * Events are long-lived, widely-read rows; a credential written here would outlive the request that
 * produced it. Stripping is by key name, recursively, and is applied to EVERY event.
 */
const FORBIDDEN_METADATA_KEYS = [
  'password', 'passwordhash', 'hash', 'token', 'accesstoken', 'refreshtoken', 'jwt',
  'secret', 'totp', 'otp', 'backupcode', 'serverseed', 'seed', 'authorization',
  'apikey', 'credential', 'card', 'cvv', 'pan', 'iban', 'ssn',
];

export interface ActivityEventInput {
  userId: string;
  type: ActivityType;
  /**
   * A key that permanently identifies this domain event, e.g. `game:round:<roundId>`.
   * It must contain nothing volatile, or the deduplication guarantee is lost.
   */
  eventKey: string;
  description?: string;
  ipAddress?: string | null;
  metadata?: Record<string, unknown>;
}

/** Deterministic RFC-4122 id from an event key. Identical input ⇒ identical id, forever. */
export function activityEventId(eventKey: string): string {
  const digest = createHash('sha256').update(NAMESPACE + eventKey).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // IETF variant
  const hex = bytes.toString('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join('-');
}

/** Recursively drop anything credential-shaped. Applied to every event, without exception. */
export function sanitiseMetadata(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => sanitiseMetadata(v, depth + 1));
  if (typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const flat = k.toLowerCase().replace(/[^a-z]/g, '');
    if (FORBIDDEN_METADATA_KEYS.some((f) => flat.includes(f))) continue;
    out[k] = sanitiseMetadata(v, depth + 1);
  }
  return out;
}

@Injectable()
export class ActivityEventService {
  private readonly logger = new Logger(ActivityEventService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record one activity event.
   *
   * **Never throws.** An analytics event must not be able to fail a login, a deposit or a game
   * round — the business action is the important thing, and a lost metric row is strictly less bad
   * than a failed payment. A duplicate (same event key) is silently ignored, which is the correct
   * outcome for an idempotent emit.
   */
  async record(input: ActivityEventInput): Promise<void> {
    try {
      await this.prisma.userActivity.create({
        data: {
          id: activityEventId(input.eventKey),
          userId: input.userId,
          type: input.type,
          description: input.description ?? null,
          ipAddress: input.ipAddress ?? null,
          metadata: (input.metadata
            ? (sanitiseMetadata(input.metadata) as Prisma.InputJsonValue)
            : undefined),
        },
      });
    } catch (error) {
      // P2002 = unique violation on the derived primary key: the same event already recorded.
      // That is the idempotency guarantee working, not a failure.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
      this.logger.warn(
        `activity event not recorded (${input.type}): ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  /**
   * The earliest recorded event.
   *
   * Analytics uses this to state honestly when activity data BEGINS, so a DAU figure for a period
   * before collection started is never presented as a real zero.
   */
  async collectionStartedAt(): Promise<Date | null> {
    const first = await this.prisma.userActivity.findFirst({
      orderBy: { occurredAt: 'asc' },
      select: { occurredAt: true },
    });
    return first?.occurredAt ?? null;
  }
}
