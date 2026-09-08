import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RgLimitPeriod, RgLimitType, RgRestrictionType } from '@prisma/client';
import { IsEnum, IsISO8601, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../authorization/rbac.constants';
import { ResponsibleGamingService } from './responsible-gaming.service';

/* ------------------------------------------------------------------- DTOs */

export class SetLimitDto {
  @IsEnum(RgLimitType) type!: RgLimitType;
  @IsEnum(RgLimitPeriod) period!: RgLimitPeriod;

  @Matches(/^\d{1,12}(\.\d{1,8})?$/, { message: 'amount must be a positive decimal' })
  amount!: string;

  @IsString() @MinLength(3) @MaxLength(8) currency!: string;
}

export class RemoveLimitDto {
  @IsEnum(RgLimitType) type!: RgLimitType;
  @IsEnum(RgLimitPeriod) period!: RgLimitPeriod;
  @IsString() @MinLength(3) @MaxLength(8) currency!: string;
}

export class CreateRestrictionDto {
  @IsEnum(RgRestrictionType) type!: RgRestrictionType;

  /** Omit for a permanent self-exclusion. Required for cooling-off. */
  @IsOptional() @IsISO8601() endsAt?: string;

  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class LiftRestrictionDto {
  @IsString() @MinLength(3) @MaxLength(200) reason!: string;
}

/**
 * Responsible gaming — the PLAYER's own controls.
 *
 * Every route is scoped to `@CurrentUser('id')`. **No route accepts a user id from the client**, so
 * one player can never read or change another player's limits or exclusions. That is the whole
 * IDOR surface of this module, and it is closed by construction rather than by a check.
 */
@ApiTags('Responsible Gaming')
@ApiBearerAuth()
@Controller('responsible-gaming')
export class ResponsibleGamingController {
  constructor(private readonly rg: ResponsibleGamingService) {}

  @Get()
  @ApiOperation({ summary: "The caller's live limits (with real usage) and restrictions" })
  overview(@CurrentUser('id') userId: string) {
    return this.rg.overview(userId);
  }

  @Post('limits')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set or change a limit. Decreases apply immediately.' })
  setLimit(@CurrentUser('id') userId: string, @Body() dto: SetLimitDto) {
    return this.rg.setLimit({
      userId,
      type: dto.type,
      period: dto.period,
      amount: dto.amount,
      currencyCode: dto.currency,
      setByUserId: null, // self-service
    });
  }

  @Delete('limits')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove one of the caller’s limits' })
  async removeLimit(@CurrentUser('id') userId: string, @Query() dto: RemoveLimitDto) {
    await this.rg.removeLimit(userId, dto.type, dto.period, dto.currency);
    return { removed: true };
  }

  @Post('restrictions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Self-exclude or start a cooling-off period' })
  createRestriction(@CurrentUser('id') userId: string, @Body() dto: CreateRestrictionDto) {
    return this.rg.createRestriction({
      userId,
      type: dto.type,
      endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
      reason: dto.reason,
      createdByUserId: null, // the player themselves
    });
  }

  @Get('restrictions')
  @ApiOperation({ summary: "The caller's restriction history" })
  listRestrictions(@CurrentUser('id') userId: string) {
    return this.rg.listRestrictions(userId);
  }
}

/**
 * Responsible gaming — OPERATOR controls.
 *
 * Lifting a restriction is the one action a player must not perform on themselves, so it lives here
 * behind `users:lock` — the existing permission for restricting/unrestricting an account. No new
 * permission was invented, and no financial permission is involved.
 *
 * Every action here is attributed to the operator and written to the audit trail.
 */
@ApiTags('Responsible Gaming')
@ApiBearerAuth()
@Controller('admin/responsible-gaming')
@RequirePermissions(PERMISSIONS.USERS_LOCK)
export class AdminResponsibleGamingController {
  constructor(private readonly rg: ResponsibleGamingService) {}

  @Get('users/:userId')
  @ApiOperation({ summary: "An operator view of one player's limits and restrictions" })
  overview(@Param('userId') userId: string) {
    return this.rg.overview(userId);
  }

  @Post('restrictions/:id/lift')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lift a restriction early (audited, attributed)' })
  lift(
    @Param('id') id: string,
    @CurrentUser('id') operatorUserId: string,
    @Body() dto: LiftRestrictionDto,
  ) {
    return this.rg.liftRestriction(id, operatorUserId, dto.reason);
  }
}
