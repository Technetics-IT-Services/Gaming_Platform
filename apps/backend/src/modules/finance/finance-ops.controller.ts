import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../authorization/rbac.constants';
import { FinanceOpsService } from './finance-ops.service';

/* -------------------------------------------------------------------- DTOs */

export class FinanceWindowDto {
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}

/** Which cashier queue to read. There is no amount or player filter: this is a work queue. */
export class CashierQueueDto {
  @IsOptional() @IsEnum(['deposits', 'withdrawals']) kind?: 'deposits' | 'withdrawals';
  @IsOptional() @Matches(/^[A-Z_]{3,20}$/) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

export class FailuresQueryDto extends FinanceWindowDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

/**
 * Transaction search filters.
 *
 * Amounts are decimal STRINGS. An unknown type/status/currency code deliberately matches nothing
 * rather than being ignored — see the service.
 */
export class TransactionSearchDto extends FinanceWindowDto {
  @IsOptional() @IsUUID() userId?: string;
  @IsOptional() @Matches(/^[A-Za-z_]{2,32}$/) typeCode?: string;
  @IsOptional() @Matches(/^[A-Za-z_]{2,32}$/) statusCode?: string;
  @IsOptional() @Matches(/^[A-Za-z]{3}$/) currencyCode?: string;
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
  @IsOptional() @Matches(/^\d{1,18}(\.\d{1,8})?$/) minAmount?: string;
  @IsOptional() @Matches(/^\d{1,18}(\.\d{1,8})?$/) maxAmount?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

/* ------------------------------------------------------------- finance API */

/**
 * Finance operations (Phase 2D.10) — F-01 portal, F-06 cash flow, F-07 search and failures.
 *
 * READ-ONLY, and guarded by `transactions:read`. That permission is deliberate: these routes expose
 * money that has already moved, so they need the transaction-reading authority — but they take no
 * action, so `wallets:adjust` is neither required nor accepted as a substitute. The `finance` role
 * introduced in this phase holds `transactions:read`; so do `admin` and `super_admin`.
 *
 * `AdminTwoFactorGuard` also applies, because the path begins with `admin/`.
 */
@ApiTags('Admin · Finance')
@ApiBearerAuth()
@Controller('admin/finance')
export class FinanceOpsController {
  constructor(private readonly finance: FinanceOpsService) {}

  @Get('queues')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_READ)
  @ApiOperation({ summary: 'Deposit and withdrawal review queue lengths (F-01)' })
  queues() {
    return this.finance.reviewQueues();
  }

  @Get('cash-flow')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_READ)
  @ApiOperation({
    summary:
      'Completed money in and out, PER CURRENCY (F-06). A movement figure — explicitly not revenue ' +
      'and not profit; both are returned as unavailable with the reason.',
  })
  cashFlow(@Query() q: FinanceWindowDto) {
    return this.finance.cashFlow(q);
  }

  @Get('cashier/queue')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_READ)
  @ApiOperation({
    summary:
      'Deposits/withdrawals awaiting an operator decision (F-01). Reading the queue needs only '
      + 'transactions:read; acting on an entry still needs wallets:adjust on /admin/cashier/*.',
  })
  cashierQueue(@Query() q: CashierQueueDto) {
    return this.finance.cashierQueue(q);
  }

  @Get('transactions')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_READ)
  @ApiOperation({ summary: 'Global transaction search across all players (F-07)' })
  transactions(@Query() q: TransactionSearchDto) {
    return this.finance.searchTransactions(q);
  }

  @Get('failures')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_READ)
  @ApiOperation({
    summary:
      'Failed deposits, rejected/failed withdrawals and failed game rounds (F-07). Reported from ' +
      'where failure is genuinely recorded, since wallet_transactions has no failure status.',
  })
  failures(@Query() q: FailuresQueryDto) {
    return this.finance.failures(q);
  }
}
