import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { AuthenticatedUser, AuthTokens, PasswordStrengthResult } from '@gaming-platform/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ReqMeta } from '../../common/decorators/request-meta.decorator';
import type { RequestMeta } from '../../common/security/request-meta';
import { AppConfigService } from '../../config/app-config.service';
import { type LoginResponse, type SessionResponse, AuthService } from './auth.service';
import { EmailVerificationService } from './services/email-verification.service';
import { PasswordResetService } from './services/password-reset.service';
import { PasswordService } from './services/password.service';
import { durationToSeconds } from './services/token.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  PasswordStrengthDto,
  RefreshDto,
  ResetPasswordDto,
  VerifyEmailDto,
  VerifyTwoFactorLoginDto,
} from './dto/auth-flow.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly emailVerification: EmailVerificationService,
    private readonly passwordReset: PasswordResetService,
    private readonly passwords: PasswordService,
    private readonly config: AppConfigService,
  ) {}

  private setRefreshCookie(res: Response, token: string, rememberMe = false): void {
    const { cookieName, cookieDomain, cookieSecure, refreshExpiresIn, rememberMeExpiresIn } =
      this.config.auth;
    res.cookie(cookieName, token, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: 'lax',
      domain: cookieDomain,
      path: '/',
      maxAge: durationToSeconds(rememberMe ? rememberMeExpiresIn : refreshExpiresIn) * 1000,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(this.config.auth.cookieName, {
      domain: this.config.auth.cookieDomain,
      path: '/',
    });
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Register a new account and start a session' })
  async register(
    @Body() dto: RegisterDto,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const result = await this.authService.register(dto, meta);
    this.setRefreshCookie(res, result.tokens.refreshToken);
    return result;
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Authenticate with email and password' })
  async login(
    @Body() dto: LoginDto,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const result = await this.authService.login(dto, meta);
    if (result.session) {
      this.setRefreshCookie(res, result.session.tokens.refreshToken, dto.rememberMe);
    }
    return result;
  }

  @Public()
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Complete a two-factor challenge and start a session' })
  async verifyTwoFactor(
    @Body() dto: VerifyTwoFactorLoginDto,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const result = await this.authService.verifyTwoFactor(dto.challengeToken, dto.code, meta);
    this.setRefreshCookie(res, result.tokens.refreshToken);
    return result;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rotate the refresh token for a new token pair' })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request & { cookies?: Record<string, string> },
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens> {
    const token = dto.refreshToken ?? req.cookies?.[this.config.auth.cookieName];
    if (!token) {
      throw new UnauthorizedException('Refresh token missing');
    }
    const tokens = await this.authService.refresh(token, meta);
    this.setRefreshCookie(res, tokens.refreshToken);
    return tokens;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true }> {
    const result = await this.authService.logout(user.id, user.sessionId, user.jti, meta);
    this.clearRefreshCookie(res);
    return result;
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke every session for the current user' })
  logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @ReqMeta() meta: RequestMeta,
  ): Promise<{ revoked: number }> {
    // `meta` flows through so the bulk revocation is attributable (Phase 2D.2, audit gap #16).
    return this.authService.logoutAll(user.id, undefined, meta);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the authenticated user profile and authorization' })
  me(@CurrentUser('id') userId: string) {
    return this.authService.getProfile(userId);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify an email address with a token' })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.emailVerification.verify(dto.token);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Resend the email verification link' })
  resendVerification(@CurrentUser('id') userId: string) {
    return this.emailVerification.resend(userId);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Request a password reset email' })
  forgotPassword(@Body() dto: ForgotPasswordDto, @ReqMeta() meta: RequestMeta) {
    return this.passwordReset.request(dto.email, meta);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Reset a password using a token' })
  resetPassword(@Body() dto: ResetPasswordDto, @ReqMeta() meta: RequestMeta) {
    return this.passwordReset.reset(dto.token, dto.password, meta);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change the current password (revokes other sessions)' })
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.authService.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
      user.sessionId,
      meta,
    );
  }

  @Public()
  @Post('password/strength')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Evaluate password strength' })
  passwordStrength(@Body() dto: PasswordStrengthDto): PasswordStrengthResult {
    return this.passwords.evaluateStrength(dto.password);
  }
}
