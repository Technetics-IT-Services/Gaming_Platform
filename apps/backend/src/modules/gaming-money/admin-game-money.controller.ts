import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../authorization/rbac.constants';
import { GameMoneyHistoryService } from './game-money-history.service';

/**
 * Admin game-round investigation (Phase 2C.4). Read-only. Replaces manual DB investigation: one
 * call returns the round + player + wallet + reservation + transactions + ledger + recovery state.
 * Permission-gated (`wallets:read`); never exposes secrets (provably-fair secrets are redacted while
 * a round is still in flight, exactly as for the player view). No money movement.
 */
@ApiTags('Admin · Games (money)')
@ApiBearerAuth()
@Controller('admin/games')
export class AdminGameMoneyController {
  constructor(private readonly history: GameMoneyHistoryService) {}

  @Get('rounds/:roundId')
  @RequirePermissions(PERMISSIONS.WALLETS_READ)
  @ApiOperation({ summary: 'Investigate a game round: round + player + wallet + transactions + ledger + recovery' })
  round(@Param('roundId') roundId: string) {
    return this.history.adminRoundDetails(roundId);
  }
}
