import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Cashier request DTOs (Phase 2C.9). The client sends ONLY amount/currency (+ optional method/seed) and
 * an idempotency key — never balance, status, walletId, userId, transactionId, or approval state (all
 * server-derived). `whitelist + forbidNonWhitelisted` rejects any extra field with a 400.
 */
export class CreateDepositDto {
  @ApiProperty({ example: '500.00', description: 'Deposit amount (decimal string)' })
  @Matches(/^\d{1,12}(\.\d{1,8})?$/, { message: 'amount must be a positive decimal' })
  amount!: string;

  @ApiProperty({ example: 'INR', description: 'Currency code' })
  @IsString()
  @MinLength(3)
  @MaxLength(8)
  currency!: string;

  @ApiProperty({ required: false, description: 'Optional payment method label (display only)' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  method?: string;

  @ApiProperty({ example: '3f1c…-uuid', description: 'Idempotency key — identical key returns the same request' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;
}

export class CreateWithdrawalDto {
  @ApiProperty({ example: '200.00', description: 'Withdrawal amount (decimal string)' })
  @Matches(/^\d{1,12}(\.\d{1,8})?$/, { message: 'amount must be a positive decimal' })
  amount!: string;

  @ApiProperty({ example: 'INR', description: 'Currency code' })
  @IsString()
  @MinLength(3)
  @MaxLength(8)
  currency!: string;

  @ApiProperty({ required: false, description: 'Optional payout method label (display only)' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  method?: string;

  @ApiProperty({ example: '3f1c…-uuid', description: 'Idempotency key — identical key returns the same request' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;
}

export class RejectReasonDto {
  @ApiProperty({ required: false, description: 'Optional reason (operator note)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
