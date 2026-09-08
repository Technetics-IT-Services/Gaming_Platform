import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

import { AnalyticsQueryDto } from './analytics-query.dto';
import { REPORT_TYPES, type ReportType } from '../reports.service';

/**
 * Phase 2D.7 — report/export query.
 *
 * Extends the analytics query so a report honours EXACTLY the same filters, validation and range
 * ceiling as the dashboard it mirrors. `@IsIn` restricts the report type to the known set, so an
 * unknown or path-traversal-shaped value (`../../etc/passwd`) is a `400` at the validation pipe and
 * never reaches the service, let alone a filename.
 *
 * The global pipe runs `whitelist + forbidNonWhitelisted`, so `userId`, `role` and `permissions`
 * remain unaccepted here exactly as they are on the analytics routes.
 */
export class ReportQueryDto extends AnalyticsQueryDto {
  @ApiProperty({ enum: REPORT_TYPES, description: 'Which report to build' })
  @IsIn(REPORT_TYPES as unknown as string[])
  type!: ReportType;
}
