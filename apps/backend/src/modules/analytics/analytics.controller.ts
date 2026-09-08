import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../authorization/rbac.constants';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

/**
 * Operator analytics (Phase 2D.6) — READ-ONLY.
 *
 * Guarded by the EXISTING `analytics:read` permission, which is already granted to `admin` and, via
 * `ALL_PERMISSIONS`, to `super_admin`. No new permission was introduced and no financial mutation
 * permission is involved. A player holds none of these and receives 403.
 *
 * Every route accepts only the whitelisted `AnalyticsQueryDto`; the global validation pipe
 * (`whitelist + forbidNonWhitelisted`) rejects any other property, so a `userId`, role or permission
 * cannot be smuggled in. No route accepts a user selector of any kind — these are platform-wide
 * operator metrics.
 *
 * Every response carries `meta.unavailable`, naming the metrics that CANNOT be truthfully derived and
 * why, so a dashboard renders "Not available" rather than a fabricated zero.
 */
@ApiTags('Analytics')
@ApiBearerAuth()
@RequirePermissions(PERMISSIONS.ANALYTICS_READ)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Full operator dashboard summary (gaming + financial + users + operations)' })
  summary(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.summary(query);
  }

  @Get('gaming')
  @ApiOperation({ summary: 'Gaming metrics derived from GameRound (game-level, one row per round)' })
  gaming(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.gaming(query);
  }

  @Get('financial')
  @ApiOperation({ summary: 'Ledger-level money movement, cashier volumes — per currency, never combined' })
  financial(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.financial(query);
  }

  @Get('users')
  @ApiOperation({ summary: 'User counts and real activity signals (NOT DAU/MAU — see meta.unavailable)' })
  users(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.users(query);
  }

  @Get('operations')
  @ApiOperation({ summary: 'Recovery health, audit, security-event and notification counts' })
  operations(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.operations(query);
  }

  @Get('daily')
  @ApiOperation({ summary: 'Daily UTC series for rounds and cashier. Days with no rows are absent, never zero-filled.' })
  daily(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.daily(query);
  }

  @Get('engagement')
  @ApiOperation({
    summary:
      'DAU / MAU from the activity-event pipeline (Phase 2D.9). Carries its own definitions and, ' +
      'because the pipeline has no backfill, states from which date the data is genuinely complete.',
  })
  engagement(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.engagement(query);
  }

  @Get('unavailable')
  @ApiOperation({ summary: 'Metrics that cannot be truthfully derived, with the missing source for each' })
  unavailable() {
    return { unavailable: this.analyticsService.unavailableMetrics() };
  }
}
