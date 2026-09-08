import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Real-money Mines start request (Phase 2C.6). The server derives userId (JWT), the authoritative
 * hidden mine board, the multiplier and the payout. The client may ONLY choose stake / mine count /
 * currency (+ optional seed) — never the board, multiplier, payout, result, balance or userId.
 */
export class StartMinesDto {
  @ApiProperty({ example: '10.00', description: 'Stake (decimal string)' })
  @Matches(/^\d{1,12}(\.\d{1,8})?$/, { message: 'stake must be a positive decimal' })
  stake!: string;

  @ApiProperty({ example: 3, minimum: 1, maximum: 24, description: 'Number of mines on the 5×5 board' })
  @IsInt()
  @Min(1)
  @Max(24)
  mines!: number;

  @ApiProperty({ example: 'INR', description: 'Currency code' })
  @IsString()
  @MinLength(3)
  @MaxLength(8)
  currency!: string;

  @ApiProperty({ required: false, description: 'Optional provably-fair client seed' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  clientSeed?: string;

  @ApiProperty({ example: '3f1c…-uuid', description: 'Idempotency key — identical key returns the same round' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;
}

/** Reveal one tile of an active Mines round. */
export class MinesRevealDto {
  @ApiProperty({ example: 7, minimum: 0, maximum: 24, description: 'Tile index to reveal (0–24)' })
  @IsInt()
  @Min(0)
  @Max(24)
  index!: number;
}
