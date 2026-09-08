import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

/** A single roulette bet. `selection` is required for inside `numbers` bets and dozen/column. */
export class RouletteBetDto {
  @ApiProperty({ example: 'red', description: 'Bet type key from the variant board' })
  @IsString()
  @MaxLength(32)
  type!: string;

  @ApiProperty({ example: '10.00', description: 'Stake for this bet (decimal string)' })
  @Matches(/^\d{1,12}(\.\d{1,8})?$/, { message: 'amount must be a positive decimal' })
  amount!: string;

  @ApiProperty({ required: false, type: [Number], example: [17], description: 'Covered numbers / group index' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(37, { each: true })
  selection?: number[];
}

/**
 * Real-money Roulette spin request (Phase 2C.2). One spin = one reservation + one settlement.
 * The server derives userId (JWT), total stake, winning pocket, payout and wallet balance. The
 * client may ONLY submit its bets, currency, an optional client seed and an idempotency key.
 */
export class PlayRouletteDto {
  @ApiProperty({ example: 'european', description: 'Roulette variant key' })
  @IsString()
  @MaxLength(64)
  variant!: string;

  @ApiProperty({ type: [RouletteBetDto], description: 'One or more bets for this spin' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RouletteBetDto)
  bets!: RouletteBetDto[];

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
