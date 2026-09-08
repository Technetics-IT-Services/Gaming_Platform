import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@gaming-platform/database';
import { type User as PrismaUser, UserStatus } from '@prisma/client';
import { UserRole } from '@gaming-platform/types';

import { PrismaService } from '../database/prisma.service';
import type { UpdateProfileDto } from './dto/update-profile.dto';

export interface CreateUserInput {
  email: string;
  username: string;
  passwordHash: string;
}

export interface AuthUserView {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: UserRole;
  roles: string[];
  permissions: string[];
  status: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface VerificationStatus {
  email: { verified: boolean };
  phone: { hasPhone: boolean; verified: boolean };
  identity: { available: boolean; status: string; level: string | null; submittedAt: Date | null; reviewedAt: Date | null };
}

const withProfile = Prisma.validator<Prisma.UserDefaultArgs>()({
  include: { profile: true, avatar: true },
});
type UserWithProfile = Prisma.UserGetPayload<typeof withProfile>;

function generateReferralCode(): string {
  return randomBytes(5).toString('hex').toUpperCase();
}

/**
 * User persistence and profile management, backed by Prisma.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<PrismaUser | null> {
    return this.prisma.user.findFirst({ where: { id, deletedAt: null } });
  }

  /**
   * The authenticated user's verification status — REAL state only (email/phone flags on the user +
   * the latest KycVerification record). When no KYC record exists, `identity.available` is false so
   * the client can say so truthfully. No enforcement or compliance is claimed here.
   */
  async verification(userId: string): Promise<VerificationStatus> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { emailVerified: true, phoneVerified: true, phoneNumber: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const kyc = await this.prisma.kycVerification.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { status: true, level: true, submittedAt: true, reviewedAt: true },
    });
    return {
      email: { verified: user.emailVerified },
      phone: { hasPhone: !!user.phoneNumber, verified: user.phoneVerified },
      identity: kyc
        ? { available: true, status: kyc.status, level: kyc.level, submittedAt: kyc.submittedAt, reviewedAt: kyc.reviewedAt }
        : { available: false, status: 'NOT_STARTED', level: null, submittedAt: null, reviewedAt: null },
    };
  }

  findByEmail(email: string): Promise<PrismaUser | null> {
    return this.prisma.user.findFirst({ where: { email: email.toLowerCase(), deletedAt: null } });
  }

  findByUsername(username: string): Promise<PrismaUser | null> {
    return this.prisma.user.findFirst({ where: { username, deletedAt: null } });
  }

  findWithProfile(id: string): Promise<UserWithProfile | null> {
    return this.prisma.user.findFirst({ where: { id, deletedAt: null }, ...withProfile });
  }

  /** Create a user atomically with a profile and default preferences. */
  async create(input: CreateUserInput): Promise<UserWithProfile> {
    const email = input.email.toLowerCase();
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email }, { username: input.username }] },
      select: { email: true, username: true },
    });
    if (existing) {
      throw new ConflictException(
        existing.email === email ? 'Email is already registered' : 'Username is already taken',
      );
    }

    return this.prisma.user.create({
      data: {
        email,
        username: input.username,
        passwordHash: input.passwordHash,
        status: UserStatus.PENDING,
        referralCode: generateReferralCode(),
        profile: { create: { displayName: input.username } },
        preferences: { create: {} },
      },
      ...withProfile,
    });
  }

  async updateLastLogin(id: string, ip: string | null): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date(), lastLoginIp: ip },
    });
  }

  async updateProfile(id: string, dto: UpdateProfileDto): Promise<UserWithProfile> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.$transaction(async (tx) => {
      if (dto.displayName !== undefined) {
        await tx.userProfile.upsert({
          where: { userId: id },
          update: { displayName: dto.displayName },
          create: { userId: id, displayName: dto.displayName },
        });
      }
      if (dto.avatarUrl !== undefined) {
        await tx.avatar.upsert({
          where: { userId: id },
          update: { url: dto.avatarUrl },
          create: { userId: id, url: dto.avatarUrl },
        });
      }
    });

    return this.findWithProfile(id) as Promise<UserWithProfile>;
  }

  /** Map a persisted user (+authz) into the public auth view. */
  toAuthView(
    user: UserWithProfile,
    authz: { roles: string[]; permissions: string[]; primaryRole: UserRole },
  ): AuthUserView {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.profile?.displayName ?? null,
      avatarUrl: user.avatar?.url ?? null,
      role: authz.primaryRole,
      roles: authz.roles,
      permissions: authz.permissions,
      status: user.status,
      emailVerified: user.emailVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    };
  }
}
