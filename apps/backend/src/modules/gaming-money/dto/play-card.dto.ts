import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Real-money card-game play request (Phase 2C.7 — Dragon Tiger · Andar Bahar · Teen Patti). One play =
 * one reservation (total stake) + one settlement via the generic `playCard` bridge method over the
 * authoritative card-engine presets. The server derives userId (JWT), deals the cards, picks the
 * winner and computes the payout/balance. The client may ONLY choose its bets + currency (+ optional
 * seed) — never the hands, winner, payout, balance, walletId, userId or serverSeed. The `variant`
 * comes from the route, not the body. `whitelist + forbidNonWhitelisted` rejects any extra field.
 */
export class CardBetDto {
  @ApiProperty({ example: 'dragon', description: 'Bet key (must be a valid bet for the variant)' })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  type!: string;

  @ApiProperty({ example: '10.00', description: 'Bet amount (decimal string)' })
  @Matches(/^\d{1,12}(\.\d{1,8})?$/, { message: 'amount must be a positive decimal' })
  amount!: string;
}

export class PlayCardDto {
  @ApiProperty({ type: [CardBetDto], description: 'One or more bets on this round' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CardBetDto)
  bets!: CardBetDto[];

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

  @ApiProperty({ example: '3f1c…-uuid', description: 'Idempotency key — identical key returns the same play' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;
}
