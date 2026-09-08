import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WalletTransactionService } from '../wallet-engine/services/wallet-transaction.service';
import { WalletHistoryQueryDto } from './dto/wallet-history-query.dto';
import { WalletService } from './wallet.service';

@ApiTags('Wallet')
@ApiBearerAuth()
@Controller('wallet')
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly transactions: WalletTransactionService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List the authenticated user wallets' })
  myWallets(@CurrentUser('id') userId: string) {
    return this.walletService.findByUser(userId);
  }

  @Get('history')
  @ApiOperation({ summary: 'My wallet transaction history (server-authoritative; filter + paginate)' })
  history(@CurrentUser('id') userId: string, @Query() query: WalletHistoryQueryDto) {
    // userId is ALWAYS from the JWT — never the client. Values come straight from persisted
    // WalletTransaction rows (balanceBefore/After are stored, never recomputed).
    return this.transactions.list(userId, query);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Balance summary across all wallets' })
  summary(@CurrentUser('id') userId: string) {
    return this.walletService.summary(userId);
  }

  @Get(':currencyId')
  @ApiOperation({ summary: 'Get (or create) a wallet by currency for the user' })
  byCurrency(@CurrentUser('id') userId: string, @Param('currencyId') currencyId: string) {
    return this.walletService.findByCurrency(userId, currencyId);
  }
}
