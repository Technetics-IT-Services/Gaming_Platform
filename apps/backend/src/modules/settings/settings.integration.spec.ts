import { randomUUID } from 'node:crypto';

import { BadRequestException, ForbiddenException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../app.module';
import { PERMISSIONS } from '../authorization/rbac.constants';
import { PrismaService } from '../database/prisma.service';
import { SETTINGS_REGISTRY, SETTING_KEYS } from './settings.registry';
import { SettingsService } from './settings.service';

/**
 * Settings INTEGRATION against real Postgres (`RUN_DB_IT=1`).
 *
 * The property that matters most: the registry is an ALLOW-LIST, so no request can reach
 * game-variant, wallet, payout, settlement, responsible-gaming or session-security configuration
 * through this API — regardless of what it sends.
 */
const RUN = process.env.RUN_DB_IT === '1';
const d = RUN ? describe : describe.skip;

d('Settings (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let settings: SettingsService;
  let actor: string;

  const WRITE = [PERMISSIONS.SETTINGS_WRITE as string];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    settings = app.get(SettingsService);
    actor = (await prisma.user.create({
      data: {
        email: `set_${randomUUID()}@t.local`,
        username: `set${randomUUID().slice(0, 12)}`,
        status: 'ACTIVE',
        authProvider: 'LOCAL',
      },
    })).id;
  }, 60_000);

  afterAll(async () => { await app?.close(); });

  /* ------------------------------------------------------- the allow-list */

  it('an unknown key is REJECTED on read and on write', async () => {
    for (const bad of ['not.a.setting', 'dice-variant', 'wallet.payout']) {
      await expect(settings.get(bad)).rejects.toBeInstanceOf(BadRequestException);
      await expect(settings.set({ key: bad, value: 'x', actorUserId: actor, actorPermissions: WRITE }))
        .rejects.toBeInstanceOf(BadRequestException);
    }
  }, 60_000);

  it('MONEY and SAFETY configuration cannot be reached through this API', async () => {
    // Every one of these is either ApplicationSetting-backed game config, a financial limit, or a
    // compliance/security control. None is on the allow-list, so all are rejected.
    const forbidden = [
      'dice-variant', 'crash-variant', 'roulette-variant', 'card-variant',
      'wallet.limit', 'payout.rtp', 'settlement.mode',
      'RG_LIMIT_INCREASE_DELAY_HOURS', 'SESSION_IDLE_TIMEOUT_MINUTES',
      'CASHIER_LARGE_WITHDRAWAL_THRESHOLD',
    ];
    for (const key of forbidden) {
      await expect(settings.set({ key, value: '1', actorUserId: actor, actorPermissions: WRITE }))
        .rejects.toBeInstanceOf(BadRequestException);
    }
  }, 60_000);

  it('rejection happens BEFORE any row is written', async () => {
    const before = await prisma.systemSetting.count();
    await expect(settings.set({ key: 'dice-variant', value: 'x', actorUserId: actor, actorPermissions: WRITE }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.systemSetting.count()).toBe(before);
  }, 60_000);

  it('ApplicationSetting — which holds live game variant config — is never touched', async () => {
    const before = await prisma.applicationSetting.count();
    await settings.set({ key: 'platform.support_email', value: 'ops@example.test', actorUserId: actor, actorPermissions: WRITE });
    await settings.listAll();
    await settings.listPublic();
    expect(await prisma.applicationSetting.count()).toBe(before);
  }, 60_000);

  /* ------------------------------------------------------------ defaults */

  it('every registered setting resolves, using its default when unset', async () => {
    const all = await settings.listAll();
    expect(all).toHaveLength(SETTING_KEYS.length);
    for (const s of all) {
      expect(SETTING_KEYS).toContain(s.key);
      expect(s.value).not.toBeUndefined();
    }
  }, 60_000);

  it('isCustomised distinguishes a stored value from a default', async () => {
    await settings.reset('platform.support_phone', actor, WRITE);
    expect((await settings.get('platform.support_phone')).isCustomised).toBe(false);

    await settings.set({ key: 'platform.support_phone', value: '+44 20 7946 0000', actorUserId: actor, actorPermissions: WRITE });
    const after = await settings.get('platform.support_phone');
    expect(after.isCustomised).toBe(true);
    expect(after.value).toBe('+44 20 7946 0000');
  }, 60_000);

  /* ---------------------------------------------------------- validation */

  it('validates BOOLEAN, and refuses a non-boolean', async () => {
    await expect(settings.set({ key: 'platform.maintenance_banner_enabled', value: true, actorUserId: actor, actorPermissions: WRITE }))
      .resolves.toMatchObject({ value: true });
    await expect(settings.set({ key: 'platform.maintenance_banner_enabled', value: 'yes', actorUserId: actor, actorPermissions: WRITE }))
      .rejects.toBeInstanceOf(BadRequestException);
  }, 60_000);

  it('validates INTEGER bounds, and never silently coerces', async () => {
    const key = 'platform.support_response_hours';
    await expect(settings.set({ key, value: 48, actorUserId: actor, actorPermissions: WRITE }))
      .resolves.toMatchObject({ value: 48 });
    for (const bad of [0, 1000, 'abc', 1.5]) {
      await expect(settings.set({ key, value: bad, actorUserId: actor, actorPermissions: WRITE }))
        .rejects.toBeInstanceOf(BadRequestException);
    }
    // The refused values did not overwrite the good one.
    expect((await settings.get(key)).value).toBe(48);
  }, 60_000);

  it('enforces STRING maxLength', async () => {
    await expect(settings.set({
      key: 'platform.support_email', value: 'a'.repeat(500), actorUserId: actor, actorPermissions: WRITE,
    })).rejects.toBeInstanceOf(BadRequestException);
  }, 60_000);

  it('trims string values', async () => {
    const r = await settings.set({ key: 'platform.support_email', value: '  ops@example.test  ', actorUserId: actor, actorPermissions: WRITE });
    expect(r.value).toBe('ops@example.test');
  }, 60_000);

  /* ------------------------------------------------------- authorization */

  it('a caller WITHOUT settings:write is refused, even for an allow-listed key', async () => {
    await expect(settings.set({
      key: 'platform.support_email', value: 'x@y.test', actorUserId: actor, actorPermissions: ['settings:read'],
    })).rejects.toBeInstanceOf(ForbiddenException);

    await expect(settings.reset('platform.support_email', actor, ['settings:read']))
      .rejects.toBeInstanceOf(ForbiddenException);
  }, 60_000);

  it('the permission check happens even with an empty permission list', async () => {
    await expect(settings.set({ key: 'platform.support_email', value: 'x@y.test', actorUserId: actor, actorPermissions: [] }))
      .rejects.toBeInstanceOf(ForbiddenException);
  }, 60_000);

  /* -------------------------------------------------------------- public */

  it('the public subset is chosen from the REGISTRY, and exposes nothing sensitive', async () => {
    const pub = await settings.listPublic();
    for (const key of Object.keys(pub)) {
      expect(SETTINGS_REGISTRY[key]!.isPublic).toBe(true);
    }
    const dump = JSON.stringify(pub).toLowerCase();
    for (const forbidden of ['password', 'secret', 'token', 'key', 'credential', 'postgres', 'redis']) {
      expect(dump).not.toContain(forbidden);
    }
  }, 60_000);

  it('a non-public row could not leak even if one existed', async () => {
    // Write a row directly for a key that is NOT on the allow-list.
    await prisma.systemSetting.upsert({
      where: { key: 'sneaky.private_key' },
      update: { value: 'leak-me' as never, isPublic: true },
      create: { key: 'sneaky.private_key', value: 'leak-me' as never, isPublic: true },
    });
    const pub = await settings.listPublic();
    // listPublic iterates the REGISTRY, so a stray row is invisible.
    expect(JSON.stringify(pub)).not.toContain('leak-me');
    await prisma.systemSetting.delete({ where: { key: 'sneaky.private_key' } });
  }, 60_000);

  /* ---------------------------------------------------------------- audit */

  it('changes and resets are audited with before and after values', async () => {
    await settings.set({ key: 'platform.support_email', value: 'first@example.test', actorUserId: actor, actorPermissions: WRITE });
    await settings.set({ key: 'platform.support_email', value: 'second@example.test', actorUserId: actor, actorPermissions: WRITE });

    const audits = await prisma.auditTrail.findMany({
      where: { entityType: 'system_setting', entityId: 'platform.support_email' },
      orderBy: { createdAt: 'desc' }, take: 1,
    });
    expect(audits).toHaveLength(1);
    const c = audits[0]!.changes as Record<string, unknown>;
    expect(c.from).toBe('first@example.test');
    expect(c.to).toBe('second@example.test');
    expect(audits[0]!.userId).toBe(actor);
    // One audit store only.
    expect(await prisma.adminAuditLog.count()).toBe(0);
  }, 60_000);

  /* --------------------------------------------------- financial safety */

  it('settings move no money', async () => {
    const snapshot = async () => {
      const rows = await prisma.$queryRaw<{ debit: string; credit: string }[]>`
        SELECT COALESCE(SUM(CASE WHEN direction='DEBIT'  THEN amount ELSE 0 END),0)::text AS debit,
               COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE 0 END),0)::text AS credit
        FROM ledger_entries`;
      return { ...rows[0]!, tx: await prisma.walletTransaction.count() };
    };
    const before = await snapshot();
    await settings.set({ key: 'platform.maintenance_banner_enabled', value: true, actorUserId: actor, actorPermissions: WRITE });
    await settings.set({ key: 'platform.maintenance_banner_message', value: 'Scheduled maintenance', actorUserId: actor, actorPermissions: WRITE });
    await settings.reset('platform.maintenance_banner_enabled', actor, WRITE);
    expect(await snapshot()).toEqual(before);
  }, 60_000);

  /* ----------------------------------------------------------- persistence */

  it('a changed setting survives a full service restart', async () => {
    await settings.set({ key: 'platform.support_email', value: 'persisted@example.test', actorUserId: actor, actorPermissions: WRITE });

    const ref2 = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app2 = ref2.createNestApplication();
    await app2.init();
    try {
      const s2 = app2.get(SettingsService);
      expect((await s2.get('platform.support_email')).value).toBe('persisted@example.test');
    } finally {
      await app2.close();
    }
  }, 180_000);
});
