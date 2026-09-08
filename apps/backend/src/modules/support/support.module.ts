import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module';
import { SecurityModule } from '../security/security.module';
import { AdminSupportController, SupportController } from './support.controller';
import { SupportService } from './support.service';

/** Support ticketing (Phase 2D.3). Reuses the existing audit and notification infrastructure. */
@Module({
  imports: [SecurityModule, NotificationsModule],
  controllers: [SupportController, AdminSupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
