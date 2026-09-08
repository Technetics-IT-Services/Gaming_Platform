import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReferralStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../authorization/rbac.constants';
import { ReferralService } from './referral.service';

/**
 * Claiming a referral carries ONLY a code.
 *
 * There is no `referrerId`, `status`, `qualifiedAt` or `userId` field — the referrer is resolved
 * from the code server-side and the caller is the authenticated principal, so neither end of the
 * relationship can be chosen by the client.
 */
export class ClaimReferralDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{4,32}$/, { message: 'code must be 4–32 characters of A–Z, 0–9, - or _' })
  code!: string;
}

export class ListReferralsDto {
  @IsOptional() @IsEnum(ReferralStatus) status?: ReferralStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

/**
 * Referral — the PLAYER's own.
 *
 * Both routes are scoped to `@CurrentUser('id')`. No route accepts a user id, so one player can
 * never read or alter another's referral relationships.
 */
@ApiTags('Referral')
@ApiBearerAuth()
@Controller('referral')
export class ReferralController {
  constructor(private readonly referral: ReferralService) {}

  @Get()
  @ApiOperation({ summary: "The caller's referral code, referrals and who referred them" })
  me(@CurrentUser('id') userId: string) {
    return this.referral.mySummary(userId);
  }

  @Post('claim')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record that the caller was referred by the owner of a code (idempotent)' })
  claim(@CurrentUser('id') userId: string, @Body() dto: ClaimReferralDto) {
    return this.referral.claim(userId, dto.code);
  }
}

/**
 * Referral — operator visibility.
 *
 * Read-only, behind the existing `users:read` permission: a referral relationship is user data, and
 * no new permission is warranted for viewing it. There is deliberately no operator route that
 * creates, qualifies or rewards a referral, because qualification and reward are BLOCKED on missing
 * business definitions.
 */
@ApiTags('Referral')
@ApiBearerAuth()
@Controller('admin/referrals')
@RequirePermissions(PERMISSIONS.USERS_READ)
export class AdminReferralController {
  constructor(private readonly referral: ReferralService) {}

  @Get()
  @ApiOperation({ summary: 'All referral relationships (read-only)' })
  list(@Query() q: ListReferralsDto) {
    return this.referral.list(q);
  }
}
