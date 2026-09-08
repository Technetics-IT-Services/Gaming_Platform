import { ApiPropertyOptional } from '@nestjs/swagger';
import { BadRequestException } from '@nestjs/common';
import { IsIn, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Analytics query filters (Phase 2D.6).
 *
 * All timestamps are interpreted and grouped in **UTC** — the database stores UTC and no timestamp is
 * reinterpreted. `whitelist + forbidNonWhitelisted` (global) rejects any unknown property, so a client
 * cannot smuggle a `userId`, a role, or an arbitrary filter through this DTO.
 */
export class AnalyticsQueryDto {
  @ApiPropertyOptional({ description: 'Inclusive start (ISO-8601, interpreted as UTC)' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Exclusive end (ISO-8601, interpreted as UTC)' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ description: 'Currency code, e.g. INR. Metrics are NEVER summed across currencies.' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(8)
  currency?: string;

  @ApiPropertyOptional({ description: 'Game key, e.g. dice' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  gameKey?: string;

  @ApiPropertyOptional({ description: 'Time-series granularity', enum: ['day'] })
  @IsOptional()
  @IsIn(['day'])
  granularity?: 'day';
}

/**
 * Default ceiling on the window analytics will scan, so one query cannot aggregate years of rows.
 *
 * Phase 2D.7 (Part B) made this configurable via `ANALYTICS_MAX_RANGE_DAYS`. It is an OPERATIONAL
 * SAFEGUARD, not a business rule — no client requirement specifies it. Callers pass the configured
 * value; this constant is the fallback when none is supplied.
 */
export const MAX_RANGE_DAYS = 366;

/** A validated, normalized UTC window. `to` is exclusive. */
export interface AnalyticsRange {
  from: Date;
  to: Date;
}

/**
 * Validate and normalize the requested window.
 *
 * Defaults to the last 30 days when unspecified. Rejects `from > to`, non-finite dates, and ranges
 * beyond {@link MAX_RANGE_DAYS}. A future `to` is allowed (it simply yields no rows) but a range that
 * *starts* in the future is rejected as a client error rather than silently returning zeros.
 */
export function resolveRange(
  query: { from?: string; to?: string },
  maxRangeDays: number = MAX_RANGE_DAYS,
): AnalyticsRange {
  const now = Date.now();
  const to = query.to ? new Date(query.to) : new Date(now);
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 24 * 60 * 60_000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new BadRequestException('from/to must be valid ISO-8601 timestamps');
  }
  if (from.getTime() > to.getTime()) {
    throw new BadRequestException('`from` must not be after `to`');
  }
  if (from.getTime() > now) {
    throw new BadRequestException('`from` must not be in the future');
  }
  const days = (to.getTime() - from.getTime()) / (24 * 60 * 60_000);
  if (days > maxRangeDays) {
    // REJECTED, never clamped: silently narrowing the window would return real numbers for a period
    // the caller did not ask about, and they would have no way to know.
    throw new BadRequestException(
      `Range must not exceed ${maxRangeDays} days (requested ${Math.ceil(days)}). ` +
        'The range was NOT truncated — narrow it and retry.',
    );
  }
  return { from, to };
}
