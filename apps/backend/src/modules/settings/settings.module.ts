import { Module } from '@nestjs/common';

import { SecurityModule } from '../security/security.module';
import { AdminSettingsController, PublicSettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * Platform settings (Phase 2D.8, AD-09).
 *
 * Stores to `SystemSetting` behind a hard-coded allow-list. `ApplicationSetting` — which holds live
 * real-money game variant configuration — is never touched.
 */
@Module({
  imports: [SecurityModule],
  controllers: [PublicSettingsController, AdminSettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
