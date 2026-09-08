import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SetMetadata } from '@nestjs/common';

import { ResponsibleGamingService } from './responsible-gaming.service';

/** What a route does with money, so the guard knows which checks apply. */
export type RgAction = 'WAGER' | 'DEPOSIT';

export const RG_ACTION_KEY = 'rg:action';

/**
 * Mark a route as a money/game entry point that responsible-gaming controls must gate.
 *
 * Applied at CONTROLLER level so a newly added play route is covered by default — the failure mode
 * of an opt-in decorator is a route someone forgets to annotate, which is exactly the gap this
 * control exists to close.
 */
export const RgProtected = (action: RgAction): MethodDecorator & ClassDecorator =>
  // MUST be Nest's SetMetadata, not `Reflect.metadata`. `Reflect.metadata` attaches method metadata
  // to (prototype, propertyKey), while `Reflector` reads a handler's metadata from the FUNCTION
  // object — so a method-level `Reflect.metadata` decorator is silently invisible to the guard.
  // A live test caught exactly that: the class-level marker on the games controller worked while the
  // method-level marker on `POST /cashier/deposits` did not, leaving deposit limits unenforced.
  SetMetadata(RG_ACTION_KEY, action);

/**
 * Enforces responsible-gaming controls BEFORE any money or game action begins.
 *
 * WHY A GUARD, AND NOT A CHANGE INSIDE THE MONEY CORE
 *
 * The requirement is that enforcement happen before money moves. A Nest guard runs before the route
 * handler, therefore before `GameMoneyBridge` or `CashierService` is ever called — so the control is
 * genuinely upstream of every reservation, debit and ledger write.
 *
 * Doing it here rather than inside `WalletEngine`/`GameMoneyBridge` was a deliberate choice: those
 * are frozen, certified financial paths, and this control does not need to live inside them to be
 * effective. The additive layer satisfies the requirement without touching a single line of the
 * money core. (Documented in FINAL_IMPLEMENTATION_REPORT.md.)
 *
 * WHAT IT READS
 *
 * The stake/amount comes from the validated request body (`stake` or `amount`) and the currency from
 * `currency`/`currencyCode`. These are the SAME values the handler will act on. The guard never
 * trusts a client-supplied user id — identity always comes from the authenticated principal.
 *
 * FAIL CLOSED: if the body carries no recognisable amount, restriction checks still run. A
 * self-excluded player is blocked from a route whose shape this guard does not recognise.
 */
@Injectable()
export class ResponsibleGamingGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rg: ResponsibleGamingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const action = this.reflector.getAllAndOverride<RgAction | undefined>(RG_ACTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!action) return true;

    const req = context.switchToHttp().getRequest<{
      method?: string;
      user?: { id?: string };
      body?: Record<string, unknown>;
    }>();

    // Read-only routes on a protected controller (configs, history) are not money actions.
    if (req.method && req.method !== 'POST') return true;

    const userId = req.user?.id;
    if (!userId) return true; // unauthenticated — the auth guard is the authority, not this one

    const body = req.body ?? {};
    const amount = this.readAmount(body);
    const currency = this.readCurrency(body);

    if (action === 'DEPOSIT') {
      if (amount && currency) {
        await this.rg.assertCanDeposit(userId, amount, currency);
      } else {
        await this.rg.assertNotRestricted(userId, 'Depositing');
      }
      return true;
    }

    if (amount && currency) {
      await this.rg.assertCanWager(userId, amount, currency);
    } else {
      // Blackjack HIT/STAND, crash cash-out and similar continue an ALREADY-STAKED round. Their
      // stake was checked when the round started, so re-charging it against the cap here would
      // double-count. Restrictions still apply.
      await this.rg.assertNotRestricted(userId, 'Playing');
    }
    return true;
  }

  private readAmount(body: Record<string, unknown>): string | null {
    for (const key of ['stake', 'amount']) {
      const v = body[key];
      if (typeof v === 'string' && /^\d{1,20}(\.\d{1,8})?$/.test(v)) return v;
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) return String(v);
    }
    return null;
  }

  private readCurrency(body: Record<string, unknown>): string | null {
    for (const key of ['currency', 'currencyCode']) {
      const v = body[key];
      if (typeof v === 'string' && /^[A-Za-z]{3,8}$/.test(v)) return v;
    }
    return null;
  }
}
