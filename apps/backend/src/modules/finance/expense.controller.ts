import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExpenseStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength,
} from 'class-validator';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../authorization/rbac.constants';
import { ExpenseService } from './expense.service';

/* -------------------------------------------------------------------- DTOs */

/**
 * Recording an expense.
 *
 * There is deliberately NO `status`, `createdBy`, `voidedBy` or `id` field: an expense always
 * begins DRAFT and is always attributed to the authenticated operator. The global pipe runs
 * `forbidNonWhitelisted`, so sending any of those is a 400.
 */
export class CreateExpenseDto {
  @IsUUID() categoryId!: string;
  @IsString() @MinLength(2) @MaxLength(300) description!: string;

  /** Decimal string — never a number, so precision cannot be lost in transport. */
  @Matches(/^\d{1,12}(\.\d{1,8})?$/, { message: 'amount must be a positive decimal string' })
  amount!: string;

  @IsString() @MinLength(3) @MaxLength(8) currency!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'incurredOn must be YYYY-MM-DD' })
  incurredOn!: string;

  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class CreateCategoryDto {
  @Matches(/^[A-Za-z0-9_]{2,40}$/, { message: 'code must be 2–40 chars of A–Z, 0–9 or underscore' })
  code!: string;

  @IsString() @MinLength(2) @MaxLength(100) name!: string;
}

export class VoidExpenseDto {
  @IsString() @MinLength(3) @MaxLength(300) reason!: string;
}

export class ListExpensesDto {
  @IsOptional() @IsEnum(ExpenseStatus) status?: ExpenseStatus;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() @MaxLength(8) currency?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class TotalsDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
}

/* ---------------------------------------------------------------- controller */

/**
 * Finance — operating expenses (F-03).
 *
 * Guarded by the new narrow `expenses:read` / `expenses:write` pair. **`wallets:adjust` is neither
 * reused nor required**: recording what the business spent is not the authority to move player
 * money. A player and a moderator hold neither permission and are refused.
 *
 * Nothing here posts to the ledger or touches a wallet. An expense is accounting data.
 */
@ApiTags('Finance')
@ApiBearerAuth()
@Controller('admin/finance/expenses')
export class ExpenseController {
  constructor(private readonly expenses: ExpenseService) {}

  @Get('categories')
  @RequirePermissions(PERMISSIONS.EXPENSES_READ)
  @ApiOperation({ summary: 'Expense categories (operator-defined)' })
  categories() {
    return this.expenses.listCategories();
  }

  @Post('categories')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.EXPENSES_WRITE)
  @ApiOperation({ summary: 'Create an expense category (audited)' })
  createCategory(@CurrentUser('id') actorUserId: string, @Body() dto: CreateCategoryDto) {
    return this.expenses.createCategory({ ...dto, actorUserId });
  }

  @Get()
  @RequirePermissions(PERMISSIONS.EXPENSES_READ)
  @ApiOperation({ summary: 'List expenses — filter by status/category/currency/date' })
  list(@Query() q: ListExpensesDto) {
    return this.expenses.list(q);
  }

  @Get('totals')
  @RequirePermissions(PERMISSIONS.EXPENSES_READ)
  @ApiOperation({ summary: 'Expense totals per currency. NOT profit — revenue is undefined.' })
  totals(@Query() q: TotalsDto) {
    return this.expenses.totals(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.EXPENSES_READ)
  @ApiOperation({ summary: 'One expense' })
  get(@Param('id') id: string) {
    return this.expenses.getById(id);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.EXPENSES_WRITE)
  @ApiOperation({ summary: 'Record an expense (always DRAFT, audited)' })
  create(@CurrentUser('id') actorUserId: string, @Body() dto: CreateExpenseDto) {
    return this.expenses.create({ ...dto, currencyCode: dto.currency, actorUserId });
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.EXPENSES_WRITE)
  @ApiOperation({ summary: 'Confirm a DRAFT expense so it counts toward totals (audited)' })
  confirm(@Param('id') id: string, @CurrentUser('id') actorUserId: string) {
    return this.expenses.confirm(id, actorUserId);
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.EXPENSES_WRITE)
  @ApiOperation({ summary: 'Void an expense with a reason. Retained for audit, excluded from totals.' })
  voidExpense(@Param('id') id: string, @CurrentUser('id') actorUserId: string, @Body() dto: VoidExpenseDto) {
    return this.expenses.void(id, dto.reason, actorUserId);
  }
}
