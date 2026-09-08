import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';

/** A single Sic Bo bet — a bet-type key from the engine board + a stake. */
export class SicBoBetDto {
  @ApiProperty({ example: 'big', description: 'Bet type key from the Sic Bo board (e.g. big, single-6, triple-3, total-10, any-triple)' })
  @IsString()
  @MaxLength(32)
  type!: string;

  @ApiProperty({ example: '10.00', description: 'Stake for this bet (decimal string)' })
  @Matches(/^\d{1,12}(\.\d{1,8})?$/, { message: 'amount must be a positive decimal' })
  amount!: string;
}

/**
 * Real-money Sic Bo play request (Phase 2C.3). One board = one roll = one reservation + one
 * settlement. The server derives userId (JWT), total stake, dice, winning bets, payout and
 * balance. The client may ONLY submit its bets, currency, an optional client seed and an
 * idempotency key.
 */
export class PlaySicBoDto {
  @ApiProperty({ example: 'sic-bo', description: 'Sic Bo variant key' })
  @IsString()
  @MaxLength(64)
  variant!: string;

  @ApiProperty({ type: [SicBoBetDto], description: 'One or more bets for this roll' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SicBoBetDto)
  bets!: SicBoBetDto[];

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
