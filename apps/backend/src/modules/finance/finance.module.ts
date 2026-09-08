import { Module } from '@nestjs/common';

import { SecurityModule } from '../security/security.module';
import { ExpenseController } from './expense.controller';
import { ExpenseService } from './expense.service';
import { FinanceOpsController } from './finance-ops.controller';
import { FinanceOpsService } from './finance-ops.service';

/**
 * Finance (Phase 2D.5 F-03 expenses; Phase 2D.10 F-01/F-06/F-07 operations).
 *
 * Accounting data and read-only views. Nothing here creates a ledger entry or moves player money,
 * so it imports nothing from the wallet or gaming modules — it reads their tables directly.
 */
@Module({
  imports: [SecurityModule],
  controllers: [ExpenseController, FinanceOpsController],
  providers: [ExpenseService, FinanceOpsService],
  exports: [ExpenseService, FinanceOpsService],
})
export class FinanceModule {}
