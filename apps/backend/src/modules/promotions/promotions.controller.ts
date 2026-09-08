import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PromotionStatus, PromotionType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum, IsInt, IsObject, IsOptional, IsISO8601, IsString, Matches, Max, MaxLength, Min, MinLength,
} from 'class-validator';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../authorization/rbac.constants';
import { PromotionsService } from './promotions.service';

/* -------------------------------------------------------------------- DTOs */

/**
 * Creating a promotion.
 *
 * There is deliberately NO `status`, `currentRedemptions`, `id` or award-amount field. A promotion
 * always starts DRAFT, redemption counts are server state, and **no award value exists** because no
 * business rule defines one. `forbidNonWhitelisted` turns any such field into a 400.
 */
export class CreatePromotionDto {
  @Matches(/^[A-Za-z0-9_-]{3,40}$/, { message: 'code must be 3–40 chars of A–Z, 0–9, - or _' })
  code!: string;

  @IsString() @MinLength(2) @MaxLength(150) name!: string;
  @IsEnum(PromotionType) type!: PromotionType;

  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000) priority?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxRedemptions?: number;
  @IsOptional() @IsISO8601() startsAt?: string;
  @IsOptional() @IsISO8601() endsAt?: string;
  /** Free-form eligibility/terms. Descriptive only — nothing here triggers a payment. */
  @IsOptional() @IsObject() terms?: Record<string, unknown>;
}

export class UpdatePromotionDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(150) name?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000) priority?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxRedemptions?: number;
  @IsOptional() @IsISO8601() startsAt?: string;
  @IsOptional() @IsISO8601() endsAt?: string;
  @IsOptional() @IsObject() terms?: Record<string, unknown>;
}

export class SetPromotionStatusDto {
  @IsEnum(PromotionStatus) status!: PromotionStatus;
}

export class ListPromotionsDto {
  @IsOptional() @IsEnum(PromotionStatus) status?: PromotionStatus;
  @IsOptional() @IsEnum(PromotionType) type?: PromotionType;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

/* -------------------------------------------------------------- player API */

/**
 * Promotions a player can actually see.
 *
 * Returns only genuinely ACTIVE, in-window, non-exhausted promotions — never a hardcoded list. The
 * response also states that awarding is unavailable, so the UI cannot imply the player has earned
 * anything.
 */
@ApiTags('Promotions')
@ApiBearerAuth()
@Controller('promotions')
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get()
  @ApiOperation({ summary: 'Currently active promotions (published offers, not awards)' })
  active() {
    return this.promotions.listActiveForPlayer();
  }
}

/* --------------------------------------------------------------- admin API */

/**
 * Promotion administration.
 *
 * Read needs `settings:read`; every mutation needs `settings:write` (super-admin). Promotions are
 * platform configuration, so the existing settings permissions are the correct fit — no new
 * permission was invented, and no financial permission is involved because nothing here moves money.
 */
@ApiTags('Promotions')
@ApiBearerAuth()
@Controller('admin/promotions')
export class AdminPromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_READ)
  @ApiOperation({ summary: 'List promotions with filters' })
  list(@Query() q: ListPromotionsDto) {
    return this.promotions.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.SETTINGS_READ)
  @ApiOperation({ summary: 'One promotion' })
  get(@Param('id') id: string) {
    return this.promotions.getById(id);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SETTINGS_WRITE)
  @ApiOperation({ summary: 'Create a promotion (always DRAFT, audited)' })
  create(@CurrentUser('id') actorUserId: string, @Body() dto: CreatePromotionDto) {
    return this.promotions.create({ ...dto, actorUserId });
  }

  @Post(':id/update')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SETTINGS_WRITE)
  @ApiOperation({ summary: 'Edit a promotion (audited)' })
  update(@Param('id') id: string, @CurrentUser('id') actorUserId: string, @Body() dto: UpdatePromotionDto) {
    return this.promotions.update(id, { ...dto, actorUserId });
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SETTINGS_WRITE)
  @ApiOperation({ summary: 'Activate / pause / end a promotion (validated transitions, audited)' })
  setStatus(@Param('id') id: string, @CurrentUser('id') actorUserId: string, @Body() dto: SetPromotionStatusDto) {
    return this.promotions.setStatus(id, dto.status, actorUserId);
  }
}
