import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Real-money dice play request (Phase 2B). The server derives EVERYTHING financial —
 * userId (from the JWT), wallet, result and payout. The client may ONLY choose the
 * variant, bet, stake, currency, optional client seed and an idempotency key. It may not
 * submit payout, balance, result, walletId, ledgerId or userId.
 */
export class PlayDiceDto {
  @ApiProperty({ example: 'sic-bo', description: 'Dice variant key' })
  @IsString()
  @MaxLength(64)
  variant!: string;

  @ApiProperty({ example: 'big', description: 'Bet type key from the variant board' })
  @IsString()
  @MaxLength(64)
  betType!: string;

  @ApiProperty({ example: '10.00', description: 'Stake amount (decimal string)' })
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

  @ApiProperty({ example: '3f1c…-uuid', description: 'Idempotency key — identical key returns the same round' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;
}
