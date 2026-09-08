import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponsibleGamingGuard, RgProtected } from '../responsible-gaming/responsible-gaming.guard';
import { CashierService } from './cashier.service';
import { CreateDepositDto, CreateWithdrawalDto } from './dto/cashier.dto';

/**
 * Player cashier (Phase 2C.9) — server-authoritative deposits & withdrawals. Distinct `/cashier` prefix
 * so the list routes don't collide with `GET /wallet/:currencyId`. Identity is ALWAYS from the JWT
 * (`@CurrentUser('id')`); the client never supplies balance/status/walletId/userId/transactionId.
 */
@ApiTags('Cashier')
@ApiBearerAuth()
@Controller('cashier')
// Deposit limits, self-exclusion and cooling-off are enforced before a deposit request is created.
// WITHDRAWALS ARE DELIBERATELY NOT BLOCKED: a self-excluded player must still be able to take their
// own money out — trapping funds would be the opposite of player protection. The guard only acts on
// routes marked with an RG action, and `POST withdrawals` carries none.
@UseGuards(ResponsibleGamingGuard)
export class CashierController {
  constructor(private readonly cashier: CashierService) {}

  @Get('config')
  @ApiOperation({ summary: 'Cashier config (min/max, currencies) — display only; server validates' })
  config() {
    return this.cashier.config();
  }

  @Post('deposits')
  @RgProtected('DEPOSIT')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a deposit (PENDING — credited only when an operator completes it)' })
  createDeposit(@CurrentUser('id') userId: string, @Body() dto: CreateDepositDto) {
    return this.cashier.createDeposit(userId, dto);
  }

  @Get('deposits')
  @ApiOperation({ summary: "The caller's deposit requests" })
  listDeposits(@CurrentUser('id') userId: string, @Query('limit') limit?: string) {
    return this.cashier.listDeposits(userId, limit ? Number(limit) : 20);
  }

  @Get('deposits/:id')
  @ApiOperation({ summary: 'One of the caller’s deposit requests' })
  getDeposit(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.cashier.getDeposit(userId, id);
  }

  @Post('withdrawals')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a withdrawal (funds are held immediately; server-authoritative)' })
  createWithdrawal(@CurrentUser('id') userId: string, @Body() dto: CreateWithdrawalDto) {
    return this.cashier.createWithdrawal(userId, dto);
  }

  @Get('withdrawals')
  @ApiOperation({ summary: "The caller's withdrawal requests" })
  listWithdrawals(@CurrentUser('id') userId: string, @Query('limit') limit?: string) {
    return this.cashier.listWithdrawals(userId, limit ? Number(limit) : 20);
  }

  @Get('withdrawals/:id')
  @ApiOperation({ summary: 'One of the caller’s withdrawal requests' })
  getWithdrawal(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.cashier.getWithdrawal(userId, id);
  }

  @Post('withdrawals/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a still-pending withdrawal → the held funds are refunded' })
  cancelWithdrawal(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.cashier.cancelWithdrawal(userId, id);
  }
}
