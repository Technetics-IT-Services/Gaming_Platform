import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditAction, SecurityEventType, SecuritySeverity, UserStatus } from '@prisma/client';
import type { AuthTokens } from '@gaming-platform/types';

import { generateToken } from '../../common/security/crypto.util';
import type { RequestMeta } from '../../common/security/request-meta';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RbacService } from '../authorization/rbac.service';
import { ROLE_SLUGS } from '../authorization/rbac.constants';
import { NotificationEventsService } from '../notifications/notification-events.service';
import { AuditService } from '../security/audit.service';
import { SecurityEventService } from '../security/security-event.service';
import { type AuthUserView, UsersService } from '../users/users.service';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import { AccountSecurityService } from './services/account-security.service';
import { DeviceService } from './services/device.service';
import { EmailVerificationService } from './services/email-verification.service';
import { PasswordService } from './services/password.service';
import { SessionService } from './services/session.service';
import { TokenService } from './services/token.service';
import { TwoFactorService } from './services/two-factor.service';

export interface SessionResponse {
  user: AuthUserView;
  tokens: AuthTokens;
}

export interface LoginResponse {
  requiresTwoFactor: boolean;
  challengeToken?: string;
  session?: SessionResponse;
}

interface TwoFactorChallenge {
  userId: string;
  deviceId: string | null;
  rememberMe: boolean;
}

const CHALLENGE_PREFIX = 'auth:2fa:';
const CHALLENGE_TTL_SECONDS = 300;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly devices: DeviceService,
    private readonly twoFactor: TwoFactorService,
    private readonly emailVerification: EmailVerificationService,
    private readonly accountSecurity: AccountSecurityService,
    private readonly rbac: RbacService,
    private readonly security: SecurityEventService,
    private readonly audit: AuditService,
    // Phase 2D.1: player-visible security notifications, raised after the change has committed.
    private readonly notify: NotificationEventsService,
  ) {}

  // ---- Registration --------------------------------------------------------

  async register(dto: RegisterDto, meta: RequestMeta): Promise<SessionResponse> {
    await this.passwords.assertAcceptable(dto.password, [dto.email, dto.username]);
    const passwordHash = await this.passwords.hash(dto.password);

    const user = await this.users.create({
      email: dto.email,
      username: dto.username,
      passwordHash,
    });

    await this.assignDefaultRole(user.id);
    await this.rbac.invalidate(user.id);
    await this.emailVerification.issue(user.id, user.email);

    await this.audit.record({
      userId: user.id,
      action: AuditAction.CREATE,
      entityType: 'user',
      entityId: user.id,
      meta,
    });

    const device = await this.devices.register(user.id, meta);
    return this.issueFor(user.id, meta, false, device.id);
  }

  // ---- Login ---------------------------------------------------------------

  async login(dto: LoginDto, meta: RequestMeta): Promise<LoginResponse> {
    const user = await this.users.findByEmail(dto.email);
    if (!user) {
      // Equalize timing — still run a bcrypt comparison against a dummy hash.
      await this.passwords.verify(dto.password, '$2a$12$' + 'x'.repeat(53));
      throw new UnauthorizedException('Invalid email or password');
    }

    if (this.accountSecurity.isLocked(user)) {
      await this.accountSecurity.recordLogin(user.id, false, meta, 'account_locked');
      throw new ForbiddenException('Account is temporarily locked. Try again later.');
    }

    const valid = user.passwordHash
      ? await this.passwords.verify(dto.password, user.passwordHash)
      : false;

    if (!valid) {
      await this.accountSecurity.registerFailedAttempt(user.id, user.email, meta);
      await this.accountSecurity.recordLogin(user.id, false, meta, 'invalid_password');
      await this.security.record({
        userId: user.id,
        type: SecurityEventType.LOGIN_FAILURE,
        severity: SecuritySeverity.LOW,
        meta,
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status === UserStatus.BANNED || user.status === UserStatus.CLOSED) {
      throw new ForbiddenException('This account is not permitted to sign in.');
    }

    await this.accountSecurity.resetFailedAttempts(user.id);
    const device = await this.devices.register(user.id, meta);

    if (user.twoFactorEnabled) {
      const challengeToken = generateToken();
      const challenge: TwoFactorChallenge = {
        userId: user.id,
        deviceId: device.id,
        rememberMe: dto.rememberMe ?? false,
      };
      await this.redis.set(`${CHALLENGE_PREFIX}${challengeToken}`, challenge, CHALLENGE_TTL_SECONDS);
      await this.security.record({
        userId: user.id,
        type: SecurityEventType.MFA_CHALLENGE,
        meta,
      });
      return { requiresTwoFactor: true, challengeToken };
    }

    const session = await this.completeLogin(user.id, meta, dto.rememberMe ?? false, device.id);
    return { requiresTwoFactor: false, session };
  }

  /** Complete a login that was gated behind a two-factor challenge. */
  async verifyTwoFactor(
    challengeToken: string,
    code: string,
    meta: RequestMeta,
  ): Promise<SessionResponse> {
    const key = `${CHALLENGE_PREFIX}${challengeToken}`;
    const challenge = await this.redis.get<TwoFactorChallenge>(key);
    if (!challenge) {
      throw new UnauthorizedException('Two-factor challenge expired. Please sign in again.');
    }

    const ok = await this.twoFactor.verifyCode(challenge.userId, code);
    if (!ok) {
      await this.security.record({
        userId: challenge.userId,
        type: SecurityEventType.LOGIN_FAILURE,
        severity: SecuritySeverity.MEDIUM,
        description: 'Failed two-factor verification',
        meta,
      });
      throw new UnauthorizedException('Invalid two-factor code');
    }

    await this.redis.del(key);
    return this.completeLogin(challenge.userId, meta, challenge.rememberMe, challenge.deviceId);
  }

  private async completeLogin(
    userId: string,
    meta: RequestMeta,
    rememberMe: boolean,
    deviceId: string | null,
  ): Promise<SessionResponse> {
    const response = await this.issueFor(userId, meta, rememberMe, deviceId);
    await this.users.updateLastLogin(userId, meta.ipAddress);
    await this.accountSecurity.recordLogin(userId, true, meta);

    // Phase 2D.2 (audit gap #17): a privileged sign-in was previously indistinguishable from a
    // player sign-in — both produced a bare LOGIN_SUCCESS. The client requirement lists "admin login"
    // as its own auditable action, so an elevated login is additionally written to the generic audit
    // trail with the roles that made it privileged, and its security event says so.
    const roles = response.user.roles ?? [];
    const elevated = roles.some((r) => r === 'admin' || r === 'super_admin' || r === 'moderator');

    await this.security.record({
      userId,
      type: SecurityEventType.LOGIN_SUCCESS,
      severity: elevated ? SecuritySeverity.MEDIUM : SecuritySeverity.INFO,
      description: elevated ? `Privileged sign-in (${roles.join(', ')})` : undefined,
      meta,
    });

    if (elevated) {
      await this.audit.record({
        userId,
        action: AuditAction.LOGIN,
        entityType: 'admin_session',
        entityId: userId,
        // Roles only — never a token, secret or credential.
        changes: { roles, twoFactor: response.user.twoFactorEnabled === true },
        meta,
      });
    }
    return response;
  }

  // ---- Token lifecycle -----------------------------------------------------

  async refresh(refreshToken: string, meta: RequestMeta): Promise<AuthTokens> {
    const { tokens } = await this.sessions.rotate(refreshToken, meta);
    return tokens;
  }

  async logout(
    userId: string,
    sessionId: string | undefined,
    accessJti: string | undefined,
    meta: RequestMeta,
  ): Promise<{ success: true }> {
    if (accessJti) {
      await this.tokens.blacklistAccess(accessJti);
    }
    if (sessionId) {
      await this.sessions.revoke(userId, sessionId, meta);
    }
    return { success: true };
  }

  async logoutAll(
    userId: string,
    currentSessionId?: string,
    meta?: RequestMeta | null,
  ): Promise<{ revoked: number }> {
    return this.sessions.revokeAll(userId, currentSessionId, meta);
  }

  // ---- Password change -----------------------------------------------------

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    currentSessionId: string | undefined,
    meta: RequestMeta,
  ): Promise<{ success: true }> {
    const user = await this.users.findById(userId);
    if (!user?.passwordHash) {
      throw new UnauthorizedException('Password change is not available for this account');
    }
    const valid = await this.passwords.verify(currentPassword, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    await this.passwords.assertAcceptable(newPassword, [user.email, user.username]);
    const passwordHash = await this.passwords.hash(newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });

    // Keep the current session, revoke all others. `meta` flows through so the bulk revocation is
    // attributable in the audit trail (Phase 2D.2, gap #16).
    await this.sessions.revokeAll(userId, currentSessionId, meta);
    await this.security.record({
      userId,
      type: SecurityEventType.PASSWORD_CHANGE,
      severity: SecuritySeverity.MEDIUM,
      description: 'Password changed; other sessions revoked',
      meta,
    });
    await this.notify.passwordChanged({ userId, at: new Date() });
    return { success: true };
  }

  /** Fresh profile + authorization for the authenticated user. */
  async getProfile(userId: string): Promise<AuthUserView> {
    const user = await this.users.findWithProfile(userId);
    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }
    const authz = await this.rbac.getUserAuthz(userId);
    return this.users.toAuthView(user, authz);
  }

  // ---- helpers -------------------------------------------------------------

  private async issueFor(
    userId: string,
    meta: RequestMeta,
    rememberMe: boolean,
    deviceId: string | null,
  ): Promise<SessionResponse> {
    const user = await this.users.findWithProfile(userId);
    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }
    const authz = await this.rbac.getUserAuthz(userId);
    const issued = await this.sessions.start({
      user: { id: user.id, email: user.email, username: user.username },
      authz,
      meta,
      deviceId,
      rememberMe,
    });
    return { user: this.users.toAuthView(user, authz), tokens: issued.tokens };
  }

  private async assignDefaultRole(userId: string): Promise<void> {
    const role = await this.prisma.role.findUnique({ where: { slug: ROLE_SLUGS.USER } });
    if (role) {
      await this.prisma.userRole.upsert({
        where: { userId_roleId: { userId, roleId: role.id } },
        update: {},
        create: { userId, roleId: role.id },
      });
    }
  }
}
