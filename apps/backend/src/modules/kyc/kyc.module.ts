import { Module } from '@nestjs/common';

import { SecurityModule } from '../security/security.module';
import { AdminKycController, KycController } from './kyc.controller';
import { KycService } from './kyc.service';

/** KYC submission + review (Phase 2D.3). Reuses the existing KycVerification/Document models. */
@Module({
  imports: [SecurityModule],
  controllers: [KycController, AdminKycController],
  providers: [KycService],
  exports: [KycService],
})
export class KycModule {}
