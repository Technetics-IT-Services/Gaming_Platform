import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AdminActionAuditInterceptor } from './common/interceptors/admin-action-audit.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { AdminTwoFactorGuard } from './modules/authorization/guards/admin-two-factor.guard';
import { PermissionsGuard } from './modules/authorization/guards/permissions.guard';
import { AppConfigService } from './config/app-config.service';
import { ConfigModule } from './config/config.module';
import { LoggerModule } from './logger/logger.module';
import { AdminModule } from './modules/admin/admin.module';
import { AiModule } from './modules/ai/ai.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthorizationModule } from './modules/authorization/authorization.module';
import { CardModule } from './modules/card/card.module';
import { CrashModule } from './modules/crash/crash.module';
import { DatabaseModule } from './modules/database/database.module';
import { DiceModule } from './modules/dice/dice.module';
import { GamesModule } from './modules/games/games.module';
import { HealthModule } from './modules/health/health.module';
import { MailModule } from './modules/mailer/mail.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { EventsModule } from './modules/events/events.module';
import { BonusAdminModule } from './modules/bonus-admin/bonus-admin.module';
import { FinanceModule } from './modules/finance/finance.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { ReferralModule } from './modules/referral/referral.module';
import { SettingsModule } from './modules/settings/settings.module';
import { KycModule } from './modules/kyc/kyc.module';
import { PartnerModule } from './modules/partner/partner.module';
import { ResponsibleGamingModule } from './modules/responsible-gaming/responsible-gaming.module';
import { SupportModule } from './modules/support/support.module';
import { OperationsModule } from './modules/operations/operations.module';
import { RedisModule } from './modules/redis/redis.module';
import { RouletteModule } from './modules/roulette/roulette.module';
import { RuntimeModule } from './modules/runtime/runtime.module';
import { SportsModule } from './modules/sports/sports.module';
import { TournamentModule } from './modules/tournament/tournament.module';
import { SecurityModule } from './modules/security/security.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { UsersModule } from './modules/users/users.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { WalletEngineModule } from './modules/wallet-engine/wallet-engine.module';
import { GamingMoneyModule } from './modules/gaming-money/gaming-money.module';

@Module({
  imports: [
    // Infrastructure
    ConfigModule,
    LoggerModule,
    DatabaseModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        throttlers: [
          {
            ttl: config.throttle.ttl * 1000,
            limit: config.throttle.limit,
          },
        ],
      }),
    }),

    // Cross-cutting security
    SecurityModule,
    MailModule,
    AuthorizationModule,

    // Observability & reliability — global; the metrics interceptor and
    // resilience/queue services are available platform-wide.
    OperationsModule,

    // Financial backbone — global; must register before the game engines so the
    // wallet bridge is available for integration.
    WalletEngineModule,

    // Real-money game bridge (Phase 2B) — composes WalletEngine + DiceEngine.
    GamingMoneyModule,

    // Domain modules
    HealthModule,
    AuthModule,
    UsersModule,
    GamesModule,
    RuntimeModule,
    CardModule,
    RouletteModule,
    DiceModule,
    CrashModule,
    SportsModule,
    TournamentModule,
    AiModule,
    WalletModule,
    TransactionsModule,
    NotificationsModule,
    ResponsibleGamingModule,
    KycModule,
    EventsModule,
    FinanceModule,
    BonusAdminModule,
    SettingsModule,
    ReferralModule,
    PromotionsModule,
    PartnerModule,
    SupportModule,
    AdminModule,
    AnalyticsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global guards: rate limit → authenticate → authorize.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // Phase 2D.2: administrator accounts must hold a second factor before ANY admin-API call.
    // Runs after JwtAuthGuard; it only ever ADDS a requirement and never grants access.
    { provide: APP_GUARD, useClass: AdminTwoFactorGuard },
    // Global response envelope and request logging.
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    // Phase 2D.10 (AD-12): blanket audit of every successful mutating request under /admin/,
    // attributed to the operator. Closes the wallet-adjustment gap without touching frozen code.
    { provide: APP_INTERCEPTOR, useClass: AdminActionAuditInterceptor },
    // Global exception normalization.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
