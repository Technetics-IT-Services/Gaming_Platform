import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Real-money Plinko play request (Phase 2C.6). One drop = one reservation + one settlement. The
 * server derives userId (JWT), the ball path, the landing bin, the multiplier, the payout and the
 * balance. The client may ONLY choose rows/risk/stake/currency (+ optional seed) — never the bin,
 * multiplier, payout, result, balance, walletId or userId.
 */
export class PlayPlinkoDto {
  @ApiProperty({ example: 16, enum: [8, 10, 12, 14, 16], description: 'Board rows' })
  @IsInt()
  @IsIn([8, 10, 12, 14, 16])
  rows!: number;

  @ApiProperty({ example: 'medium', enum: ['low', 'medium', 'high'], description: 'Risk (board shape)' })
  @IsIn(['low', 'medium', 'high'])
  risk!: 'low' | 'medium' | 'high';

  @ApiProperty({ example: '10.00', description: 'Stake (decimal string)' })
  @Matches(/^\d{1,12}(\.\d{1,8})?$/, { message: 'stake must be a positive decimal' })
  stake!: string;

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

  @ApiProperty({ example: '3f1c…-uuid', description: 'Idempotency key — identical key returns the same drop' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;
}
