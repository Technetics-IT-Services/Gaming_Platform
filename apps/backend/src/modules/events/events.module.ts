import { Global, Module } from '@nestjs/common';

import { ActivityEventService } from './activity-event.service';

/**
 * Activity events (Phase 2D.9, X-02).
 *
 * `@Global` so any module can emit without a web of imports. It provides one service and depends on
 * nothing but Prisma, so this creates no coupling — and recording is fire-and-forget, so an emitter
 * can never fail a business action.
 */
@Global()
@Module({
  providers: [ActivityEventService],
  exports: [ActivityEventService],
})
export class EventsModule {}
