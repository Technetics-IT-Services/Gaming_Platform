import { Module } from '@nestjs/common';

import { NotificationEventsService } from './notification-events.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';

/**
 * Notifications (Phase 2D.1). `NotificationEventsService` is the single orchestration layer other
 * modules inject to raise a player notification — they never write notification rows directly.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsGateway, NotificationEventsService],
  exports: [NotificationsService, NotificationsGateway, NotificationEventsService],
})
export class NotificationsModule {}
