import { NotFoundException } from '@nestjs/common';

import { UsersService } from './users.service';

/**
 * Phase 2C.10 — player verification status. Real state only: email/phone flags + latest KYC record.
 * No enforcement/compliance is claimed; a missing KYC record reports `available:false` truthfully.
 */
function makeService(user: unknown, kyc: unknown) {
  const prisma = {
    user: { findFirst: jest.fn().mockResolvedValue(user) },
    kycVerification: { findFirst: jest.fn().mockResolvedValue(kyc) },
  };
  return new UsersService(prisma as never);
}

describe('UsersService.verification', () => {
  it('surfaces email/phone flags and a present KYC record', async () => {
    const svc = makeService(
      { emailVerified: true, phoneVerified: false, phoneNumber: '+911234567890' },
      { status: 'PENDING', level: 'BASIC', submittedAt: new Date(), reviewedAt: null },
    );
    const v = await svc.verification('u1');
    expect(v.email.verified).toBe(true);
    expect(v.phone).toEqual({ hasPhone: true, verified: false });
    expect(v.identity).toMatchObject({ available: true, status: 'PENDING', level: 'BASIC' });
  });

  it('reports identity NOT_STARTED / unavailable when no KYC record exists', async () => {
    const svc = makeService({ emailVerified: false, phoneVerified: false, phoneNumber: null }, null);
    const v = await svc.verification('u1');
    expect(v.phone.hasPhone).toBe(false);
    expect(v.identity).toMatchObject({ available: false, status: 'NOT_STARTED', level: null });
  });

  it('throws when the user does not exist', async () => {
    const svc = makeService(null, null);
    await expect(svc.verification('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
