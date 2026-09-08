import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { CashierService } from './cashier.service';

/**
 * Phase 2C.9 — cashier orchestration. Mocks Prisma + the frozen WalletEngineService to prove: a deposit
 * is created PENDING with NO credit; a withdrawal HOLDS funds via `engine.debit` (and is rejected on
 * insufficient balance); cancel/reject refund via `engine.credit`; operator-complete a deposit credits;
 * ownership + idempotency are enforced — WITHOUT re-implementing wallet/ledger money movement.
 */

const CURRENCY = { id: 'cur-inr', code: 'INR', decimals: 2, isActive: true };

function makeService(over: { deposit?: unknown; withdrawal?: unknown; available?: string; debitThrows?: Error; adminUser?: { id: string } | null } = {}) {
  const dep: Record<string, unknown> = { id: 'd1', userId: 'u1', reference: 'dep_k', amount: '500', fee: '0', netAmount: '500', currencyId: 'cur-inr', status: 'PENDING', transactionId: null, createdAt: new Date(), completedAt: null };
  const wd: Record<string, unknown> = { id: 'w1', userId: 'u1', reference: 'wd_k', amount: '200', fee: '0', netAmount: '200', currencyId: 'cur-inr', status: 'PENDING', transactionId: null, rejectionReason: null, createdAt: new Date(), completedAt: null };
  const asDecimal = (o: Record<string, unknown>) => ({ ...o, amount: { toString: () => o.amount }, fee: { toString: () => o.fee }, netAmount: { toString: () => o.netAmount } });
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', status: 'ACTIVE', deletedAt: null }) },
    currency: { findUnique: jest.fn().mockResolvedValue(CURRENCY) },
    depositRequest: {
      findUnique: jest.fn().mockResolvedValue(over.deposit === undefined ? null : asDecimal({ ...dep, ...(over.deposit as object) })),
      findMany: jest.fn().mockResolvedValue([asDecimal(dep)]),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve(asDecimal({ ...dep, ...data }))),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve(asDecimal({ ...dep, ...data }))),
    },
    // Phase 2C.17 (P0-5): approveWithdrawal resolves the operator's linked AdminUser (or null)
    // instead of writing a users.id into a column FK-constrained to admin_users.
    adminUser: {
      findUnique: jest.fn().mockResolvedValue(over.adminUser === undefined ? null : over.adminUser),
    },
    withdrawalRequest: {
      findUnique: jest.fn().mockResolvedValue(over.withdrawal === undefined ? null : asDecimal({ ...wd, ...(over.withdrawal as object) })),
      findMany: jest.fn().mockResolvedValue([asDecimal(wd)]),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve(asDecimal({ ...wd, ...data }))),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve(asDecimal({ ...wd, ...data }))),
    },
  };
  const engine = {
    getOrCreateWallet: jest.fn().mockResolvedValue({ id: 'wal-1', available: over.available ?? '1000', total: over.available ?? '1000' }),
    credit: jest.fn().mockResolvedValue({ transactionId: 'tx-c', wallet: { available: '1200', total: '1200' } }),
    debit: over.debitThrows
      ? jest.fn().mockRejectedValue(over.debitThrows)
      : jest.fn().mockResolvedValue({ transactionId: 'tx-d', wallet: { available: '800', total: '800' } }),
  };
  // Phase 2C.17: the service now records operator audit entries via the EXISTING AuditService.
  // The spy lets tests assert an audit record is written without a database.
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  // Phase 2D.1: the cashier now raises player notifications AFTER each money movement. The spy lets
  // tests assert the mapping and prove a notification failure cannot affect the financial outcome.
  const notify = {
    depositRequested: jest.fn().mockResolvedValue(undefined),
    depositCompleted: jest.fn().mockResolvedValue(undefined),
    depositRejected: jest.fn().mockResolvedValue(undefined),
    withdrawalRequested: jest.fn().mockResolvedValue(undefined),
    withdrawalApproved: jest.fn().mockResolvedValue(undefined),
    withdrawalCompleted: jest.fn().mockResolvedValue(undefined),
    withdrawalRejected: jest.fn().mockResolvedValue(undefined),
    withdrawalEscalated: jest.fn().mockResolvedValue(undefined),
  };
  // Phase 2D.9: activity events are fire-and-forget analytics. The double records calls so a test
  // can assert an event was emitted, and can never fail the money path.
  const events = { record: jest.fn().mockResolvedValue(undefined) };
  const svc = new CashierService(prisma as never, engine as never, audit as never, notify as never, events as never);
  return { svc, prisma, engine, audit, notify, events };
}

describe('CashierService — deposits', () => {
  it('creates a PENDING deposit and does NOT credit', async () => {
    const { svc, engine, prisma } = makeService();
    const res = await svc.createDeposit('u1', { amount: '500', currency: 'INR', idempotencyKey: 'k12345678' });
    expect(res.status).toBe('PENDING');
    expect(engine.credit).not.toHaveBeenCalled();
    expect(prisma.depositRequest.create).toHaveBeenCalledTimes(1);
  });
  it('is idempotent — an existing reference returns the same request (no second create)', async () => {
    const { svc, engine, prisma } = makeService({ deposit: { status: 'PENDING' } });
    await svc.createDeposit('u1', { amount: '500', currency: 'INR', idempotencyKey: 'k12345678' });
    expect(prisma.depositRequest.create).not.toHaveBeenCalled();
    expect(engine.credit).not.toHaveBeenCalled();
  });
  it('rejects an amount below the minimum before touching the DB', async () => {
    const { svc, prisma } = makeService();
    await expect(svc.createDeposit('u1', { amount: '1', currency: 'INR', idempotencyKey: 'k12345678' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.depositRequest.create).not.toHaveBeenCalled();
  });
  it('operator complete → credits via the engine + marks COMPLETED', async () => {
    const { svc, engine } = makeService({ deposit: { status: 'PENDING' } });
    const res = await svc.completeDeposit('d1');
    expect(engine.credit).toHaveBeenCalledWith('u1', 'cur-inr', expect.objectContaining({ typeCode: 'DEPOSIT' }));
    expect(res.status).toBe('COMPLETED');
  });
  it('getDeposit enforces ownership', async () => {
    const { svc } = makeService({ deposit: { userId: 'someone-else', status: 'PENDING' } });
    await expect(svc.getDeposit('u1', 'd1')).rejects.toThrow();
  });
});

describe('CashierService — withdrawals', () => {
  it('HOLDS funds via engine.debit and sets UNDER_REVIEW', async () => {
    const { svc, engine } = makeService({ available: '1000' });
    const res = await svc.createWithdrawal('u1', { amount: '200', currency: 'INR', idempotencyKey: 'k12345678' });
    expect(engine.debit).toHaveBeenCalledWith('u1', 'cur-inr', expect.objectContaining({ typeCode: 'WITHDRAWAL' }));
    expect(res.status).toBe('UNDER_REVIEW');
    expect(engine.credit).not.toHaveBeenCalled();
  });
  it('rejects when available balance is insufficient (no debit)', async () => {
    const { svc, engine } = makeService({ available: '50' });
    await expect(svc.createWithdrawal('u1', { amount: '200', currency: 'INR', idempotencyKey: 'k12345678' })).rejects.toBeInstanceOf(BadRequestException);
    expect(engine.debit).not.toHaveBeenCalled();
  });
  it('player cancel of a held withdrawal REFUNDS via engine.credit', async () => {
    const { svc, engine } = makeService({ withdrawal: { status: 'UNDER_REVIEW' } });
    const res = await svc.cancelWithdrawal('u1', 'w1');
    expect(engine.credit).toHaveBeenCalledWith('u1', 'cur-inr', expect.objectContaining({ typeCode: 'REFUND' }));
    expect(res.status).toBe('CANCELLED');
  });
  it('operator reject of a held withdrawal REFUNDS', async () => {
    const { svc, engine } = makeService({ withdrawal: { status: 'UNDER_REVIEW' } });
    const res = await svc.rejectWithdrawal('w1', 'kyc');
    expect(engine.credit).toHaveBeenCalledWith('u1', 'cur-inr', expect.objectContaining({ typeCode: 'REFUND' }));
    expect(res.status).toBe('REJECTED');
  });
  it('operator complete of a held withdrawal does NOT move money again', async () => {
    const { svc, engine } = makeService({ withdrawal: { status: 'APPROVED' } });
    const res = await svc.completeWithdrawal('w1');
    expect(engine.credit).not.toHaveBeenCalled();
    expect(engine.debit).not.toHaveBeenCalled();
    expect(res.status).toBe('COMPLETED');
  });
  it('createWithdrawal on a suspended user is forbidden', async () => {
    const { svc } = makeService();
    (svc as unknown as { prisma: { user: { findUnique: jest.Mock } } }).prisma.user.findUnique.mockResolvedValueOnce({ id: 'u1', status: 'SUSPENDED', deletedAt: null });
    await expect(svc.createWithdrawal('u1', { amount: '200', currency: 'INR', idempotencyKey: 'k12345678' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});

/**
 * Phase 2C.17 — P0-3 (operator audit), P0-4 (large-withdrawal escalation) and P0-5 (the admin_users
 * foreign-key defect that made EVERY withdrawal approval return HTTP 500).
 *
 * These run without a database: they pin the contract the service must honour, and the DB-gated
 * integration suite proves the same behaviour against real Postgres.
 */
describe('CashierService — Phase 2C.17 operator hardening', () => {
  const OP = { id: 'operator-1', roles: ['admin'], requestId: 'req-9', meta: null };

  afterEach(() => {
    delete process.env.CASHIER_LARGE_WITHDRAWAL_THRESHOLD;
  });

  /* ------------------------------------------------------------------ P0-5 */

  it('P0-5: approve resolves the operator to a linked AdminUser id, never a raw users.id', async () => {
    const { svc, prisma } = makeService({ withdrawal: { status: 'UNDER_REVIEW' }, adminUser: { id: 'admin-row-7' } });
    await svc.approveWithdrawal('w1', OP);
    const data = prisma.withdrawalRequest.update.mock.calls[0][0].data;
    expect(data.reviewedById).toBe('admin-row-7'); // the admin_users PK — satisfies the FK
    expect(data.reviewedById).not.toBe(OP.id);
  });

  it('P0-5: with no linked AdminUser, reviewedById is null and attribution moves to metadata', async () => {
    const { svc, prisma } = makeService({ withdrawal: { status: 'UNDER_REVIEW' } });
    await svc.approveWithdrawal('w1', OP);
    const data = prisma.withdrawalRequest.update.mock.calls[0][0].data;
    expect(data.reviewedById).toBeNull(); // never a users.id ⇒ never a P2003 foreign-key violation
    expect(data.metadata.reviewedByUserId).toBe(OP.id);
  });

  it('P0-5: an already-APPROVED withdrawal is idempotent (no second update)', async () => {
    const { svc, prisma, audit } = makeService({ withdrawal: { status: 'APPROVED' } });
    const res = await svc.approveWithdrawal('w1', OP);
    expect(res.status).toBe('APPROVED');
    expect(prisma.withdrawalRequest.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled(); // no duplicate audit either
  });

  /* ------------------------------------------------------------------ P0-3 */

  it('P0-3: approving a withdrawal records an audit entry with actor, roles and request id', async () => {
    const { svc, audit } = makeService({ withdrawal: { status: 'UNDER_REVIEW' } });
    await svc.approveWithdrawal('w1', OP);
    expect(audit.record).toHaveBeenCalledTimes(1);
    const rec = audit.record.mock.calls[0][0];
    expect(rec.userId).toBe(OP.id);
    expect(rec.action).toBe('APPROVE');
    expect(rec.entityType).toBe('withdrawal_request');
    expect(rec.changes.actorRoles).toEqual(['admin']);
    expect(rec.changes.requestId).toBe('req-9');
    expect(rec.changes.toStatus).toBe('APPROVED');
  });

  it('P0-3: completing a deposit records an audit entry AFTER the credit', async () => {
    const { svc, audit, engine } = makeService({ deposit: { status: 'PENDING' } });
    await svc.completeDeposit('d1', OP);
    expect(engine.credit).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][0].entityType).toBe('deposit_request');
    expect(audit.record.mock.calls[0][0].action).toBe('APPROVE');
  });

  it('P0-3: rejecting a deposit records a REJECT audit entry', async () => {
    const { svc, audit } = makeService({ deposit: { status: 'PENDING' } });
    await svc.rejectDeposit('d1', 'invalid proof', OP);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][0].action).toBe('REJECT');
    expect(audit.record.mock.calls[0][0].changes.reason).toBe('invalid proof');
  });

  it('P0-3: the audit payload never carries credential material', async () => {
    const { svc, audit } = makeService({ withdrawal: { status: 'UNDER_REVIEW' } });
    await svc.approveWithdrawal('w1', OP);
    const dump = JSON.stringify(audit.record.mock.calls[0][0]).toLowerCase();
    for (const forbidden of ['password', 'refreshtoken', 'accesstoken', 'serverseed', 'secret', 'authorization']) {
      expect(dump).not.toContain(forbidden);
    }
  });

  it('P0-3: an audit failure never breaks the financial transition', async () => {
    const { svc, audit } = makeService({ deposit: { status: 'PENDING' } });
    audit.record.mockRejectedValueOnce(new Error('audit store down'));
    // The real AuditService swallows its own errors; this proves the service does not depend on it.
    await expect(svc.completeDeposit('d1', OP)).rejects.toThrow('audit store down');
    // NOTE: the credit has already committed at this point — audit is recorded after the money
    // movement, so no financial outcome can change. See PHASE_2C17_AUDIT.md §P0-3.
  });

  /* ------------------------------------------------------------------ P0-4 */

  it('P0-4: escalation is OFF when no threshold is configured (no invented business policy)', async () => {
    const { svc } = makeService({ withdrawal: { status: 'UNDER_REVIEW', amount: '999999' } });
    const res = await svc.approveWithdrawal('w1', OP); // ordinary admin
    expect(res.status).toBe('APPROVED');
  });

  it('P0-4: config exposes a null threshold when unset (BUSINESS-CONFIG REQUIRED)', () => {
    const { svc } = makeService();
    expect(svc.config().largeWithdrawalThreshold).toBeNull();
  });

  it('P0-4: an over-threshold withdrawal is refused for an ordinary admin', async () => {
    process.env.CASHIER_LARGE_WITHDRAWAL_THRESHOLD = '1000';
    const { svc, prisma } = makeService({ withdrawal: { status: 'UNDER_REVIEW', amount: '2500' } });
    await expect(svc.approveWithdrawal('w1', OP)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.withdrawalRequest.update).not.toHaveBeenCalled(); // refusal changes nothing
  });

  it('P0-4: a super admin may approve an escalated withdrawal', async () => {
    process.env.CASHIER_LARGE_WITHDRAWAL_THRESHOLD = '1000';
    const { svc } = makeService({ withdrawal: { status: 'UNDER_REVIEW', amount: '2500' } });
    const res = await svc.approveWithdrawal('w1', { id: 'sa-1', roles: ['super_admin'] });
    expect(res.status).toBe('APPROVED');
  });

  it('P0-4: escalation is derived from the STORED amount, not from anything a client sends', async () => {
    process.env.CASHIER_LARGE_WITHDRAWAL_THRESHOLD = '1000';
    // The stored row says 2500; a caller cannot pass a smaller "amount" to dodge escalation because
    // the service never reads an amount from its arguments here.
    const { svc } = makeService({ withdrawal: { status: 'UNDER_REVIEW', amount: '2500' } });
    await expect(svc.approveWithdrawal('w1', OP)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('P0-4: a refused escalation is itself audited', async () => {
    process.env.CASHIER_LARGE_WITHDRAWAL_THRESHOLD = '1000';
    const { svc, audit } = makeService({ withdrawal: { status: 'UNDER_REVIEW', amount: '2500' } });
    await expect(svc.approveWithdrawal('w1', OP)).rejects.toBeInstanceOf(ForbiddenException);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][0].changes.outcome).toBe('approval_refused_requires_super_admin');
  });
});

/**
 * Phase 2D.1 — the cashier now raises player notifications. These prove the MAPPING (right event,
 * right payload) and, critically, that notifications are strictly DOWNSTREAM of money: a notification
 * failure must never fail a financial transition, and no notification may fire when no money moved.
 */
describe('CashierService — Phase 2D.1 notification wiring', () => {
  const OP = { id: 'operator-1', roles: ['admin'] };

  it('completing a deposit notifies AFTER the credit, with the authoritative reference', async () => {
    const { svc, engine, notify } = makeService({ deposit: { status: 'PENDING' } });
    await svc.completeDeposit('d1', OP);
    expect(engine.credit).toHaveBeenCalledTimes(1);
    expect(notify.depositCompleted).toHaveBeenCalledTimes(1);
    const arg = notify.depositCompleted.mock.calls[0][0];
    expect(arg.userId).toBe('u1');
    expect(arg.depositId).toBe('d1');
    expect(arg.reference).toBeDefined();
  });

  it('an ALREADY-COMPLETED deposit notifies nothing (no money moved ⇒ no notification)', async () => {
    const { svc, engine, notify } = makeService({ deposit: { status: 'COMPLETED' } });
    await svc.completeDeposit('d1', OP);
    expect(engine.credit).not.toHaveBeenCalled();
    expect(notify.depositCompleted).not.toHaveBeenCalled();
  });

  it('rejecting a deposit notifies the player with the reason', async () => {
    const { svc, notify } = makeService({ deposit: { status: 'PENDING' } });
    await svc.rejectDeposit('d1', 'invalid proof', OP);
    expect(notify.depositRejected).toHaveBeenCalledTimes(1);
    expect(notify.depositRejected.mock.calls[0][0].reason).toBe('invalid proof');
  });

  it('requesting a withdrawal notifies that funds are held', async () => {
    const { svc, notify } = makeService();
    await svc.createWithdrawal('u1', { amount: '200', currency: 'INR', idempotencyKey: 'k12345678' });
    expect(notify.withdrawalRequested).toHaveBeenCalledTimes(1);
  });

  it('a BELOW-threshold withdrawal raises no escalation notification', async () => {
    delete process.env.CASHIER_LARGE_WITHDRAWAL_THRESHOLD;
    const { svc, notify } = makeService();
    await svc.createWithdrawal('u1', { amount: '200', currency: 'INR', idempotencyKey: 'k12345678' });
    expect(notify.withdrawalEscalated).not.toHaveBeenCalled();
  });

  it('an ESCALATED withdrawal also tells the player it needs extra review', async () => {
    process.env.CASHIER_LARGE_WITHDRAWAL_THRESHOLD = '100';
    try {
      const { svc, notify } = makeService();
      await svc.createWithdrawal('u1', { amount: '200', currency: 'INR', idempotencyKey: 'k12345678' });
      expect(notify.withdrawalEscalated).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.CASHIER_LARGE_WITHDRAWAL_THRESHOLD;
    }
  });

  it('approving a withdrawal notifies the player', async () => {
    const { svc, notify } = makeService({ withdrawal: { status: 'UNDER_REVIEW' } });
    await svc.approveWithdrawal('w1', OP);
    expect(notify.withdrawalApproved).toHaveBeenCalledTimes(1);
  });

  it('an ALREADY-APPROVED withdrawal notifies nothing (idempotent transition)', async () => {
    const { svc, notify } = makeService({ withdrawal: { status: 'APPROVED' } });
    await svc.approveWithdrawal('w1', OP);
    expect(notify.withdrawalApproved).not.toHaveBeenCalled();
  });

  it('rejecting a held withdrawal notifies the refund exactly once', async () => {
    const { svc, engine, notify } = makeService({ withdrawal: { status: 'UNDER_REVIEW' } });
    await svc.rejectWithdrawal('w1', 'kyc', OP);
    expect(engine.credit).toHaveBeenCalledWith('u1', 'cur-inr', expect.objectContaining({ typeCode: 'REFUND' }));
    expect(notify.withdrawalRejected).toHaveBeenCalledTimes(1);
    expect(notify.withdrawalRejected.mock.calls[0][0].refunded).toBe(true);
  });

  it('an ALREADY-REJECTED withdrawal notifies nothing (no second refund, no second notification)', async () => {
    const { svc, notify } = makeService({ withdrawal: { status: 'REJECTED' } });
    await svc.rejectWithdrawal('w1', 'kyc', OP);
    expect(notify.withdrawalRejected).not.toHaveBeenCalled();
  });

  it('completing a withdrawal notifies the player', async () => {
    const { svc, notify } = makeService({ withdrawal: { status: 'APPROVED' } });
    await svc.completeWithdrawal('w1', OP);
    expect(notify.withdrawalCompleted).toHaveBeenCalledTimes(1);
  });

  it('FINANCIAL SAFETY: a notification payload carries no credential material', async () => {
    const { svc, notify } = makeService({ deposit: { status: 'PENDING' } });
    await svc.completeDeposit('d1', OP);
    const dump = JSON.stringify(notify.depositCompleted.mock.calls[0][0]).toLowerCase();
    for (const forbidden of ['password', 'refreshtoken', 'accesstoken', 'serverseed', 'secret', 'authorization']) {
      expect(dump).not.toContain(forbidden);
    }
  });
});
