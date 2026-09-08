import { Module } from '@nestjs/common';

import { AuthorizationModule } from '../authorization/authorization.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SecurityModule } from '../security/security.module';
import { AdminPartnerController, PartnerController } from './partner.controller';
import { PartnerService } from './partner.service';

/**
 * Partner principal (Phase 2D.4, PA-01).
 *
 * Reuses the existing identity, RBAC, and audit infrastructure. It introduces no money: partner
 * profit, balance and withdrawals remain BLOCKED on a missing business definition.
 */
@Module({
  imports: [SecurityModule, AuthorizationModule, NotificationsModule],
  controllers: [PartnerController, AdminPartnerController],
  providers: [PartnerService],
  exports: [PartnerService],
})
export class PartnerModule {}
