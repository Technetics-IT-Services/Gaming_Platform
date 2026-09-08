import { randomUUID } from 'node:crypto';

import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../app.module';
import { TokenService } from '../auth/services/token.service';
import { BonusAdminService } from '../bonus-admin/bonus-admin.service';
import { PrismaService } from '../database/prisma.service';

/**
 * Phase 2D.11 — PERMANENT REGRESSION GUARD for the `grant-bonus` authorization defect.
 *
 * THE DEFECT (reproduced live on 2026-09-07, now fixed):
 *   `POST /wallet-engine/grant-bonus` carried no permission guard and granted a bonus to
 *   `@CurrentUser('id')` — the caller — using a CLIENT-SUPPLIED amount and wagering requirement.
 *   A brand-new `user`-role account created ₹1,000,000 of withdrawable balance in two calls:
 *       POST /wallet-engine/grant-bonus { amount: "1000000", wageringRequirement: "0" }  → 200
 *       POST /wallet-engine/bonus/<id>/convert                                            → 200
 *
 * WHY A TEST AND NOT JUST THE FIX: the route was deleted, and a deletion is exactly the kind of
 * change a later merge can silently undo. This spec replays the ORIGINAL ATTACK SHAPE at the HTTP
 * layer, so the hole cannot reopen without a red test.
 *
 * AUTHENTICATION IS REAL HERE. Rather than stubbing the guards, each request carries a genuinely
 * signed access token, so the FULL production guard chain runs — JwtAuthGuard, RolesGuard,
 * PermissionsGuard and AdminTwoFactorGuard. A stubbed guard would have proved only that the code
 * under it works, not that the chain protecting it does.
 */
const RUN = process.env.RUN_DB_IT === '1';
const d = RUN ? describe : describe.skip;

d('Phase 2D.11 — grant-bonus authorization regression (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let bonuses: BonusAdminService;
  let http: ReturnType<typeof request>;

  let tokens: TokenService;

  let playerId: string;
  let operatorId: string;
  let victimId: string;
  let playerToken: string;
  let operatorToken: string;
  let financeToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    // The SAME pipe configuration as production — `forbidNonWhitelisted` is part of the defence.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
    bonuses = app.get(BonusAdminService);
    tokens = app.get(TokenService);
    http = request(app.getHttpServer());

    playerId = await newUser();
    // `twoFactorEnabled` is set because AdminTwoFactorGuard reads it fresh from the database for
    // elevated roles. This spec tests PERMISSIONS; 2FA has its own dedicated suite.
    operatorId = await newUser({ twoFactorEnabled: true });
    victimId = await newUser();

    playerToken = await sign(playerId, ['user'], []);
    operatorToken = await sign(operatorId, ['super_admin'], ['wallets:adjust', 'wallets:read']);
    financeToken = await sign(operatorId, ['finance'], ['transactions:read', 'wallets:read', 'analytics:read']);
  }, 60_000);

  afterAll(async () => { await app?.close(); });

  async function newUser(extra: Record<string, unknown> = {}): Promise<string> {
    return (await prisma.user.create({
      data: {
        email: `p11_${randomUUID()}@t.local`,
        username: `p11${randomUUID().slice(0, 12)}`,
        status: 'ACTIVE',
        authProvider: 'LOCAL',
        referralCode: `RG${randomUUID().slice(0, 10).toUpperCase().replace(/-/g, '')}`,
        ...extra,
      },
    })).id;
  }

  /**
   * A real access token, minted by the SAME `TokenService` production uses — so issuer, audience,
   * secret and claim shape are correct by construction rather than by my guesswork. No `sid` is
   * passed, so the strategy's session-liveness check is skipped: this spec is about route
   * authorization, not session lifecycle, which has its own suite.
   */
  async function sign(sub: string, roles: string[], permissions: string[]): Promise<string> {
    const { token } = await tokens.signAccessToken({
      sub,
      email: `${sub}@t.local`,
      username: sub.slice(0, 8),
      role: roles[0] as never,
      roles,
      permissions,
      // `sid` is omitted at RUNTIME on purpose. `JwtStrategy` guards its session-liveness check
      // with `if (payload.sid && ...)`, so a token without one is a shape it explicitly supports —
      // and a synthetic id would be rejected as an unknown session, which is a different test.
      // The cast is only to satisfy the claims type, which marks `sid` required.
    } as unknown as Parameters<TokenService['signAccessToken']>[0]);
    return token;
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const inrId = async () =>
    (await prisma.currency.findUniqueOrThrow({ where: { code: 'INR' }, select: { id: true } })).id;

  const ledgerCount = () => prisma.ledgerEntry.count();
  const ledgerDifference = async (): Promise<string> => {
    const rows = await prisma.$queryRaw<{ d: unknown }[]>`
      SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE -amount END), 0) AS d
      FROM ledger_entries`;
    return String(rows[0]?.d ?? '0');
  };

  /* ================================================ THE ORIGINAL ATTACK */

  it('THE EXPLOIT: a player replaying the original attack shape is refused', async () => {
    const res = await http
      .post('/api/v1/wallet-engine/grant-bonus')
      .set(auth(playerToken))
      .send({ currencyId: await inrId(), amount: '1000000', wageringRequirement: '0' });

    // 404 — the route no longer exists. Anything in the 2xx range is the defect, reopened.
    expect(res.status).toBe(404);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('the route is gone for EVERY principal, including a super-admin', async () => {
    const res = await http
      .post('/api/v1/wallet-engine/grant-bonus')
      .set(auth(operatorToken))
      .send({ currencyId: await inrId(), amount: '10', wageringRequirement: '0' });
    // Not a permission failure — the entry point itself was removed, so no principal can reach it.
    expect(res.status).toBe(404);
  });

  it('the attack creates no bonus wallet and no ledger movement', async () => {
    const bonusesBefore = await prisma.bonusWallet.count({ where: { userId: playerId } });
    const entriesBefore = await ledgerCount();

    await http
      .post('/api/v1/wallet-engine/grant-bonus')
      .set(auth(playerToken))
      .send({ currencyId: await inrId(), amount: '1000000', wageringRequirement: '0' });

    expect(await prisma.bonusWallet.count({ where: { userId: playerId } })).toBe(bonusesBefore);
    expect(await ledgerCount()).toBe(entriesBefore);
  });

  it('a player still cannot reach the OPERATOR bonus route either', async () => {
    const res = await http.post('/api/v1/admin/bonuses').set(auth(playerToken)).send({
      userId: playerId, currencyCode: 'INR', amount: '1000000',
      reference: `attack-${randomUUID()}`, reason: 'self-grant attempt',
    });
    // A player holds no `wallets:adjust`, so the guarded replacement refuses them.
    expect(res.status).toBe(403);
  });

  /* ============================== THE LEGITIMATE PATH IS UNHARMED */

  it('an authorized operator CAN still grant a bonus, to a NAMED player', async () => {
    const reference = `p11-ok-${randomUUID()}`;
    const res = await http.post('/api/v1/admin/bonuses').set(auth(operatorToken)).send({
      userId: victimId, currencyCode: 'INR', amount: '250', wageringRequirement: '500',
      reference, reason: 'regression spec — legitimate grant',
    });

    expect(res.status).toBe(200);
    const body = res.body.data ?? res.body;
    expect(body.userId).toBe(victimId);
    // The recipient is the NAMED player, never the acting operator.
    expect(body.userId).not.toBe(operatorId);
    expect(body.balance).toContain('250');
  });

  it('a legitimate grant produces EXACTLY ONE accounting movement — and it is not a ledger entry', async () => {
    const before = await ledgerCount();
    const reference = `p11-one-${randomUUID()}`;

    await http.post('/api/v1/admin/bonuses').set(auth(operatorToken)).send({
      userId: victimId, currencyCode: 'INR', amount: '75',
      reference, reason: 'single-movement check',
    });

    // A bonus is a promotional entitlement, not money: it becomes a ledger movement only on
    // conversion, and only once the wagering requirement is met.
    expect(await ledgerCount()).toBe(before);
    const granted = await prisma.bonusWallet.count({
      where: { userId: victimId, balance: { gte: 75, lt: 76 } },
    });
    expect(granted).toBe(1);
  });

  it('IDEMPOTENCY: replaying an authorized grant does not grant twice', async () => {
    const player = await newUser();
    const reference = `p11-idem-${randomUUID()}`;
    const body = {
      userId: player, currencyCode: 'INR', amount: '40',
      reference, reason: 'idempotency check',
    };

    const first = await http.post('/api/v1/admin/bonuses').set(auth(operatorToken)).send(body);
    const second = await http.post('/api/v1/admin/bonuses').set(auth(operatorToken)).send(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((second.body.data ?? second.body).id).toBe((first.body.data ?? first.body).id);
    expect(await prisma.bonusWallet.count({ where: { userId: player, deletedAt: null } })).toBe(1);
  });

  /* ========================================= ADJACENT ATTACK SHAPES */

  it('MASS ASSIGNMENT: server-owned fields are rejected outright', async () => {
    for (const extra of [
      { status: 'CLOSED' },
      { balance: '999999' },
      { wageringProgress: '999999' },
      { id: randomUUID() },
    ]) {
      const res = await http.post('/api/v1/admin/bonuses').set(auth(operatorToken)).send({
        userId: victimId, currencyCode: 'INR', amount: '5',
        reference: `p11-mass-${randomUUID()}`, reason: 'mass assignment', ...extra,
      });
      expect(`${Object.keys(extra)[0]}:${res.status}`).toBe(`${Object.keys(extra)[0]}:400`);
    }
  });

  it('IDOR: an operator cannot grant to a user id that does not exist', async () => {
    const res = await http.post('/api/v1/admin/bonuses').set(auth(operatorToken)).send({
      userId: randomUUID(), currencyCode: 'INR', amount: '5',
      reference: `p11-idor-${randomUUID()}`, reason: 'unknown recipient',
    });
    expect(res.status).toBe(404);
  });

  it('PRIVILEGE ESCALATION: holding an unrelated permission is not enough', async () => {
    // A principal with plenty of read authority but no `wallets:adjust`.
    const res = await http.post('/api/v1/admin/bonuses').set(auth(financeToken)).send({
      userId: victimId, currencyCode: 'INR', amount: '5',
      reference: `p11-esc-${randomUUID()}`, reason: 'escalation attempt',
    });
    expect(res.status).toBe(403);
  });

  it('the sibling wallet-engine routes were NOT collaterally removed', async () => {
    // The fix deleted one entry point; it must not have taken the player's own surfaces with it.
    expect((await http.get('/api/v1/wallet-engine/balances').set(auth(playerToken))).status).toBe(200);
    expect((await http.get('/api/v1/wallet-engine/bonus').set(auth(playerToken))).status).toBe(200);
  });

  it('convert still refuses a bonus whose wagering requirement is unmet', async () => {
    const player = await newUser();
    const granted = await bonuses.grant({
      userId: player, currencyCode: 'INR', amount: '100', wageringRequirement: '1000',
      reference: `p11-conv-${randomUUID()}`, reason: 'conversion guard', actorUserId: operatorId,
    });

    const res = await http
      .post(`/api/v1/wallet-engine/bonus/${granted.id}/convert`)
      .set(auth(await sign(player, ['user'], [])))
      .send({});
    expect(res.status).toBe(400);
  });

  /* ================================================= ACCOUNTING */

  it('the ledger is still exactly balanced after every attack above', async () => {
    expect(Number(await ledgerDifference())).toBe(0);
    const negatives = await prisma.walletBalance.count({
      where: { OR: [{ available: { lt: 0 } }, { pending: { lt: 0 } }, { total: { lt: 0 } }] },
    });
    expect(negatives).toBe(0);
  });
});
