import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';

/** A single Baccarat bet — a bet-type key from the engine board + a stake. */
export class BaccaratBetDto {
  @ApiProperty({ example: 'player', description: 'Bet type key (player / banker / tie)' })
  @IsString()
  @MaxLength(32)
  type!: string;

  @ApiProperty({ example: '10.00', description: 'Stake for this bet (decimal string)' })
  @Matches(/^\d{1,12}(\.\d{1,8})?$/, { message: 'amount must be a positive decimal' })
  amount!: string;
}

/**
 * Real-money Baccarat round request (Phase 2C.4). One round = one reservation + one settlement.
 * The server derives userId (JWT), total stake, cards, winning bets, payout and balance. The client
 * may ONLY submit its bets, currency, an optional client seed and an idempotency key.
 */
export class PlayBaccaratDto {
  @ApiProperty({ type: [BaccaratBetDto], description: 'One or more bets for this round' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => BaccaratBetDto)
  bets!: BaccaratBetDto[];

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
