import { randomUUID } from 'node:crypto';

import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { authenticator } from 'otplib';

import { AppModule } from '../../app.module';
import { AuthService } from '../auth/auth.service';
import { SessionService } from '../auth/services/session.service';
import { TwoFactorService } from '../auth/services/two-factor.service';
import { RbacService } from '../authorization/rbac.service';
import { PrismaService } from '../database/prisma.service';

/**
 * Phase 2D.2 — security hardening INTEGRATION against real Postgres + Redis (`RUN_DB_IT=1`).
 *
 * Real application graph, real services. Proves the three deliverables end-to-end:
 *   B. the five closed audit gaps genuinely produce durable records
 *   C. admin 2FA is real (real TOTP, real challenge, wrong/replayed codes rejected)
 *   D. idle-session expiry actually revokes server-side
 *
 * and that none of it leaks a secret.
 */
const RUN = process.env.RUN_DB_IT === '1';
const d = RUN ? describe : describe.skip;

const META = {
  ipAddress: '203.0.113.7',
  userAgent: 'jest-integration',
  fingerprint: 'fp',
  fingerprintHint: null,
  countryCode: null,
  city: null,
};

d('Security hardening (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  let sessions: SessionService;
  let twoFactor: TwoFactorService;
  let rbac: RbacService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    auth = app.get(AuthService);
    sessions = app.get(SessionService);
    twoFactor = app.get(TwoFactorService);
    rbac = app.get(RbacService);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  const PW = 'Str0ng!Passw0rd1';

  async function player(): Promise<{ id: string; email: string }> {
    const email = `sec_${randomUUID()}@t.local`;
    const res = await auth.register(
      { email, username: `s${randomUUID().slice(0, 12)}`, password: PW } as never,
      META as never,
    );
    await prisma.user.update({ where: { id: res.user.id }, data: { status: 'ACTIVE' } });
    return { id: res.user.id, email };
  }

  const auditFor = (userId: string, entityType: string) =>
    prisma.auditTrail.findMany({ where: { userId, entityType } });
  const eventsFor = (userId: string, type: string) =>
    prisma.securityEvent.findMany({ where: { userId, type: type as never } });

  /* ------------------------------------------- Phase B: closed audit gaps */

  it('GAP 14/15: enabling then disabling 2FA is recorded in BOTH audit stores', async () => {
    const u = await player();
    const setup = await twoFactor.generateSetup(u.id, u.email);

    await twoFactor.enable(u.id, authenticator.generate(setup.secret), META as never);
    expect(await eventsFor(u.id, 'MFA_ENABLED')).toHaveLength(1);
    expect(await auditFor(u.id, 'two_factor')).toHaveLength(1);

    await twoFactor.disable(u.id, authenticator.generate(setup.secret), META as never);
    expect(await eventsFor(u.id, 'MFA_DISABLED')).toHaveLength(1);
    expect(await auditFor(u.id, 'two_factor')).toHaveLength(2);
  }, 60_000);

  it('GAP 14/15: the 2FA audit record never contains the secret or a recovery code', async () => {
    const u = await player();
    const setup = await twoFactor.generateSetup(u.id, u.email);
    const { recoveryCodes } = await twoFactor.enable(u.id, authenticator.generate(setup.secret), META as never);

    const rows = await auditFor(u.id, 'two_factor');
    const events = await eventsFor(u.id, 'MFA_ENABLED');
    const dump = JSON.stringify([...rows, ...events]);

    expect(dump).not.toContain(setup.secret);
    for (const code of recoveryCodes) expect(dump).not.toContain(code);
    expect(dump.toLowerCase()).not.toContain('password');
  }, 60_000);

  it('GAP 16: bulk session revocation is recorded (it previously produced nothing)', async () => {
    const u = await player();
    await auth.login({ email: u.email, password: PW } as never, META as never);
    await auth.login({ email: u.email, password: PW } as never, META as never);

    const before = (await auditFor(u.id, 'sessions')).length;
    const res = await sessions.revokeAll(u.id, undefined, META as never);

    expect(res.revoked).toBeGreaterThan(0);
    expect((await auditFor(u.id, 'sessions')).length).toBe(before + 1);
    const rec = (await auditFor(u.id, 'sessions')).at(-1)!;
    expect((rec.changes as Record<string, unknown>).revoked).toBe(res.revoked);
    expect(rec.ipAddress).toBe(META.ipAddress);
  }, 60_000);

  it('GAP 16: revoking nothing records nothing (no noise)', async () => {
    const u = await player();
    // `register()` establishes a session, so clear it first; the SECOND call is the true no-op.
    await sessions.revokeAll(u.id, undefined, META as never);

    const before = (await auditFor(u.id, 'sessions')).length;
    const res = await sessions.revokeAll(u.id, undefined, META as never);
    expect(res.revoked).toBe(0);
    expect((await auditFor(u.id, 'sessions')).length).toBe(before);
  }, 30_000);

  it('GAP 17: a PLAYER login writes no admin_session audit record', async () => {
    const u = await player();
    await auth.login({ email: u.email, password: PW } as never, META as never);
    expect(await auditFor(u.id, 'admin_session')).toHaveLength(0);
  }, 30_000);

  it('GAP 17: a PRIVILEGED login is audited distinctly, with roles and no credential', async () => {
    const u = await player();
    const adminRole = await prisma.role.findFirst({ where: { slug: 'admin' } });
    await prisma.userRole.create({ data: { userId: u.id, roleId: adminRole!.id } });
    // RbacService caches resolved authz; the production role-assignment path invalidates it, so a
    // direct insert must do the same or the login would still see the stale player roles.
    await rbac.invalidate(u.id);

    await auth.login({ email: u.email, password: PW } as never, META as never);

    const rows = await auditFor(u.id, 'admin_session');
    expect(rows).toHaveLength(1);
    const changes = rows[0]!.changes as Record<string, unknown>;
    expect(changes.roles).toEqual(expect.arrayContaining(['admin']));
    expect(rows[0]!.ipAddress).toBe(META.ipAddress);
    expect(JSON.stringify(rows[0]).toLowerCase()).not.toContain('password');
  }, 60_000);

  /* ---------------------------------------- Phase C: admin 2FA is genuine */

  it('2FA: a correct TOTP completes the challenge; a wrong code is rejected', async () => {
    const u = await player();
    const setup = await twoFactor.generateSetup(u.id, u.email);
    await twoFactor.enable(u.id, authenticator.generate(setup.secret), META as never);

    const login = await auth.login({ email: u.email, password: PW } as never, META as never);
    expect(login.requiresTwoFactor).toBe(true);
    expect(login.challengeToken).toBeDefined();
    expect((login as { session?: unknown }).session).toBeUndefined(); // no session before the 2nd factor

    await expect(auth.verifyTwoFactor(login.challengeToken!, '000000', META as never))
      .rejects.toBeInstanceOf(UnauthorizedException);

    const session = await auth.verifyTwoFactor(
      login.challengeToken!,
      authenticator.generate(setup.secret),
      META as never,
    );
    expect(session.tokens.accessToken).toBeDefined();
  }, 60_000);

  it('2FA: a challenge token is SINGLE-USE (replay is rejected)', async () => {
    const u = await player();
    const setup = await twoFactor.generateSetup(u.id, u.email);
    await twoFactor.enable(u.id, authenticator.generate(setup.secret), META as never);

    const login = await auth.login({ email: u.email, password: PW } as never, META as never);
    await auth.verifyTwoFactor(login.challengeToken!, authenticator.generate(setup.secret), META as never);

    // Replaying the same challenge token must fail — it was deleted on success.
    await expect(
      auth.verifyTwoFactor(login.challengeToken!, authenticator.generate(setup.secret), META as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  }, 60_000);

  it('2FA: recovery codes are stored only as digests, never in plaintext', async () => {
    const u = await player();
    const setup = await twoFactor.generateSetup(u.id, u.email);
    const { recoveryCodes } = await twoFactor.enable(u.id, authenticator.generate(setup.secret), META as never);

    const rows = await prisma.twoFactorAuth.findMany({ where: { userId: u.id } });
    const stored = JSON.stringify(rows.map((r) => r.backupCodes));
    for (const code of recoveryCodes) expect(stored).not.toContain(code);
    expect(rows.some((r) => r.backupCodes.length === recoveryCodes.length)).toBe(true);
  }, 60_000);

  it('2FA: a recovery code works once and is then consumed', async () => {
    const u = await player();
    const setup = await twoFactor.generateSetup(u.id, u.email);
    const { recoveryCodes } = await twoFactor.enable(u.id, authenticator.generate(setup.secret), META as never);

    expect(await twoFactor.verifyCode(u.id, recoveryCodes[0]!)).toBe(true);
    expect(await twoFactor.verifyCode(u.id, recoveryCodes[0]!)).toBe(false); // single-use
  }, 60_000);

  /* ------------------------------- Phase D: idle expiry revokes for real */

  it('IDLE: disabled by default — an ancient session still refreshes', async () => {
    const u = await player();
    const login = await auth.login({ email: u.email, password: PW } as never, META as never);
    const sessionId = (login as { session: { user: unknown } }).session ? undefined : undefined;
    void sessionId;

    const s = await prisma.session.findFirst({ where: { userId: u.id }, orderBy: { createdAt: 'desc' } });
    await prisma.session.update({
      where: { id: s!.id },
      data: { lastActivityAt: new Date(Date.now() - 365 * 24 * 60 * 60_000) },
    });

    const refreshed = await sessions.rotate(
      (login as { session: { tokens: { refreshToken: string } } }).session.tokens.refreshToken,
      META as never,
    );
    expect(refreshed.tokens.accessToken).toBeDefined(); // unchanged behaviour with the timeout unset
  }, 60_000);

  it('IDLE: when configured, an idle session is REFUSED and REVOKED server-side', async () => {
    const u = await player();
    const login = await auth.login({ email: u.email, password: PW } as never, META as never);
    const refreshToken = (login as { session: { tokens: { refreshToken: string } } }).session.tokens.refreshToken;

    const s = await prisma.session.findFirst({ where: { userId: u.id }, orderBy: { createdAt: 'desc' } });
    await prisma.session.update({
      where: { id: s!.id },
      data: { lastActivityAt: new Date(Date.now() - 120 * 60_000) }, // 2 hours idle
    });

    const svc = sessions as unknown as { config: { security: { sessionIdleTimeoutMinutes: number } } };
    const original = svc.config.security.sessionIdleTimeoutMinutes;
    svc.config.security.sessionIdleTimeoutMinutes = 30;
    try {
      await expect(sessions.rotate(refreshToken, META as never)).rejects.toBeInstanceOf(UnauthorizedException);

      // Refused is not enough — the session must be REVOKED, which is what makes it a real control.
      const after = await prisma.session.findUnique({ where: { id: s!.id } });
      expect(after!.status).toBe('REVOKED');

      // And a second attempt cannot resurrect it.
      await expect(sessions.rotate(refreshToken, META as never)).rejects.toBeInstanceOf(UnauthorizedException);
    } finally {
      svc.config.security.sessionIdleTimeoutMinutes = original;
    }
  }, 60_000);

  it('IDLE: an ACTIVE session inside the window is unaffected', async () => {
    const u = await player();
    const login = await auth.login({ email: u.email, password: PW } as never, META as never);
    const refreshToken = (login as { session: { tokens: { refreshToken: string } } }).session.tokens.refreshToken;

    const svc = sessions as unknown as { config: { security: { sessionIdleTimeoutMinutes: number } } };
    const original = svc.config.security.sessionIdleTimeoutMinutes;
    svc.config.security.sessionIdleTimeoutMinutes = 30;
    try {
      const rotated = await sessions.rotate(refreshToken, META as never);
      expect(rotated.tokens.accessToken).toBeDefined();
    } finally {
      svc.config.security.sessionIdleTimeoutMinutes = original;
    }
  }, 60_000);

  /* ------------------------------------------- unchanged core guarantees */

  it('refresh rotation + reuse detection still burn the family', async () => {
    const u = await player();
    const login = await auth.login({ email: u.email, password: PW } as never, META as never);
    const first = (login as { session: { tokens: { refreshToken: string } } }).session.tokens.refreshToken;

    const rotated = await sessions.rotate(first, META as never);
    expect(rotated.tokens.refreshToken).not.toBe(first);

    // Replaying the ORIGINAL token is reuse → the whole family is revoked.
    await expect(sessions.rotate(first, META as never)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(sessions.rotate(rotated.tokens.refreshToken, META as never)).rejects.toBeInstanceOf(UnauthorizedException);
  }, 60_000);
});
