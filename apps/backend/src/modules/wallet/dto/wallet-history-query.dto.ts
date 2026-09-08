import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Player wallet-history query (Phase 2C.4). Read-only. The userId is ALWAYS taken from the JWT
 * (`@CurrentUser('id')`) — never from the query. Filters: type / status / currency / ISO-8601 date
 * range. Pagination follows the platform convention (page ≥ 1, limit capped).
 */
export class WalletHistoryQueryDto {
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

  @ApiPropertyOptional({ description: 'Transaction type code (e.g. BET, WIN, RESERVE, DEPOSIT)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  type?: string;

  @ApiPropertyOptional({ description: 'Transaction status code (e.g. COMPLETED, RESERVED)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  status?: string;

  @ApiPropertyOptional({ description: 'Currency code (e.g. INR)' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @ApiPropertyOptional({ description: 'From (ISO-8601), inclusive — filters createdAt' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'To (ISO-8601), inclusive — filters createdAt' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
