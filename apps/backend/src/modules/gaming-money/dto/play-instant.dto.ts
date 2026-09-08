import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, Matches, Max, Min, MaxLength, MinLength } from 'class-validator';

/**
 * Real-money instant-game play requests (Phase 2C.7 — Limbo · Coin Flip · Wheel). One play = one
 * reservation + one settlement via the generic instant-game bridge method. The server derives userId
 * (JWT), the provably-fair outcome, the multiplier, the payout and the balance. The client may ONLY
 * choose its game selection + stake/currency (+ optional seed) — never the result, multiplier,
 * payout, balance, walletId, userId or serverSeed. `whitelist + forbidNonWhitelisted` rejects any
 * extra field with a 400.
 */
abstract class InstantPlayBase {
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

  @ApiProperty({ example: '3f1c…-uuid', description: 'Idempotency key — identical key returns the same play' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;
}

/** Limbo — the player bets the generated multiplier will reach at least `target` (≥ 1.01). */
export class PlayLimboDto extends InstantPlayBase {
  @ApiProperty({ example: 2, minimum: 1.01, maximum: 1_000_000, description: 'Target multiplier' })
  @IsNumber()
  @Min(1.01)
  @Max(1_000_000)
  target!: number;
}

/** Coin Flip — the player calls heads or tails. */
export class PlayCoinFlipDto extends InstantPlayBase {
  @ApiProperty({ example: 'heads', enum: ['heads', 'tails'], description: 'Called side' })
  @IsIn(['heads', 'tails'])
  side!: 'heads' | 'tails';
}

/** Wheel — the player picks a risk level; the wheel lands on a segment multiplier. */
export class PlayWheelDto extends InstantPlayBase {
  @ApiProperty({ example: 'medium', enum: ['low', 'medium', 'high'], description: 'Risk level' })
  @IsIn(['low', 'medium', 'high'])
  risk!: 'low' | 'medium' | 'high';
}
