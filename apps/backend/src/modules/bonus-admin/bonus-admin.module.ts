import { Module } from '@nestjs/common';

import { SecurityModule } from '../security/security.module';
import { WalletEngineModule } from '../wallet-engine/wallet-engine.module';
import { BonusAdminController } from './bonus-admin.controller';
import { BonusAdminService } from './bonus-admin.service';

/**
 * Operator bonus administration (Phase 2D.10, AD-07).
 *
 * Imports the frozen `WalletEngineModule` to CONSUME its exported `BonusWalletService`. Nothing in
 * the frozen module is modified, overridden or re-provided — this module adds only the operator
 * boundary the frozen layer lacks: authorization, idempotency and audit.
 */
@Module({
  imports: [WalletEngineModule, SecurityModule],
  controllers: [BonusAdminController],
  providers: [BonusAdminService],
  exports: [BonusAdminService],
})
export class BonusAdminModule {}
