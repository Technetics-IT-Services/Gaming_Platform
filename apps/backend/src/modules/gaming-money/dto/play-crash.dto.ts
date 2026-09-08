import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Real-money Crash play request (Phase 2C.2). The server derives EVERYTHING financial —
 * userId (JWT), wallet, crash point, multiplier and payout. The client may ONLY choose the
 * variant, stake, currency, an optional auto cash-out target, an optional client seed and an
 * idempotency key. It may not submit payout, balance, result, crashPoint, walletId or userId.
 */
export class PlayCrashDto {
  @ApiProperty({ example: 'crash', description: 'Crash variant key' })
  @IsString()
  @MaxLength(64)
  variant!: string;

  @ApiProperty({ example: '10.00', description: 'Stake amount (decimal string)' })
  @Matches(/^\d{1,12}(\.\d{1,8})?$/, { message: 'stake must be a positive decimal' })
  stake!: string;

  @ApiProperty({ example: 'INR', description: 'Currency code' })
  @IsString()
  @MinLength(3)
  @MaxLength(8)
  currency!: string;

  @ApiProperty({ required: false, example: 2, description: 'Optional auto cash-out multiplier (>1)' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1_000_000)
  autoCashout?: number;

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

/** Cash out the caller's active crash round. */
export class CashoutCrashDto {
  @ApiProperty({ required: false, description: 'Round id (defaults to the caller\'s active crash round)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  roundId?: string;

  @ApiProperty({ required: false, description: 'Idempotency key for the cash-out' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}
