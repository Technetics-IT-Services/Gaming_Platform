import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { AuditAction, SecurityEventType, SecuritySeverity, TwoFactorMethod } from '@prisma/client';
import type { TwoFactorSetup, TwoFactorStatus } from '@gaming-platform/types';
import { authenticator } from 'otplib';
import { toDataURL } from 'qrcode';

import { AppConfigService } from '../../../config/app-config.service';
import { generateRecoveryCodes, sha256 } from '../../../common/security/crypto.util';
import type { RequestMeta } from '../../../common/security/request-meta';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../security/audit.service';
import { SecurityEventService } from '../../security/security-event.service';

const RECOVERY_CODE_COUNT = 10;

/**
 * TOTP-based two-factor authentication with single-use recovery codes.
 * Recovery codes are stored only as SHA-256 digests and consumed on use.
 */
@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    // Phase 2D.2: enabling/disabling a second factor is a security-critical change. The
    // `MFA_ENABLED`/`MFA_DISABLED` event types already existed but had ZERO call sites, so these
    // changes were previously invisible in both audit stores. Recorded in BOTH, after the change
    // commits, and NEVER carrying the TOTP secret or any recovery code.
    private readonly security: SecurityEventService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Record a 2FA state change in both audit stores.
   *
   * Deliberately carries no secret material: `changes` holds only the method and the resulting state.
   * Non-blocking by the existing `AuditService` contract, and called only after the transaction has
   * committed, so it can never affect the security outcome.
   */
  private async recordMfaChange(
    userId: string,
    enabled: boolean,
    meta?: RequestMeta | null,
  ): Promise<void> {
    await this.security.record({
      userId,
      type: enabled ? SecurityEventType.MFA_ENABLED : SecurityEventType.MFA_DISABLED,
      severity: SecuritySeverity.HIGH,
      description: enabled
        ? 'Two-factor authentication enabled (TOTP)'
        : 'Two-factor authentication disabled',
      meta: meta ?? null,
    });
    await this.audit.record({
      userId,
      action: AuditAction.UPDATE,
      entityType: 'two_factor',
      entityId: userId,
      changes: { method: 'TOTP', enabled },
      meta: meta ?? null,
    });
  }

  /** Provision a new (not-yet-enabled) TOTP secret and return the QR payload. */
  async generateSetup(userId: string, accountLabel: string): Promise<TwoFactorSetup> {
    const existing = await this.prisma.twoFactorAuth.findUnique({
      where: { userId_method: { userId, method: TwoFactorMethod.TOTP } },
    });
    if (existing?.isEnabled) {
      throw new ConflictException('Two-factor authentication is already enabled');
    }

    const secret = authenticator.generateSecret();
    const issuer = this.config.security.twoFactorIssuer;
    const otpauthUrl = authenticator.keyuri(accountLabel, issuer, secret);

    await this.prisma.twoFactorAuth.upsert({
      where: { userId_method: { userId, method: TwoFactorMethod.TOTP } },
      update: { secret, isEnabled: false, verifiedAt: null },
      create: { userId, method: TwoFactorMethod.TOTP, secret, isEnabled: false },
    });

    const qrCodeDataUrl = await toDataURL(otpauthUrl);
    return { otpauthUrl, qrCodeDataUrl, secret };
  }

  /** Confirm the TOTP code, enable 2FA, and issue one-time recovery codes. */
  async enable(userId: string, code: string, meta?: RequestMeta | null): Promise<{ recoveryCodes: string[] }> {
    const totp = await this.prisma.twoFactorAuth.findUnique({
      where: { userId_method: { userId, method: TwoFactorMethod.TOTP } },
    });
    if (!totp?.secret) {
      throw new BadRequestException('Start two-factor setup first');
    }
    if (totp.isEnabled) {
      throw new ConflictException('Two-factor authentication is already enabled');
    }
    if (!authenticator.verify({ token: code, secret: totp.secret })) {
      throw new BadRequestException('Invalid verification code');
    }

    const recoveryCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
    const hashed = recoveryCodes.map((c) => sha256(c));

    await this.prisma.$transaction([
      this.prisma.twoFactorAuth.update({
        where: { userId_method: { userId, method: TwoFactorMethod.TOTP } },
        data: { isEnabled: true, verifiedAt: new Date() },
      }),
      this.prisma.twoFactorAuth.upsert({
        where: { userId_method: { userId, method: TwoFactorMethod.BACKUP_CODE } },
        update: { backupCodes: hashed, isEnabled: true, verifiedAt: new Date() },
        create: {
          userId,
          method: TwoFactorMethod.BACKUP_CODE,
          backupCodes: hashed,
          isEnabled: true,
          verifiedAt: new Date(),
        },
      }),
      this.prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } }),
    ]);

    await this.recordMfaChange(userId, true, meta);
    return { recoveryCodes };
  }

  /** Disable all 2FA methods after verifying a current code. */
  async disable(userId: string, code: string, meta?: RequestMeta | null): Promise<{ success: true }> {
    const valid = await this.verifyCode(userId, code);
    if (!valid) {
      throw new BadRequestException('Invalid verification code');
    }
    await this.prisma.$transaction([
      this.prisma.twoFactorAuth.deleteMany({ where: { userId } }),
      this.prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: false } }),
    ]);
    await this.recordMfaChange(userId, false, meta);
    return { success: true };
  }

  /** Verify a login-time TOTP code or consume a recovery code. */
  async verifyCode(userId: string, code: string): Promise<boolean> {
    const normalized = code.trim();
    const totp = await this.prisma.twoFactorAuth.findFirst({
      where: { userId, method: TwoFactorMethod.TOTP, isEnabled: true },
    });
    if (totp?.secret && authenticator.verify({ token: normalized, secret: totp.secret })) {
      return true;
    }
    return this.consumeRecoveryCode(userId, normalized);
  }

  async status(userId: string): Promise<TwoFactorStatus> {
    const methods = await this.prisma.twoFactorAuth.findMany({
      where: { userId, isEnabled: true },
    });
    const backup = methods.find((m) => m.method === TwoFactorMethod.BACKUP_CODE);
    return {
      enabled: methods.some((m) => m.method === TwoFactorMethod.TOTP),
      methods: methods.map((m) => m.method),
      recoveryCodesRemaining: backup?.backupCodes.length ?? 0,
    };
  }

  async regenerateRecoveryCodes(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    if (!(await this.verifyCode(userId, code))) {
      throw new BadRequestException('Invalid verification code');
    }
    const recoveryCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
    await this.prisma.twoFactorAuth.upsert({
      where: { userId_method: { userId, method: TwoFactorMethod.BACKUP_CODE } },
      update: { backupCodes: recoveryCodes.map((c) => sha256(c)), isEnabled: true },
      create: {
        userId,
        method: TwoFactorMethod.BACKUP_CODE,
        backupCodes: recoveryCodes.map((c) => sha256(c)),
        isEnabled: true,
      },
    });
    return { recoveryCodes };
  }

  async isEnabled(userId: string): Promise<boolean> {
    const totp = await this.prisma.twoFactorAuth.findFirst({
      where: { userId, method: TwoFactorMethod.TOTP, isEnabled: true },
      select: { id: true },
    });
    return Boolean(totp);
  }

  private async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    const backup = await this.prisma.twoFactorAuth.findFirst({
      where: { userId, method: TwoFactorMethod.BACKUP_CODE, isEnabled: true },
    });
    if (!backup) return false;

    const hash = sha256(code);
    if (!backup.backupCodes.includes(hash)) {
      return false;
    }
    await this.prisma.twoFactorAuth.update({
      where: { id: backup.id },
      data: { backupCodes: backup.backupCodes.filter((c) => c !== hash) },
    });
    return true;
  }
}
