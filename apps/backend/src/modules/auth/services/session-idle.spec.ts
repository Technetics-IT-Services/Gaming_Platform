import { UnauthorizedException } from '@nestjs/common';

import { SessionService } from './session.service';

/**
 * Phase 2D.2 — server-authoritative idle-session expiry.
 *
 * `assertNotIdle` is a private method on `SessionService`, so it is exercised through the instance
 * rather than mocked away: these tests build the service with stub collaborators and drive the exact
 * decision the refresh path makes. The DB-gated integration suite proves the same behaviour end-to-end
 * through a real `rotate()`.
 *
 * The properties that matter:
 *   - DISABLED by default (no invented timeout value);
 *   - when enabled, an idle session is REVOKED server-side, not merely refused;
 *   - an active session is never affected;
 *   - the revocation is recorded.
 */

type Idle = { assertNotIdle: (sessionId: string, userId: string, meta: unknown) => Promise<void> };

function make(minutes: number, lastActivityAt: Date | null) {
  const revoked: string[] = [];
  const events: Record<string, unknown>[] = [];
  const prisma = {
    session: { findUnique: jest.fn().mockResolvedValue(lastActivityAt === null ? null : { lastActivityAt }) },
  };
  const security = { record: jest.fn().mockImplementation((e: Record<string, unknown>) => { events.push(e); }) };
  const config = { security: { sessionIdleTimeoutMinutes: minutes } };

  // Build a minimal object carrying the real method under test, without invoking the constructor
  // (which would require the full Nest dependency graph).
  const svc = Object.create(SessionService.prototype) as Idle & Record<string, unknown>;
  Object.assign(svc, {
    prisma,
    config,
    security,
    revokeSessionInternal: jest.fn().mockImplementation((id: string) => { revoked.push(id); }),
  });
  return { svc, revoked, events, prisma, security };
}

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

describe('idle-session expiry', () => {
  it('is DISABLED by default (0) — no session is ever expired, no lookup performed', async () => {
    const { svc, revoked, prisma } = make(0, minutesAgo(60 * 24 * 365));
    await expect(svc.assertNotIdle('s1', 'u1', {})).resolves.toBeUndefined();
    expect(revoked).toEqual([]);
    expect(prisma.session.findUnique).not.toHaveBeenCalled();
  });

  it('a session INSIDE the window passes untouched', async () => {
    const { svc, revoked } = make(30, minutesAgo(5));
    await expect(svc.assertNotIdle('s1', 'u1', {})).resolves.toBeUndefined();
    expect(revoked).toEqual([]);
  });

  it('a session at exactly the boundary still passes (no off-by-one lockout)', async () => {
    const { svc, revoked } = make(30, new Date(Date.now() - 30 * 60_000 + 1_000));
    await expect(svc.assertNotIdle('s1', 'u1', {})).resolves.toBeUndefined();
    expect(revoked).toEqual([]);
  });

  it('a session BEYOND the window is refused AND revoked server-side', async () => {
    const { svc, revoked } = make(30, minutesAgo(31));
    await expect(svc.assertNotIdle('s1', 'u1', {})).rejects.toBeInstanceOf(UnauthorizedException);
    // Server-side revocation is what makes this a real control rather than a client-side timer.
    expect(revoked).toEqual(['s1']);
  });

  it('the expiry is recorded with the idle duration and the limit', async () => {
    const { svc, events } = make(15, minutesAgo(90));
    await expect(svc.assertNotIdle('s1', 'u1', {})).rejects.toBeInstanceOf(UnauthorizedException);
    expect(events).toHaveLength(1);
    expect(events[0]!.userId).toBe('u1');
    expect(String(events[0]!.description)).toMatch(/idle/i);
    expect(String(events[0]!.description)).toContain('15');
  });

  it('a session with no recorded activity is not expired', async () => {
    const { svc, revoked } = make(30, null);
    await expect(svc.assertNotIdle('s1', 'u1', {})).resolves.toBeUndefined();
    expect(revoked).toEqual([]);
  });

  it('the expiry payload carries no token, hash or credential', async () => {
    const { svc, events } = make(15, minutesAgo(90));
    await expect(svc.assertNotIdle('s1', 'u1', {})).rejects.toBeInstanceOf(UnauthorizedException);
    const dump = JSON.stringify(events).toLowerCase();
    for (const forbidden of ['token', 'hash', 'secret', 'password']) {
      expect(dump).not.toContain(forbidden);
    }
  });
});
