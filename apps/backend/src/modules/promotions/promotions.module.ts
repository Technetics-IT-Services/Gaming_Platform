import { Module } from '@nestjs/common';

import { SecurityModule } from '../security/security.module';
import { AdminPromotionsController, PromotionsController } from './promotions.controller';
import { PromotionsService } from './promotions.service';

/**
 * Promotions administration (Phase 2D.9, AD-08).
 *
 * Configuration only. Awarding is BLOCKED on a missing business rule, so this module has no wallet
 * collaborator and imports nothing from the financial core.
 */
@Module({
  imports: [SecurityModule],
  controllers: [PromotionsController, AdminPromotionsController],
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
