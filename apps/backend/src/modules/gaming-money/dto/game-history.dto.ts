import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Player game-history query (Phase 2C.4). Read-only. The userId is ALWAYS taken from the JWT
 * (`@CurrentUser('id')`) — never from the query. Filters: gameKey / status / ISO-8601 date range.
 * Pagination follows the platform convention (page ≥ 1, limit capped at 100).
 */
export class GameHistoryQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ description: 'Game key (e.g. dice, crash, roulette, sic-bo, baccarat, blackjack, number-lottery)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  gameKey?: string;

  @ApiPropertyOptional({ description: 'Round status (e.g. SETTLED, RESERVED, PENDING_SETTLEMENT)' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  status?: string;

  @ApiPropertyOptional({ description: 'From (ISO-8601), inclusive — filters createdAt' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'To (ISO-8601), inclusive — filters createdAt' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
