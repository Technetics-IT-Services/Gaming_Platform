import { Body, Controller, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '@gaming-platform/types';
import type { Request } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReqMeta } from '../../common/decorators/request-meta.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import type { RequestMeta } from '../../common/security/request-meta';
import { PERMISSIONS } from '../authorization/rbac.constants';
import { CashierService, type OperatorActor } from './cashier.service';
import { RejectReasonDto } from './dto/cashier.dto';

/**
 * Operator cashier transitions (Phase 2C.9) — RBAC-gated (`WALLETS_ADJUST`). All money movement reuses
 * the frozen `WalletEngineService`: completing a deposit credits; rejecting/cancelling a held withdrawal
 * refunds. Deposits are never auto-credited — this is the honest completion path (no payment gateway).
 */
@ApiTags('Admin · Cashier')
@ApiBearerAuth()
@Controller('admin/cashier')
export class AdminCashierController {
  constructor(private readonly cashier: CashierService) {}

  /**
   * Build the operator actor for the audit trail (Phase 2C.17, P0-3). Every field comes from the
   * authenticated principal, the request-id middleware or the connection metadata - NEVER from the
   * request body, so an operator cannot spoof who they are or what role they hold.
   */
  private actor(user: AuthenticatedUser, meta: RequestMeta, req: Request): OperatorActor {
    return {
      id: user.id,
      roles: user.roles ?? [],
      requestId: (req as Request & { id?: string }).id ?? null,
      meta,
    };
  }

  @Post('deposits/:id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.WALLETS_ADJUST)
  @ApiOperation({ summary: 'Complete a PENDING deposit → credit the wallet (authoritative)' })
  completeDeposit(
    @CurrentUser() user: AuthenticatedUser,
    @ReqMeta() meta: RequestMeta,
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.cashier.completeDeposit(id, this.actor(user, meta, req));
  }

  @Post('deposits/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.WALLETS_ADJUST)
  @ApiOperation({ summary: 'Reject a deposit (no money moved)' })
  rejectDeposit(
    @CurrentUser() user: AuthenticatedUser,
    @ReqMeta() meta: RequestMeta,
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: RejectReasonDto,
  ) {
    return this.cashier.rejectDeposit(id, dto.reason, this.actor(user, meta, req));
  }

  @Post('withdrawals/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.WALLETS_ADJUST)
  @ApiOperation({ summary: 'Approve a held withdrawal (funds already held; no money moves)' })
  approveWithdrawal(
    @CurrentUser() user: AuthenticatedUser,
    @ReqMeta() meta: RequestMeta,
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.cashier.approveWithdrawal(id, this.actor(user, meta, req));
  }

  @Post('withdrawals/:id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.WALLETS_ADJUST)
  @ApiOperation({ summary: 'Complete a withdrawal (funds already debited on request)' })
  completeWithdrawal(
    @CurrentUser() user: AuthenticatedUser,
    @ReqMeta() meta: RequestMeta,
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.cashier.completeWithdrawal(id, this.actor(user, meta, req));
  }

  @Post('withdrawals/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.WALLETS_ADJUST)
  @ApiOperation({ summary: 'Reject a held withdrawal → refund the held funds' })
  rejectWithdrawal(
    @CurrentUser() user: AuthenticatedUser,
    @ReqMeta() meta: RequestMeta,
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: RejectReasonDto,
  ) {
    return this.cashier.rejectWithdrawal(id, dto.reason, this.actor(user, meta, req));
  }
}
