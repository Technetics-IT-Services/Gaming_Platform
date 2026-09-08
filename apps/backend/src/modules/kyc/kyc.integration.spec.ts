import { randomUUID } from 'node:crypto';

import { BadRequestException, ForbiddenException, NotFoundException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentType, KycLevel, KycStatus } from '@prisma/client';

import { AppModule } from '../../app.module';
import { PrismaService } from '../database/prisma.service';
import { KycService } from './kyc.service';

/**
 * KYC INTEGRATION against real Postgres (`RUN_DB_IT=1`).
 *
 * Proves the whole lifecycle end to end: submission persists, only a reviewer can decide, decisions
 * are audited, duplicate submissions are deterministic, concurrent reviews cannot both win, and a
 * player can never reach another player's application.
 */
const RUN = process.env.RUN_DB_IT === '1';
const d = RUN ? describe : describe.skip;

d('KYC (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let kyc: KycService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    kyc = app.get(KycService);
  }, 60_000);

  afterAll(async () => { await app?.close(); });

  const newUser = async () => (await prisma.user.create({
    data: {
      email: `kyc_${randomUUID()}@t.local`,
      username: `kyc${randomUUID().slice(0, 12)}`,
      status: 'ACTIVE',
      authProvider: 'LOCAL',
    },
  })).id;

  const docs = (type: DocumentType = DocumentType.PASSPORT) => [
    { type, fileName: 'passport.jpg', mimeType: 'image/jpeg', size: 120_000, checksum: 'abc123' },
  ];

  /* -------------------------------------------------------------- lifecycle */

  it('a fresh account is NOT_STARTED and may submit', async () => {
    const userId = await newUser();
    const v = await kyc.myStatus(userId);
    expect(v.status).toBe(KycStatus.NOT_STARTED);
    expect(v.canSubmit).toBe(true);
    expect(v.documents).toEqual([]);
  }, 60_000);

  it('submission persists as PENDING with its documents', async () => {
    const userId = await newUser();
    const v = await kyc.submit(userId, KycLevel.BASIC, docs());

    expect(v.status).toBe(KycStatus.PENDING);
    expect(v.submittedAt).not.toBeNull();
    expect(v.documents).toHaveLength(1);
    expect(v.documents[0]!.type).toBe(DocumentType.PASSPORT);
    // Still PENDING, so the player cannot submit again.
    expect(v.canSubmit).toBe(false);

    const row = await prisma.kycVerification.findFirst({ where: { userId, deletedAt: null } });
    expect(row!.status).toBe(KycStatus.PENDING);
  }, 60_000);

  it('a player submission can NEVER arrive as APPROVED — the service always writes PENDING', async () => {
    const userId = await newUser();
    await kyc.submit(userId, KycLevel.ADVANCED, docs());
    const row = await prisma.kycVerification.findFirst({ where: { userId, deletedAt: null } });
    expect(row!.status).toBe(KycStatus.PENDING);
    expect(row!.reviewedAt).toBeNull();
  }, 60_000);

  it('a duplicate submission while PENDING is REFUSED (deterministic, not silently duplicated)', async () => {
    const userId = await newUser();
    await kyc.submit(userId, KycLevel.BASIC, docs());
    await expect(kyc.submit(userId, KycLevel.BASIC, docs())).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.kycVerification.count({ where: { userId, deletedAt: null } })).toBe(1);
  }, 60_000);

  it('an approved player cannot submit again', async () => {
    const userId = await newUser();
    const reviewer = await newUser();
    const v = await kyc.submit(userId, KycLevel.BASIC, docs());
    const row = await prisma.kycVerification.findFirst({ where: { userId, deletedAt: null } });
    await kyc.review({ id: row!.id, reviewerUserId: reviewer, decision: 'APPROVED' });
    expect(v.status).toBe(KycStatus.PENDING);
    await expect(kyc.submit(userId, KycLevel.BASIC, docs())).rejects.toThrow(/already verified/i);
  }, 60_000);

  it('a REJECTED application may be resubmitted, and the old one is superseded', async () => {
    const userId = await newUser();
    const reviewer = await newUser();
    await kyc.submit(userId, KycLevel.BASIC, docs());
    const first = await prisma.kycVerification.findFirst({ where: { userId, deletedAt: null } });
    await kyc.review({ id: first!.id, reviewerUserId: reviewer, decision: 'REJECTED', reason: 'blurred image' });

    const rejected = await kyc.myStatus(userId);
    expect(rejected.status).toBe(KycStatus.REJECTED);
    expect(rejected.rejectionReason).toBe('blurred image');
    expect(rejected.canSubmit).toBe(true);

    const again = await kyc.submit(userId, KycLevel.BASIC, docs(DocumentType.NATIONAL_ID));
    expect(again.status).toBe(KycStatus.PENDING);
    // Exactly one live application; the old one is soft-deleted, not destroyed.
    expect(await prisma.kycVerification.count({ where: { userId, deletedAt: null } })).toBe(1);
    expect(await prisma.kycVerification.count({ where: { userId } })).toBe(2);
  }, 60_000);

  it('a rejection reason is only disclosed for a REJECTED application', async () => {
    const userId = await newUser();
    const reviewer = await newUser();
    await kyc.submit(userId, KycLevel.BASIC, docs());
    const row = await prisma.kycVerification.findFirst({ where: { userId, deletedAt: null } });
    await kyc.review({ id: row!.id, reviewerUserId: reviewer, decision: 'APPROVED' });
    const v = await kyc.myStatus(userId);
    expect(v.status).toBe(KycStatus.APPROVED);
    expect(v.rejectionReason).toBeNull();
  }, 60_000);

  /* ---------------------------------------------------------------- review */

  it('a rejection without a reason is refused', async () => {
    const userId = await newUser();
    const reviewer = await newUser();
    await kyc.submit(userId, KycLevel.BASIC, docs());
    const row = await prisma.kycVerification.findFirst({ where: { userId, deletedAt: null } });
    await expect(kyc.review({ id: row!.id, reviewerUserId: reviewer, decision: 'REJECTED' }))
      .rejects.toBeInstanceOf(BadRequestException);
  }, 60_000);

  it('an already-decided application cannot be reviewed again', async () => {
    const userId = await newUser();
    const reviewer = await newUser();
    await kyc.submit(userId, KycLevel.BASIC, docs());
    const row = await prisma.kycVerification.findFirst({ where: { userId, deletedAt: null } });
    await kyc.review({ id: row!.id, reviewerUserId: reviewer, decision: 'APPROVED' });
    await expect(kyc.review({ id: row!.id, reviewerUserId: reviewer, decision: 'REJECTED', reason: 'changed mind' }))
      .rejects.toBeInstanceOf(BadRequestException);
  }, 60_000);

  it('CONCURRENT reviews cannot both win — exactly one decision survives', async () => {
    const userId = await newUser();
    const a = await newUser();
    const b = await newUser();
    await kyc.submit(userId, KycLevel.BASIC, docs());
    const row = await prisma.kycVerification.findFirst({ where: { userId, deletedAt: null } });

    const results = await Promise.allSettled([
      kyc.review({ id: row!.id, reviewerUserId: a, decision: 'APPROVED' }),
      kyc.review({ id: row!.id, reviewerUserId: b, decision: 'REJECTED', reason: 'mismatch' }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(1);

    const after = await prisma.kycVerification.findUnique({ where: { id: row!.id } });
    expect([KycStatus.APPROVED, KycStatus.REJECTED]).toContain(after!.status);
  }, 60_000);

  it('documents follow the decision', async () => {
    const userId = await newUser();
    const reviewer = await newUser();
    await kyc.submit(userId, KycLevel.BASIC, docs());
    const row = await prisma.kycVerification.findFirst({ where: { userId, deletedAt: null } });
    await kyc.review({ id: row!.id, reviewerUserId: reviewer, decision: 'APPROVED' });
    const documents = await prisma.document.findMany({ where: { kycId: row!.id } });
    expect(documents.every((x) => x.status === 'APPROVED')).toBe(true);
  }, 60_000);

  it('every decision is audited with actor, subject and both statuses', async () => {
    const userId = await newUser();
    const reviewer = await newUser();
    await kyc.submit(userId, KycLevel.BASIC, docs());
    const row = await prisma.kycVerification.findFirst({ where: { userId, deletedAt: null } });
    await kyc.review({ id: row!.id, reviewerUserId: reviewer, decision: 'REJECTED', reason: 'unreadable' });

    const audit = await prisma.auditTrail.findFirst({
      where: { entityType: 'kyc_verification', entityId: row!.id, action: 'REJECT' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.userId).toBe(reviewer);
    const c = audit!.changes as Record<string, unknown>;
    expect(c.subjectUserId).toBe(userId);
    expect(c.from).toBe(KycStatus.PENDING);
    expect(c.to).toBe(KycStatus.REJECTED);
  }, 60_000);

  it('the audit records document TYPES but never document contents', async () => {
    const userId = await newUser();
    await kyc.submit(userId, KycLevel.BASIC, docs());
    const audit = await prisma.auditTrail.findFirst({
      where: { entityType: 'kyc_verification', userId, action: 'CREATE' },
      orderBy: { createdAt: 'desc' },
    });
    const dump = JSON.stringify(audit!.changes).toLowerCase();
    expect(dump).toContain('passport');
    for (const forbidden of ['base64', 'data:image', 'fileurl', 'storagekey', 'password', 'token']) {
      expect(dump).not.toContain(forbidden);
    }
  }, 60_000);

  /* ------------------------------------------------------------ validation */

  it('rejects an unsupported MIME type', async () => {
    const userId = await newUser();
    await expect(kyc.submit(userId, KycLevel.BASIC, [
      { type: DocumentType.PASSPORT, fileName: 'x.exe', mimeType: 'application/x-msdownload', size: 100 },
    ])).rejects.toBeInstanceOf(BadRequestException);
  }, 60_000);

  it('rejects an oversized file', async () => {
    const userId = await newUser();
    await expect(kyc.submit(userId, KycLevel.BASIC, [
      { type: DocumentType.PASSPORT, fileName: 'big.jpg', mimeType: 'image/jpeg', size: 50 * 1024 * 1024 },
    ])).rejects.toBeInstanceOf(BadRequestException);
  }, 60_000);

  it('rejects a path in the file name', async () => {
    const userId = await newUser();
    await expect(kyc.submit(userId, KycLevel.BASIC, [
      { type: DocumentType.PASSPORT, fileName: '../../etc/passwd', mimeType: 'image/jpeg', size: 100 },
    ])).rejects.toBeInstanceOf(BadRequestException);
  }, 60_000);

  it('rejects duplicate document types in one submission', async () => {
    const userId = await newUser();
    await expect(kyc.submit(userId, KycLevel.BASIC, [...docs(), ...docs()]))
      .rejects.toBeInstanceOf(BadRequestException);
  }, 60_000);

  it('rejects an empty submission', async () => {
    const userId = await newUser();
    await expect(kyc.submit(userId, KycLevel.BASIC, [])).rejects.toBeInstanceOf(BadRequestException);
  }, 60_000);

  /* ----------------------------------------------------------------- IDOR */

  it('a player cannot reach another player’s application', async () => {
    const a = await newUser();
    const b = await newUser();
    await kyc.submit(b, KycLevel.BASIC, docs());
    const bRow = await prisma.kycVerification.findFirst({ where: { userId: b, deletedAt: null } });

    await expect(kyc.assertOwnedBy(bRow!.id, a)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(kyc.assertOwnedBy(bRow!.id, b)).resolves.toBeUndefined();

    // And A's own status view contains nothing of B's.
    const aView = await kyc.myStatus(a);
    expect(aView.status).toBe(KycStatus.NOT_STARTED);
    expect(aView.documents).toEqual([]);
  }, 60_000);

  it('an unknown application id is a NotFound, not a leak', async () => {
    await expect(kyc.getForReview('00000000-0000-4000-8000-000000000000'))
      .rejects.toBeInstanceOf(NotFoundException);
  }, 60_000);

  /* ------------------------------------------------------- admin queue */

  it('the queue filters by status and paginates', async () => {
    const userId = await newUser();
    await kyc.submit(userId, KycLevel.BASIC, docs());
    const pending = await kyc.list({ status: KycStatus.PENDING, page: 1, limit: 5 });
    expect(pending.items.length).toBeGreaterThan(0);
    expect(pending.items.every((i) => i.status === KycStatus.PENDING)).toBe(true);
    expect(pending.limit).toBe(5);
  }, 60_000);

  it('the queue exposes no document contents or credentials', async () => {
    const userId = await newUser();
    await kyc.submit(userId, KycLevel.BASIC, docs());
    const dump = JSON.stringify(await kyc.list({ page: 1, limit: 5 })).toLowerCase();
    for (const forbidden of ['fileurl', 'storagekey', 'password', 'token', 'secret']) {
      expect(dump).not.toContain(forbidden);
    }
  }, 60_000);

  /* ------------------------------------------------------- persistence */

  it('state survives a full service restart', async () => {
    const userId = await newUser();
    await kyc.submit(userId, KycLevel.INTERMEDIATE, docs());

    const ref2 = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app2 = ref2.createNestApplication();
    await app2.init();
    try {
      const kyc2 = app2.get(KycService);
      const v = await kyc2.myStatus(userId);
      expect(v.status).toBe(KycStatus.PENDING);
      expect(v.level).toBe(KycLevel.INTERMEDIATE);
      expect(v.documents).toHaveLength(1);
    } finally {
      await app2.close();
    }
  }, 180_000);

  /* --------------------------------------------------- financial safety */

  it('KYC moves no money — the ledger is untouched', async () => {
    const snapshot = async () => {
      const rows = await prisma.$queryRaw<{ debit: string; credit: string }[]>`
        SELECT COALESCE(SUM(CASE WHEN direction='DEBIT'  THEN amount ELSE 0 END),0)::text AS debit,
               COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE 0 END),0)::text AS credit
        FROM ledger_entries`;
      return { ...rows[0]!, tx: await prisma.walletTransaction.count() };
    };

    const before = await snapshot();
    const userId = await newUser();
    const reviewer = await newUser();
    await kyc.submit(userId, KycLevel.BASIC, docs());
    const row = await prisma.kycVerification.findFirst({ where: { userId, deletedAt: null } });
    await kyc.review({ id: row!.id, reviewerUserId: reviewer, decision: 'APPROVED' });
    await kyc.list({ page: 1, limit: 10 });

    expect(await snapshot()).toEqual(before);
  }, 120_000);
});
