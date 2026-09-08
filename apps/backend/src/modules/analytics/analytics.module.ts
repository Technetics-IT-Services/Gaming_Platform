import { Module } from '@nestjs/common';

import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  controllers: [AnalyticsController, ReportsController],
  providers: [AnalyticsService, ReportsService],
  exports: [AnalyticsService, ReportsService],
})
export class AnalyticsModule {}
