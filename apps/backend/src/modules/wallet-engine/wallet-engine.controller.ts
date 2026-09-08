import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WalletType } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WalletEngineService } from './services/wallet-engine.service';
import { WalletBalanceService } from './services/wallet-balance.service';
import { WalletTransactionService } from './services/wallet-transaction.service';
import { BonusWalletService } from './services/bonus-wallet.service';
import { RewardWalletService } from './services/reward-wallet.service';
// `GrantBonusDto` is deliberately no longer imported — see the removal note at the end of the class.
// The class itself is left in `wallet.dto.ts` untouched: deleting it would be an unrelated edit to a
// frozen file, and an unused exported type carries no runtime surface.
import { RewardPointsDto, TransactionQueryDto, TransferDto } from './dto/wallet.dto';

@ApiTags('Wallet Engine')
@ApiBearerAuth()
@Controller('wallet-engine')
export class WalletEngineController {
  constructor(
    private readonly engine: WalletEngineService,
    private readonly balances: WalletBalanceService,
    private readonly transactions: WalletTransactionService,
    private readonly bonus: BonusWalletService,
    private readonly rewards: RewardWalletService,
  ) {}

  @Get('balances')
  @ApiOperation({ summary: 'Get all wallet balances for the authenticated user' })
  myBalances(@CurrentUser('id') userId: string) {
    return this.balances.summary(userId);
  }

  @Get('wallets/:currencyId')
  @ApiOperation({ summary: 'Get (or create) the main wallet for a currency' })
  wallet(@CurrentUser('id') userId: string, @Param('currencyId') currencyId: string) {
    return this.engine.getOrCreateWallet(userId, currencyId, WalletType.MAIN);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'List my transaction history (filter + paginate)' })
  history(@CurrentUser('id') userId: string, @Query() query: TransactionQueryDto) {
    return this.transactions.list(userId, query);
  }

  @Get('transactions/:id')
  @ApiOperation({ summary: 'Get a transaction by id' })
  transaction(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.transactions.findById(userId, id);
  }

  @Post('transfer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transfer funds between my wallet types' })
  transfer(@CurrentUser('id') userId: string, @Body() dto: TransferDto) {
    return this.engine.transfer(
      userId,
      dto.currencyId,
      dto.fromType as WalletType,
      dto.toType as WalletType,
      dto.amount,
      dto.idempotencyKey,
    );
  }

  // ---- Bonus & reward wallets ----------------------------------------------

  @Get('bonus')
  @ApiOperation({ summary: 'List my bonus wallets' })
  bonusWallets(@CurrentUser('id') userId: string) {
    return this.bonus.list(userId);
  }

  @Post('bonus/:id/convert')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Convert a cleared bonus into the main wallet' })
  convertBonus(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.bonus.convert(userId, id);
  }

  @Get('reward')
  @ApiOperation({ summary: 'Get my reward (loyalty) wallet' })
  reward(@CurrentUser('id') userId: string) {
    return this.rewards.get(userId);
  }

  @Post('reward/redeem')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Redeem loyalty points' })
  redeem(@CurrentUser('id') userId: string, @Body() dto: RewardPointsDto) {
    return this.rewards.redeem(userId, dto.points);
  }

  /*
   * REMOVED in Phase 2D.11 — `POST /wallet-engine/grant-bonus` (CRITICAL authorization defect).
   *
   * The route granted a bonus to `@CurrentUser('id')` — the caller — with a client-supplied amount
   * and a client-supplied wagering requirement, and carried NO permission guard. Any authenticated
   * player could therefore grant themselves an arbitrary bonus and convert it into withdrawable
   * main-wallet funds. Reproduced live on 2026-09-07: a `user`-role account created ₹1,000,000 in
   * two HTTP calls.
   *
   * It could not be *guarded* in place without also changing its shape: the route has no `userId`,
   * so an authorized version would have to grant TO a named player — which is exactly what
   * `POST /admin/bonuses` already does (requires `wallets:adjust`, idempotent on an operator
   * reference, audited to the acting operator). Guarding here would have created a second source of
   * truth for the same operation, so the route was removed instead. No caller existed anywhere in
   * this repository.
   *
   * WALLET ACCOUNTING IS UNCHANGED. `BonusWalletService`, `WalletEngineService`, the ledger and
   * settlement were not touched: this deletes an entry point, not a calculation.
   *
   * See docs/FROZEN_CHANGE_PROPOSAL_2D10_GRANT_BONUS.md and docs/PHASE_2D11_SECURITY_FIX.md.
   */
}
