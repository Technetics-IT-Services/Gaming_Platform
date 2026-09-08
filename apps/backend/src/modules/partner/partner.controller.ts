import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PartnerStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { safeFilename, toCsv, UTF8_BOM } from '../analytics/csv.util';
import { PERMISSIONS } from '../authorization/rbac.constants';
import { PartnerService } from './partner.service';

/* -------------------------------------------------------------------- DTOs */

/**
 * Creating a partner takes a name, an optional starting share and notes.
 *
 * It deliberately has NO status, code, balance, profit or member field. The global pipe runs
 * `forbidNonWhitelisted`, so an operator cannot smuggle in a status or a fabricated balance, and a
 * partner code is always generated server-side.
 */
export class CreatePartnerDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;

  @IsOptional()
  @Matches(/^(100(\.0{1,4})?|\d{1,2}(\.\d{1,4})?)$/, { message: 'revenueSharePercent must be 0–100 with up to 4 decimals' })
  revenueSharePercent?: string;

  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class SetShareDto {
  @Matches(/^(100(\.0{1,4})?|\d{1,2}(\.\d{1,4})?)$/, { message: 'percent must be 0–100 with up to 4 decimals' })
  percent!: string;
}

export class SetStatusDto {
  @IsEnum(PartnerStatus) status!: PartnerStatus;
}

export class AddMemberDto {
  @IsUUID() userId!: string;
  @IsOptional() @IsEnum(['true', 'false'] as unknown as object) isPrimary?: 'true' | 'false';
}

export class ListPartnersDto {
  @IsOptional() @IsEnum(PartnerStatus) status?: PartnerStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

/**
 * A partner's own report window. There is deliberately no `partnerId` field: the organisation is
 * resolved from the authenticated caller, so no partner can address another's history.
 */
export class PartnerReportQueryDto {
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
}

/* ------------------------------------------------------------- partner API */

/**
 * A partner's OWN view.
 *
 * Guarded by `partners:read_own`, which only the `partner` role holds. Neither route accepts a
 * partner id: the caller's organisation is resolved from `PartnerUser.userId` (unique), so one
 * partner cannot address another. Isolation is structural.
 *
 * Financial figures a partner would expect — profit, balance, withdrawals — are returned as
 * explicitly UNAVAILABLE with the missing business definition named, never as zero.
 */
@ApiTags('Partner')
@ApiBearerAuth()
@Controller('partner')
@RequirePermissions(PERMISSIONS.PARTNERS_READ_OWN)
export class PartnerController {
  constructor(private readonly partners: PartnerService) {}

  @Get()
  @ApiOperation({ summary: "The caller's own partner organisation" })
  me(@CurrentUser('id') userId: string) {
    return this.partners.myPartner(userId);
  }

  @Get('dashboard')
  @ApiOperation({ summary: "The caller's partner dashboard (with honest unavailable figures)" })
  dashboard(@CurrentUser('id') userId: string) {
    return this.partners.myDashboard(userId);
  }

  @Get('members')
  @ApiOperation({ summary: "The caller's own organisation members (usernames only, no user ids)" })
  myMembers(@CurrentUser('id') userId: string) {
    return this.partners.myMembers(userId);
  }

  @Get('report')
  @ApiOperation({
    summary:
      "The caller's own partner activity report (PA-07): recorded changes to their organisation. " +
      'Contains no financial column — partner money remains blocked on the revenue definition.',
  })
  report(@CurrentUser('id') userId: string, @Query() query: PartnerReportQueryDto) {
    return this.partners.myActivityReport(userId, query);
  }

  /**
   * The same report as a CSV download, reusing the injection-safe writer proven in Phase 2D.7.
   *
   * The partner id is never taken from the request — the service resolves it from the authenticated
   * caller, exactly as the JSON route does, so the export cannot be pointed at another partner.
   */
  @Get('report.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'no-store')
  async reportCsv(
    @CurrentUser('id') userId: string,
    @Query() query: PartnerReportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.partners.myActivityReport(userId, query);
    const csv =
      UTF8_BOM +
      toCsv(
        ['recorded_at', 'action', 'changed_fields', 'summary'],
        report.events.map((e) => [e.at, e.action, e.changed.join(' '), e.summary]),
      );
    const name = safeFilename(`partner-activity-${report.partner.code}-${report.to.slice(0, 10)}.csv`);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Content-Length', Buffer.byteLength(csv, 'utf8'));
    res.end(csv);
  }
}

/* --------------------------------------------------------------- admin API */

/**
 * Operator partner administration.
 *
 * READ is available to `admin` and `super_admin` (`partners:read`).
 * WRITE — creating partners, changing ownership percentages, status and membership — requires
 * `partners:write`, which **only `super_admin` holds**, because the client enumeration lists
 * "manage partners" and "change partner percentages" under SUPER ADMIN.
 */
@ApiTags('Partner')
@ApiBearerAuth()
@Controller('admin/partners')
export class AdminPartnerController {
  constructor(private readonly partners: PartnerService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PARTNERS_READ)
  @ApiOperation({ summary: 'List partners with the current share allocation' })
  list(@Query() q: ListPartnersDto) {
    return this.partners.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PARTNERS_READ)
  @ApiOperation({ summary: 'One partner' })
  get(@Param('id') id: string) {
    return this.partners.getById(id);
  }

  @Get(':id/members')
  @RequirePermissions(PERMISSIONS.PARTNERS_READ)
  @ApiOperation({ summary: 'Users linked to a partner' })
  members(@Param('id') id: string) {
    return this.partners.members(id);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.PARTNERS_WRITE)
  @ApiOperation({ summary: 'Create a partner (super-admin only, audited)' })
  create(@CurrentUser('id') actorUserId: string, @Body() dto: CreatePartnerDto) {
    return this.partners.create({ ...dto, actorUserId });
  }

  @Post(':id/share')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.PARTNERS_WRITE)
  @ApiOperation({ summary: 'Set ownership percentage (super-admin only, Σ ≤ 100 enforced, audited)' })
  setShare(@Param('id') id: string, @CurrentUser('id') actorUserId: string, @Body() dto: SetShareDto) {
    return this.partners.setShare(id, dto.percent, actorUserId);
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.PARTNERS_WRITE)
  @ApiOperation({ summary: 'Change partner status (super-admin only, audited)' })
  setStatus(@Param('id') id: string, @CurrentUser('id') actorUserId: string, @Body() dto: SetStatusDto) {
    return this.partners.setStatus(id, dto.status, actorUserId);
  }

  @Post(':id/members')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.PARTNERS_WRITE)
  @ApiOperation({ summary: 'Link an existing user to a partner and grant the partner role' })
  addMember(@Param('id') id: string, @CurrentUser('id') actorUserId: string, @Body() dto: AddMemberDto) {
    return this.partners.addMember(id, dto.userId, actorUserId, dto.isPrimary === 'true');
  }
}
