import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module';
import { SecurityModule } from '../security/security.module';
import { WalletEngineModule } from '../wallet-engine/wallet-engine.module';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { CashierService } from './cashier.service';
import { CashierController } from './cashier.controller';
import { AdminCashierController } from './admin-cashier.controller';
import { ResponsibleGamingModule } from '../responsible-gaming/responsible-gaming.module';

@Module({
  // Reuse the frozen WalletEngineService (money) + WalletTransactionService (history), and the
  // EXISTING AuditService from SecurityModule for operator audit records (Phase 2C.17, P0-3).
  imports: [WalletEngineModule, SecurityModule, NotificationsModule, ResponsibleGamingModule],
  controllers: [WalletController, CashierController, AdminCashierController],
  providers: [WalletService, CashierService],
  exports: [WalletService, CashierService],
})
export class WalletModule {}
