import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { SessionStatus, TokenStatus } from '@prisma/client';
import { AuditAction, SecurityEventType, SecuritySeverity } from '@prisma/client';
import type { AuthTokens, SessionSummary } from '@gaming-platform/types';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import type { Logger } from 'winston';

import { AppConfigService } from '../../../config/app-config.service';
import {
  generateId,
  generateToken,
  sha256,
} from '../../../common/security/crypto.util';
import type { RequestMeta } from '../../../common/security/request-meta';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuditService } from '../../security/audit.service';
import { SecurityEventService } from '../../security/security-event.service';
import { GeoService } from '../../security/geo.service';
import { type UserAuthz, RbacService } from '../../authorization/rbac.service';
import { durationToSeconds, TokenService } from './token.service';

const SESSION_PREFIX = 'session:';

interface SessionUser {
  id: string;
  email: string;
  username: string;
}

export interface StartSessionInput {
  user: SessionUser;
  authz: UserAuthz;
  meta: RequestMeta;
  deviceId?: string | null;
  rememberMe?: boolean;
}

export interface IssuedSession {
  tokens: AuthTokens;
  sessionId: string;
}

interface RedisSession {
  userId: string;
  deviceId: string | null;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tokens: TokenService,
    private readonly config: AppConfigService,
    private readonly rbac: RbacService,
    private readonly security: SecurityEventService,
    private readonly geo: GeoService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
    // Phase 2D.2: bulk session revocation is recorded in the generic audit trail too.
    private readonly audit: AuditService,
  ) {}

  private redisKey(sid: string): string {
    return `${SESSION_PREFIX}${sid}`;
  }

  private refreshTtl(rememberMe?: boolean): string {
    return rememberMe ? this.config.auth.rememberMeExpiresIn : this.config.auth.refreshExpiresIn;
  }

  /** Create a fresh session and issue the first access/refresh token pair. */
  async start(input: StartSessionInput): Promise<IssuedSession> {
    await this.enforceConcurrency(input.user.id);

    const refreshTtl = this.refreshTtl(input.rememberMe);
    const refreshTtlSeconds = durationToSeconds(refreshTtl);
    const expiresAt = new Date(Date.now() + refreshTtlSeconds * 1000);

    const session = await this.prisma.session.create({
      data: {
        userId: input.user.id,
        deviceId: input.deviceId ?? null,
        tokenHash: sha256(generateToken()),
        ipAddress: input.meta.ipAddress,
        userAgent: input.meta.userAgent,
        status: SessionStatus.ACTIVE,
        lastActivityAt: new Date(),
        expiresAt,
      },
    });

    const family = generateId();
    const tokens = await this.issueTokenPair(input.user, input.authz, session.id, family, refreshTtl);

    await this.persistRefreshToken(input.user.id, session.id, family, tokens.refreshToken, expiresAt);
    await this.redis.set(
      this.redisKey(session.id),
      { userId: input.user.id, deviceId: input.deviceId ?? null } satisfies RedisSession,
      refreshTtlSeconds,
    );

    return { tokens, sessionId: session.id };
  }

  /** Rotate a refresh token. Detects reuse of an already-rotated token. */
  async rotate(refreshToken: string, meta: RequestMeta): Promise<IssuedSession> {
    let claims;
    try {
      claims = await this.tokens.verifyRefreshToken(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenHash = sha256(refreshToken);
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!record) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (record.status !== TokenStatus.ACTIVE) {
      // Reuse of a rotated/revoked token → compromise. Burn the whole family.
      await this.handleReuse(record.userId, record.family, record.sessionId, meta);
      throw new UnauthorizedException('Refresh token reuse detected. All sessions were revoked.');
    }

    if (record.expiresAt.getTime() < Date.now()) {
      await this.prisma.refreshToken.update({
        where: { id: record.id },
        data: { status: TokenStatus.EXPIRED },
      });
      throw new UnauthorizedException('Refresh token expired');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: claims.sub, deletedAt: null },
      select: { id: true, email: true, username: true, status: true },
    });
    if (!user || user.status === 'BANNED' || user.status === 'CLOSED' || user.status === 'SUSPENDED') {
      await this.revokeSessionInternal(record.sessionId);
      throw new UnauthorizedException('Session is no longer valid');
    }

    const sessionId = record.sessionId ?? claims.sid;
    if (!sessionId) {
      throw new UnauthorizedException('Malformed session');
    }

    // ---- Phase 2D.2: server-authoritative IDLE-SESSION expiry -------------------------------
    // Checked BEFORE anything is issued, so an idle session never mints a token on its way to being
    // refused. `rotate()` is the single place a session is renewed and is already single-flight on
    // the client, so there is no rotation storm; `lastActivityAt` is already maintained here.
    // A client-side timer alone revokes nothing and would not be a real control.
    await this.assertNotIdle(sessionId, user.id, meta);

    // ---- Phase 2D.2: ATOMIC ROTATION CLAIM ---------------------------------------------------
    // Previously the ACTIVE check at the top of this method and the ACTIVE -> USED write at the
    // bottom were separated by several awaits. Six simultaneous refreshes presenting the SAME token
    // therefore all read ACTIVE and all succeeded, minting six token families and slipping past
    // reuse detection entirely (proven live in PHASE_2D2_SECURITY_TESTS.md, attack #16).
    //
    // The transition is now a single conditional UPDATE. Exactly one caller can match `status:
    // ACTIVE`; every loser matches nothing, which is indistinguishable from presenting an
    // already-rotated token — so it is handled by the SAME reuse path, burning the family.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, status: TokenStatus.ACTIVE },
      data: { status: TokenStatus.USED },
    });
    if (claimed.count === 0) {
      await this.handleReuse(record.userId, record.family, record.sessionId, meta);
      throw new UnauthorizedException('Refresh token reuse detected. All sessions were revoked.');
    }

    const authz = await this.rbac.getUserAuthz(user.id);
    const refreshTtlSeconds = Math.max(
      1,
      Math.floor((record.expiresAt.getTime() - Date.now()) / 1000),
    );
    const refreshTtl = `${refreshTtlSeconds}s`;

    const tokens = await this.issueTokenPair(
      { id: user.id, email: user.email, username: user.username },
      authz,
      sessionId,
      record.family,
      refreshTtl,
    );

    const newRecord = await this.persistRefreshToken(
      user.id,
      sessionId,
      record.family,
      tokens.refreshToken,
      record.expiresAt,
    );

    // The old token was already claimed atomically above; link it to its replacement.
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { replacedById: newRecord.id },
    });

    await this.prisma.session.update({
      where: { id: sessionId },
      data: { lastActivityAt: new Date(), ipAddress: meta.ipAddress, userAgent: meta.userAgent },
    });
    await this.redis.set(
      this.redisKey(sessionId),
      { userId: user.id, deviceId: null } satisfies RedisSession,
      refreshTtlSeconds,
    );

    return { tokens, sessionId };
  }

  /** Whether the session is still active (fast Redis path, DB fallback). */
  async isActive(sessionId: string): Promise<boolean> {
    if (await this.redis.exists(this.redisKey(sessionId))) {
      return true;
    }
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { status: true, expiresAt: true },
    });
    return Boolean(
      session && session.status === SessionStatus.ACTIVE && session.expiresAt.getTime() > Date.now(),
    );
  }

  async listForUser(userId: string, currentSessionId?: string): Promise<SessionSummary[]> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, status: SessionStatus.ACTIVE, expiresAt: { gt: new Date() } },
      orderBy: { lastActivityAt: 'desc' },
      include: { device: { select: { name: true } } },
    });

    return sessions.map((s) => ({
      id: s.id,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      deviceName: s.device?.name ?? null,
      location: null,
      current: s.id === currentSessionId,
      lastActivityAt: s.lastActivityAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
    }));
  }

  async revoke(userId: string, sessionId: string, meta?: RequestMeta): Promise<{ success: true }> {
    const session = await this.prisma.session.findFirst({ where: { id: sessionId, userId } });
    if (!session) {
      throw new UnauthorizedException('Session not found');
    }
    await this.revokeSessionInternal(sessionId);
    await this.security.record({
      userId,
      type: SecurityEventType.LOGOUT,
      description: 'Session revoked',
      meta,
    });
    return { success: true };
  }

  /**
   * Revoke every session for a user, optionally keeping the current one.
   *
   * Phase 2D.2: bulk revocation is a security-critical action (it is what "log out everywhere" and a
   * post-password-change cleanup do) and was previously recorded NOWHERE. It is now written to both
   * audit stores after the revocation commits, carrying only the count — never a token or hash.
   */
  async revokeAll(userId: string, exceptSessionId?: string, meta?: RequestMeta | null): Promise<{ revoked: number }> {
    const sessions = await this.prisma.session.findMany({
      where: {
        userId,
        status: SessionStatus.ACTIVE,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      select: { id: true },
    });
    await Promise.all(sessions.map((s) => this.revokeSessionInternal(s.id)));

    if (sessions.length > 0) {
      await this.security.record({
        userId,
        type: SecurityEventType.LOGOUT,
        severity: SecuritySeverity.MEDIUM,
        description: `Bulk session revocation (${sessions.length} session(s))`,
        meta: meta ?? null,
      });
      await this.audit.record({
        userId,
        action: AuditAction.DELETE,
        entityType: 'sessions',
        entityId: userId,
        changes: { revoked: sessions.length, keptCurrent: Boolean(exceptSessionId) },
        meta: meta ?? null,
      });
    }
    return { revoked: sessions.length };
  }

  /**
   * Refuse (and revoke) a session that has been idle longer than the configured window.
   *
   * `SESSION_IDLE_TIMEOUT_MINUTES` defaults to 0 = DISABLED, so with no configuration this method is
   * a no-op and behaviour is unchanged. No timeout value is invented here.
   */
  private async assertNotIdle(sessionId: string, userId: string, meta: RequestMeta): Promise<void> {
    const minutes = this.config.security.sessionIdleTimeoutMinutes;
    if (!minutes || minutes <= 0) return; // disabled — unchanged behaviour

    const row = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { lastActivityAt: true },
    });
    const lastActivityAt = row?.lastActivityAt ?? null;
    if (!lastActivityAt) return; // never active yet; nothing to expire

    const idleMs = Date.now() - lastActivityAt.getTime();
    if (idleMs <= minutes * 60_000) return;

    await this.revokeSessionInternal(sessionId);
    await this.security.record({
      userId,
      type: SecurityEventType.LOGOUT,
      severity: SecuritySeverity.MEDIUM,
      description: `Session expired after ${Math.round(idleMs / 60_000)} minutes idle (limit ${minutes})`,
      meta,
    });
    throw new UnauthorizedException('Session expired due to inactivity');
  }

  // --- internals ------------------------------------------------------------

  private async issueTokenPair(
    user: SessionUser,
    authz: UserAuthz,
    sessionId: string,
    family: string,
    refreshExpiresIn: string,
  ): Promise<AuthTokens> {
    const access = await this.tokens.signAccessToken({
      sub: user.id,
      email: user.email,
      username: user.username,
      role: authz.primaryRole,
      roles: authz.roles,
      permissions: authz.permissions,
      sid: sessionId,
    });
    const refresh = await this.tokens.signRefreshToken(
      { sub: user.id, sid: sessionId, family },
      refreshExpiresIn,
    );
    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      tokenType: 'Bearer',
      expiresIn: access.expiresInSeconds,
    };
  }

  private persistRefreshToken(
    userId: string,
    sessionId: string,
    family: string,
    refreshToken: string,
    expiresAt: Date,
  ) {
    return this.prisma.refreshToken.create({
      data: {
        userId,
        sessionId,
        tokenHash: sha256(refreshToken),
        family,
        status: TokenStatus.ACTIVE,
        expiresAt,
      },
    });
  }

  private async revokeSessionInternal(sessionId: string | null): Promise<void> {
    if (!sessionId) return;
    await this.prisma.$transaction([
      this.prisma.session.updateMany({
        where: { id: sessionId },
        data: { status: SessionStatus.REVOKED, revokedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { sessionId, status: TokenStatus.ACTIVE },
        data: { status: TokenStatus.REVOKED, revokedAt: new Date() },
      }),
    ]);
    await this.redis.del(this.redisKey(sessionId));
  }

  private async handleReuse(
    userId: string,
    family: string,
    sessionId: string | null,
    meta: RequestMeta,
  ): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { family, status: { in: [TokenStatus.ACTIVE, TokenStatus.USED] } },
      data: { status: TokenStatus.REVOKED, revokedAt: new Date() },
    });
    await this.revokeSessionInternal(sessionId);
    await this.security.record({
      userId,
      type: SecurityEventType.SUSPICIOUS_ACTIVITY,
      severity: SecuritySeverity.HIGH,
      description: 'Refresh token reuse detected; token family revoked',
      meta,
    });
    this.logger.warn('Refresh token reuse detected', { context: 'SessionService', userId, family });
  }

  private async enforceConcurrency(userId: string): Promise<void> {
    const max = this.config.security.maxConcurrentSessions;
    const active = await this.prisma.session.findMany({
      where: { userId, status: SessionStatus.ACTIVE, expiresAt: { gt: new Date() } },
      orderBy: { lastActivityAt: 'asc' },
      select: { id: true },
    });
    const overflow = active.length - (max - 1);
    if (overflow > 0) {
      const toRevoke = active.slice(0, overflow);
      await Promise.all(toRevoke.map((s) => this.revokeSessionInternal(s.id)));
    }
  }
}
