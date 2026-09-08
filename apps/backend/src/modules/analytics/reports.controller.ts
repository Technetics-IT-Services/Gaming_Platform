import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../authorization/rbac.constants';
import { safeFilename } from './csv.util';
import { ReportQueryDto } from './dto/report-query.dto';
import { REPORT_TYPES, ReportsService } from './reports.service';

/**
 * Phase 2D.7 — operator reports and CSV export. READ-ONLY, like the analytics beneath them.
 *
 * AUTHORIZATION (Part I). Guarded by the EXISTING `analytics:read` permission — the narrowest one
 * that fits, because a report exposes exactly the analytics data and nothing more. No new permission
 * was invented and no mutation permission is involved; `wallets:adjust` is emphatically NOT required
 * to read or export a report. The resulting matrix, verified live:
 *
 *   USER / VIP   → 403 (hold no permissions at all)
 *   MODERATOR    → 403 (holds audit:read and security:read, but NOT analytics:read)
 *   ADMIN        → 200 (ADMIN_PERMS includes analytics:read)
 *   SUPER_ADMIN  → 200 (ALL_PERMISSIONS)
 *
 * Being merely authenticated is never sufficient — the Phase 2D.2 rule.
 */
@ApiTags('Analytics')
@ApiBearerAuth()
@RequirePermissions(PERMISSIONS.ANALYTICS_READ)
@Controller('analytics/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('types')
  @ApiOperation({ summary: 'Report types this platform can truthfully produce' })
  types() {
    return { types: REPORT_TYPES };
  }

  @Get()
  @ApiOperation({ summary: 'Build a report as JSON (metadata envelope + columns + rows)' })
  build(@Query() query: ReportQueryDto) {
    const { type, ...filters } = query;
    return this.reports.build(type, filters);
  }

  /**
   * CSV export.
   *
   * `Content-Type` pins `charset=utf-8` (the body carries a BOM for spreadsheet compatibility) and
   * `X-Content-Type-Options: nosniff` stops a browser re-interpreting the download as HTML.
   *
   * The filename is composed from the validated report type and the resolved range and then passed
   * through `safeFilename`, so no caller-influenced text can inject a path separator, quotes or a
   * CR/LF header break.
   */
  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'no-store')
  async exportCsv(@Query() query: ReportQueryDto, @Res() res: Response): Promise<void> {
    const { type, ...filters } = query;
    const { csv, meta } = await this.reports.toCsvString(type, filters);

    const name = safeFilename(`${meta.reportType}-${meta.from.slice(0, 10)}_to_${meta.to.slice(0, 10)}.csv`);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Content-Length', Buffer.byteLength(csv, 'utf8'));
    res.end(csv);
  }
}
