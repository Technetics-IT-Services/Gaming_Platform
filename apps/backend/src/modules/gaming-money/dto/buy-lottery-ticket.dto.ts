import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Real-money Number-Lottery ticket purchase (Phase 2C.3). The server derives userId (JWT),
 * the shared authoritative draw, the winning numbers, the prize and the wallet balance. The
 * client may ONLY submit its picked numbers (manual pick, or quick-pick generated client-side),
 * the currency, an optional target draw id and an idempotency key. Ticket price is the draw's —
 * never client-supplied. Winning numbers / prize are never accepted from the client.
 */
export class BuyLotteryTicketDto {
  @ApiProperty({ example: [4, 8, 15, 16, 23, 42], type: [Number], description: 'The picked numbers (distinct, in range for the draw)' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(99, { each: true })
  picks!: number[];

  @ApiProperty({ example: 'INR', description: 'Currency code (must match the draw)' })
  @IsString()
  @MinLength(3)
  @MaxLength(8)
  currency!: string;

  @ApiProperty({ required: false, description: 'Target draw id (defaults to the current open draw)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  drawId?: string;

  @ApiProperty({ example: '3f1c…-uuid', description: 'Idempotency key — identical key returns the same ticket' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;
}
