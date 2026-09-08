import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { NotificationsModule } from '../notifications/notifications.module';
import { AppConfigService } from '../../config/app-config.service';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ApiKeysController } from './controllers/api-keys.controller';
import { DevicesController } from './controllers/devices.controller';
import { SecurityController } from './controllers/security.controller';
import { SessionsController } from './controllers/sessions.controller';
import { TwoFactorController } from './controllers/two-factor.controller';
import { ApiKeyGuard } from './guards/api-key.guard';
import { AccountSecurityService } from './services/account-security.service';
import { ApiKeyService } from './services/api-key.service';
import { DeviceService } from './services/device.service';
import { EmailVerificationService } from './services/email-verification.service';
import { PasswordResetService } from './services/password-reset.service';
import { PasswordService } from './services/password.service';
import { SessionService } from './services/session.service';
import { TokenService } from './services/token.service';
import { TwoFactorService } from './services/two-factor.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    UsersModule,
    NotificationsModule, // Phase 2D.1 — player security notifications
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.auth.accessSecret,
        signOptions: { expiresIn: config.auth.accessExpiresIn },
      }),
    }),
  ],
  controllers: [
    AuthController,
    SessionsController,
    DevicesController,
    TwoFactorController,
    ApiKeysController,
    SecurityController,
  ],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    SessionService,
    DeviceService,
    TwoFactorService,
    ApiKeyService,
    EmailVerificationService,
    PasswordResetService,
    AccountSecurityService,
    JwtStrategy,
    ApiKeyGuard,
  ],
  exports: [
    AuthService,
    TokenService,
    SessionService,
    ApiKeyService,
    AccountSecurityService,
    PasswordService,
  ],
})
export class AuthModule {}
