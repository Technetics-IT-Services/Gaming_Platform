import { Module } from '@nestjs/common';

import { SecurityModule } from '../security/security.module';
import {
  AdminResponsibleGamingController,
  ResponsibleGamingController,
} from './responsible-gaming.controller';
import { ResponsibleGamingGuard } from './responsible-gaming.guard';
import { ResponsibleGamingService } from './responsible-gaming.service';

/**
 * Responsible gaming (Phase 2D.X, P0).
 *
 * Exports the service AND the guard so the money/game modules can apply enforcement without
 * importing anything from the frozen financial core.
 */
@Module({
  imports: [SecurityModule],
  controllers: [ResponsibleGamingController, AdminResponsibleGamingController],
  providers: [ResponsibleGamingService, ResponsibleGamingGuard],
  exports: [ResponsibleGamingService, ResponsibleGamingGuard],
})
export class ResponsibleGamingModule {}
