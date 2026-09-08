import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Real-money Blackjack start request (Phase 2C.4). The server derives userId (JWT), wallet, the
 * shoe, the cards and the payout. The client may ONLY submit its stake, currency, an optional
 * client seed and an idempotency key — never cards, payout, balance, result, walletId or userId.
 */
export class StartBlackjackDto {
  @ApiProperty({ example: '10.00', description: 'Stake for the hand (decimal string)' })
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

  @ApiProperty({ example: '3f1c…-uuid', description: 'Idempotency key — identical key returns the same hand' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;
}

/** A blackjack action on an active hand. Only engine-supported actions are accepted. */
export class BlackjackActionDto {
  @ApiProperty({ example: 'HIT', enum: ['HIT', 'STAND', 'DOUBLE'], description: 'The action (SPLIT/INSURANCE are not supported by the engine)' })
  @IsIn(['HIT', 'STAND', 'DOUBLE'])
  action!: 'HIT' | 'STAND' | 'DOUBLE';
}
