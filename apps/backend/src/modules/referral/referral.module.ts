import { Module } from '@nestjs/common';

import { SecurityModule } from '../security/security.module';
import { AdminReferralController, ReferralController } from './referral.controller';
import { ReferralService } from './referral.service';

/**
 * Referral attribution (Phase 2D.9, P-17).
 *
 * Attribution only. Qualification and reward are BLOCKED on missing business definitions, so this
 * module never credits a wallet and imports nothing from the financial core.
 */
@Module({
  imports: [SecurityModule],
  controllers: [ReferralController, AdminReferralController],
  providers: [ReferralService],
  exports: [ReferralService],
})
export class ReferralModule {}
