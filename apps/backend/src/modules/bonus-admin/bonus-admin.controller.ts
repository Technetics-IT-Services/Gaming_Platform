import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WalletStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength,
} from 'class-validator';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../authorization/rbac.constants';
import { BonusAdminService } from './bonus-admin.service';

/* -------------------------------------------------------------------- DTOs */

/**
 * Granting a bonus.
 *
 * `amount` and `wageringRequirement` are decimal STRINGS — never floats — and are supplied by the
 * operator. There is no `status`, no `id` and no self-service variant: the recipient is always named
 * explicitly, so a grant can never be implicitly "to me".
 */
export class GrantBonusAdminDto {
  @IsUUID() userId!: string;

  @Matches(/^[A-Z]{3}$/, { message: 'currencyCode must be a 3-letter code, e.g. INR' })
  currencyCode!: string;

  @Matches(/^\d{1,12}(\.\d{1,8})?$/, { message: 'amount must be a positive decimal string' })
  amount!: string;

  @IsOptional()
  @Matches(/^\d{1,12}(\.\d{1,8})?$/, { message: 'wageringRequirement must be a decimal string' })
  wageringRequirement?: string;

  @IsOptional() @IsISO8601() expiresAt?: string;

  /** The operator's own idempotency anchor. Replaying the same reference returns the first grant. */
  @IsString() @MinLength(6) @MaxLength(80) reference!: string;

  /** Why this bonus was granted. Recorded in the audit trail. */
  @IsString() @MinLength(3) @MaxLength(300) reason!: string;
}

export class ExpireBonusDto {
  @IsString() @MinLength(3) @MaxLength(300) reason!: string;
}

export class ListBonusesDto {
  @IsOptional() @IsUUID() userId?: string;
  @IsOptional() @IsEnum(WalletStatus) status?: WalletStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

/* --------------------------------------------------------------- admin API */

/**
 * Operator bonus administration (AD-07).
 *
 * Every route requires `wallets:adjust` — the same authority already required to credit or debit a
 * player's wallet, which is exactly what granting promotional credit amounts to. No new permission
 * was invented.
 *
 * Because the path begins with `admin/`, `AdminTwoFactorGuard` also applies: an elevated account
 * without a second factor is refused before permissions are even considered.
 */
@ApiTags('Admin · Bonuses')
@ApiBearerAuth()
@Controller('admin/bonuses')
export class BonusAdminController {
  constructor(private readonly bonuses: BonusAdminService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WALLETS_READ)
  @ApiOperation({ summary: 'List granted bonuses (filterable by player and status)' })
  list(@Query() q: ListBonusesDto) {
    return this.bonuses.list(q);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.WALLETS_ADJUST)
  @ApiOperation({
    summary:
      'Grant a bonus to a named player. Amount and wagering requirement are operator-supplied; ' +
      'idempotent on `reference`; audited to the acting operator.',
  })
  grant(@CurrentUser('id') actorUserId: string, @Body() dto: GrantBonusAdminDto) {
    return this.bonuses.grant({ ...dto, actorUserId });
  }

  @Post(':id/expire')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.WALLETS_ADJUST)
  @ApiOperation({ summary: 'Expire an outstanding bonus so it can no longer be converted (audited)' })
  expire(
    @Param('id') id: string,
    @CurrentUser('id') actorUserId: string,
    @Body() dto: ExpireBonusDto,
  ) {
    return this.bonuses.expire(id, dto.reason, actorUserId);
  }
}
