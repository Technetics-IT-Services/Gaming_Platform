import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GameRoundStatus, Prisma } from '@prisma/client';
import { CrashEngine, MultiplierManager, ProvablyFairCrashGenerator, type CrashBet } from '@gaming-platform/crash-engine';
import { type RouletteBet } from '@gaming-platform/roulette-engine';
import { type DiceBet } from '@gaming-platform/dice-engine';
import { countMatches } from '@gaming-platform/lottery-engine';
import { CardDeserializer, CardEngine, blackjackValue } from '@gaming-platform/card-engine';
import { PLINKO_RISKS, PLINKO_ROWS, playPlinko as computePlinkoDrop, type PlinkoRisk } from './engines/plinko-engine';
import { MINES_MAX, MINES_MIN, MINES_TILES, cashoutMultiplier, mineBoard, revealTile } from './engines/mines-engine';
import { INSTANT_GAMES, INSTANT_LIMITS, type InstantGameKey, parseInstantSelection, playInstant as computeInstant } from './engines/instant-engine';

import { PrismaService } from '../database/prisma.service';
import { DiceEngineService } from '../dice/services/dice-engine.service';
import { DiceVariantService } from '../dice/services/dice-variant.service';
import { CrashEngineService } from '../crash/services/crash-engine.service';
import { CrashVariantService } from '../crash/services/crash-variant.service';
import { RouletteEngineService } from '../roulette/services/roulette-engine.service';
import { RouletteVariantService } from '../roulette/services/roulette-variant.service';
import { CardEngineService } from '../card/services/card-engine.service';
import { CardVariantService } from '../card/services/card-variant.service';
import { ProvablyFairService } from '../runtime/services/provably-fair.service';
import { WalletEngineService } from '../wallet-engine/services/wallet-engine.service';

export interface PlayDiceInput {
  userId: string;
  variant: string;
  betType: string;
  stake: string;
  currencyCode: string;
  clientSeed?: string;
  idempotencyKey: string;
}

export interface PlayDiceResponse {
  roundId: string;
  game: 'dice';
  variant: string;
  betType: string;
  stake: string;
  currency: string;
  status: GameRoundStatus;
  result: { values: number[]; total: number; isTriple: boolean; won: boolean; winningBets: string[] };
  payout: string;
  balance: { available: string; total: string };
  reference: string;
  provablyFair: { serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number };
  replayed: boolean;
}

const GAME_KEY = 'dice';
const ROULETTE_KEY = 'roulette';
const CRASH_KEY = 'crash';
const SICBO_KEY = 'sic-bo';
const LOTTERY_KEY = 'number-lottery';
const BACCARAT_KEY = 'baccarat';
/**
 * Card variants enabled for generic real-money play (Phase 2C.7 approved P0 scope). The card-engine
 * supports many presets, but ONLY these are onboarded as money games — the generic `playCard` method
 * refuses any other key so out-of-scope presets (poker, texas-holdem, 32-cards, …) can never settle.
 */
const CARD_MONEY_VARIANTS = new Set(['dragon-tiger', 'andar-bahar', 'teen-patti']);
const BLACKJACK_KEY = 'blackjack';
const PLINKO_KEY = 'plinko';
const MINES_KEY = 'mines';
/** Per-round stake limits for the instant expansion games (Phase 2C.6). */
const PLINKO_LIMITS = { min: 1, max: 10000 };
const MINES_LIMITS = { min: 1, max: 10000 };
/** Upper bound on distinct bets in one roulette/sic-bo round (abuse guard). */
const MAX_BETS = 50;

/** Account statuses that may NOT wager (blocked). ACTIVE/PENDING are permitted. */
const BLOCKED_STATUSES = new Set(['SUSPENDED', 'BANNED', 'CLOSED', 'INACTIVE']);

/**
 * The reusable Game Money Bridge (Phase 2B).
 *
 * Orchestrates a single-shot authenticated money game by COMPOSING the existing frozen
 * services — it never re-implements game math, wallet balances or the ledger:
 *   validate player → resolve wallet/currency → validate stake → idempotency →
 *   atomic reserve (WalletEngine) → execute existing DiceEngine → atomic settle
 *   (commitReservation) → GameRound record.
 * Failure policy: engine failure after reserve → releaseReservation (stake refunded);
 * settlement failure → PENDING_SETTLEMENT (recoverable — commitReservation is idempotent).
 * No money moves except through WalletEngineService; no ledger row is written here.
 */
@Injectable()
export class GameMoneyBridgeService {
  private readonly logger = new Logger(GameMoneyBridgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletEngineService,
    private readonly dice: DiceEngineService,
    private readonly variants: DiceVariantService,
    private readonly crash: CrashEngineService,
    private readonly crashVariants: CrashVariantService,
    private readonly roulette: RouletteEngineService,
    private readonly rouletteVariants: RouletteVariantService,
    private readonly fair: ProvablyFairService,
    private readonly card: CardEngineService,
    private readonly cardVariants: CardVariantService,
  ) {}

  async playDice(input: PlayDiceInput): Promise<PlayDiceResponse> {
    const { userId, variant, betType, stake, currencyCode, clientSeed, idempotencyKey } = input;

    // 1) Player validation — authenticated principal must not be a blocked account.
    // Blocked statuses cannot wager; ACTIVE/PENDING may (email-verification/KYC gating is
    // a later phase, explicitly out of scope here).
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new NotFoundException('Player not found');
    if (BLOCKED_STATUSES.has(user.status)) throw new ForbiddenException(`Account is ${user.status.toLowerCase()}`);

    // 2) Currency validation.
    const currency = await this.prisma.currency.findUnique({ where: { code: currencyCode.toUpperCase() } });
    if (!currency || !currency.isActive) throw new BadRequestException(`Unsupported currency "${currencyCode}"`);

    // 3) Variant + bet + stake validation (server-side, BEFORE any money moves).
    const ruleset = await this.variants.resolve(variant); // throws NotFound for an unknown variant
    if (!ruleset.bets.some((b) => b.key === betType)) throw new BadRequestException(`Unknown bet "${betType}" for variant "${variant}"`);
    this.assertStake(stake, currency.decimals, ruleset.limits.min, ruleset.limits.max);

    // 4) Idempotency — an identical (user, key) returns the same round, no re-charge.
    const existing = await this.prisma.gameRound.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
    if (existing) return this.resolveExisting(existing, currency.code);

    // 5) Create the round (unique [userId, idempotencyKey] also blocks concurrent duplicates).
    let round;
    try {
      round = await this.prisma.gameRound.create({
        data: { userId, gameKey: GAME_KEY, variant, betType, currencyId: currency.id, stake, status: GameRoundStatus.CREATED, idempotencyKey },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const dup = await this.prisma.gameRound.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
        if (dup) return this.resolveExisting(dup, currency.code);
      }
      throw err;
    }

    // 6) Atomic stake reservation (available → locked). Overdraft is rejected atomically —
    //    on throw, no balance moved and no ledger row exists.
    let reservationId: string;
    try {
      const reserved = await this.wallet.reserve(userId, currency.id, stake, `round:${round.id}`, `${round.id}:reserve`);
      reservationId = reserved.reservationId;
    } catch (err) {
      await this.fail(round.id, this.msg(err));
      // Map the wallet-core overdraft (BalanceError) to a clean client error; nothing was debited.
      if (this.msg(err).toLowerCase().includes('insufficient')) throw new BadRequestException('Insufficient balance');
      throw err;
    }
    await this.prisma.gameRound.update({ where: { id: round.id }, data: { status: GameRoundStatus.RESERVED, reservationId } });

    // 7) Execute the EXISTING dice engine (authoritative result + payout; unchanged math).
    let engine: Awaited<ReturnType<DiceEngineService['play']>>;
    try {
      engine = await this.dice.play(variant, [{ type: betType, amount: stake }], clientSeed);
    } catch (err) {
      // Engine failed AFTER debit → refund the stake (release), mark FAILED. Never lose the stake.
      await this.safeRelease(reservationId, round.id);
      await this.fail(round.id, this.msg(err));
      throw new BadRequestException('Game execution failed; stake refunded');
    }
    const payout = engine.result.settlement.totalWin;
    await this.prisma.gameRound.update({
      where: { id: round.id },
      data: { status: GameRoundStatus.RESOLVED, payout, result: engine.result as unknown as Prisma.InputJsonValue, fairness: engine.fairness as unknown as Prisma.InputJsonValue },
    });

    // 8) Atomic settlement — consume stake + credit winnings + double-entry ledger.
    let movement;
    try {
      movement = await this.wallet.commitReservation(reservationId, payout, `round:${round.id}`, `${round.id}:commit`);
    } catch (err) {
      // Settlement failed → recoverable. Reservation stays LOCKED, result stored. No stake lost, no double pay.
      await this.prisma.gameRound.update({ where: { id: round.id }, data: { status: GameRoundStatus.PENDING_SETTLEMENT, error: this.msg(err) } });
      this.logger.error(`Round ${round.id} settlement failed → PENDING_SETTLEMENT: ${this.msg(err)}`);
      throw new ServiceUnavailableException('Settlement pending — the round will be recovered');
    }

    const settled = await this.prisma.gameRound.update({
      where: { id: round.id },
      data: { status: GameRoundStatus.SETTLED, betTransactionId: movement.transactionId, settledAt: new Date() },
    });
    return this.toResponse(settled, currency.code, movement.wallet, false);
  }

  /** Recover a stuck PENDING_SETTLEMENT round (commitReservation is idempotent). */
  async recover(roundId: string): Promise<PlayDiceResponse> {
    const round = await this.prisma.gameRound.findUnique({ where: { id: roundId } });
    if (!round) throw new NotFoundException('Round not found');
    if (round.status === GameRoundStatus.SETTLED || round.status === GameRoundStatus.RECOVERED) {
      return this.resolveExisting(round, (await this.currencyCode(round.currencyId)));
    }
    // The recovery worker claims a round (PENDING_SETTLEMENT → RECOVERING) before calling this;
    // both states are settle-able. commitReservation is idempotent, so a re-run is safe.
    const recoverable = round.status === GameRoundStatus.PENDING_SETTLEMENT || round.status === GameRoundStatus.RECOVERING;
    if (!recoverable || !round.reservationId) {
      throw new ConflictException(`Round ${roundId} is not recoverable (status ${round.status})`);
    }
    // Extra reservations (e.g. a doubled Blackjack hand) — commit each first; all idempotent.
    const extras = ((round.result ?? {}) as { extraReservations?: Array<{ reservationId: string; win: string; reference?: string; idempotencyKey?: string }> }).extraReservations ?? [];
    for (const ex of extras) {
      await this.wallet.commitReservation(ex.reservationId, ex.win, ex.reference ?? `round:${round.id}:2`, ex.idempotencyKey ?? `${round.id}:commit2`);
    }
    const movement = await this.wallet.commitReservation(round.reservationId, round.payout.toString(), `round:${round.id}`, `${round.id}:commit`);
    const settled = await this.prisma.gameRound.update({
      where: { id: round.id },
      data: { status: GameRoundStatus.RECOVERED, betTransactionId: movement.transactionId, settledAt: new Date() },
    });
    return this.toResponse(settled, await this.currencyCode(round.currencyId), movement.wallet, true);
  }

  /* =========================================================================
   *  ROULETTE — single-shot, multi-bet. One spin = ONE reservation + ONE
   *  settlement. Reuses the SAME reserve/commit primitives as dice; the
   *  authoritative pocket + payout come only from the frozen Roulette engine.
   * ========================================================================= */

  async playRoulette(input: PlayRouletteInput): Promise<RoulettePlayResponse> {
    const { userId, variant, bets, currencyCode, clientSeed, idempotencyKey } = input;

    const user = await this.loadPlayer(userId);
    void user;
    const currency = await this.loadCurrency(currencyCode);
    const ruleset = await this.rouletteVariants.resolve(variant); // NotFound for unknown variant

    // Server-side bet validation BEFORE any money moves (same rules the engine enforces).
    if (!Array.isArray(bets) || bets.length === 0) throw new BadRequestException('At least one bet is required');
    if (bets.length > MAX_BETS) throw new BadRequestException(`Too many bets (max ${MAX_BETS})`);
    let totalStake = 0;
    for (const b of bets) {
      const def = ruleset.betTypes.find((t) => t.key === b.type);
      if (!def) throw new BadRequestException(`Unknown bet "${b.type}" for variant "${variant}"`);
      this.assertStake(b.amount, currency.decimals, ruleset.limits.min, ruleset.limits.max);
      if (def.match === 'numbers' && (b.selection?.length ?? 0) !== (def.selectionSize ?? 1)) {
        throw new BadRequestException(`Bet "${b.type}" requires ${def.selectionSize} number(s)`);
      }
      totalStake += Number(b.amount);
    }
    if (totalStake > ruleset.limits.tableMax) throw new BadRequestException(`Total stake exceeds table maximum (${ruleset.limits.tableMax})`);
    const stakeStr = this.money(totalStake, currency.decimals);

    // Idempotency.
    const existing = await this.prisma.gameRound.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
    if (existing) return this.rouletteResponse(existing, currency.code, await this.walletView(existing), existing.status !== GameRoundStatus.CREATED);

    let round;
    try {
      round = await this.prisma.gameRound.create({
        data: { userId, gameKey: ROULETTE_KEY, variant, betType: this.betSummary(bets), currencyId: currency.id, stake: stakeStr, status: GameRoundStatus.CREATED, idempotencyKey },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const dup = await this.prisma.gameRound.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
        if (dup) return this.rouletteResponse(dup, currency.code, await this.walletView(dup), true);
      }
      throw err;
    }

    // Reserve the TOTAL stake once.
    let reservationId: string;
    try {
      const reserved = await this.wallet.reserve(userId, currency.id, stakeStr, `round:${round.id}`, `${round.id}:reserve`);
      reservationId = reserved.reservationId;
    } catch (err) {
      await this.fail(round.id, this.msg(err));
      if (this.msg(err).toLowerCase().includes('insufficient')) throw new BadRequestException('Insufficient balance');
      throw err;
    }
    await this.prisma.gameRound.update({ where: { id: round.id }, data: { status: GameRoundStatus.RESERVED, reservationId } });

    // Authoritative spin (frozen engine) — one deterministic, verifiable outcome.
    let spin: Awaited<ReturnType<RouletteEngineService['play']>>;
    try {
      spin = await this.roulette.play(variant, bets as RouletteBet[], clientSeed);
    } catch (err) {
      await this.safeRelease(reservationId, round.id);
      await this.fail(round.id, this.msg(err));
      throw new BadRequestException('Game execution failed; stake refunded');
    }
    const payout = spin.result.settlement.totalWin;
    const resultJson = { kind: ROULETTE_KEY, bets, pocket: spin.result.pocket, pocketLabel: spin.result.pocketLabel, color: spin.result.color, winningBets: spin.result.winningBets, settlement: spin.result.settlement };
    await this.prisma.gameRound.update({
      where: { id: round.id },
      data: { status: GameRoundStatus.RESOLVED, payout, result: resultJson as unknown as Prisma.InputJsonValue, fairness: spin.fairness as unknown as Prisma.InputJsonValue },
    });

    // Settle once (consume stake + credit winnings + double-entry ledger).
    let movement;
    try {
      movement = await this.wallet.commitReservation(reservationId, payout, `round:${round.id}`, `${round.id}:commit`);
    } catch (err) {
      await this.prisma.gameRound.update({ where: { id: round.id }, data: { status: GameRoundStatus.PENDING_SETTLEMENT, error: this.msg(err) } });
      this.logger.error(`Roulette round ${round.id} settlement failed → PENDING_SETTLEMENT: ${this.msg(err)}`);
      throw new ServiceUnavailableException('Settlement pending — the round will be recovered');
    }
    const settled = await this.prisma.gameRound.update({ where: { id: round.id }, data: { status: GameRoundStatus.SETTLED, betTransactionId: movement.transactionId, settledAt: new Date() } });
    return this.rouletteResponse(settled, currency.code, movement.wallet, false);
  }

  /* =========================================================================
   *  SIC BO — single-shot, multi-bet on the EXISTING Dice engine (`sic-bo`
   *  variant). One board = ONE reservation of the total stake + ONE settlement.
   *  Reuses the SAME reserve/commit primitives as dice/roulette; the authoritative
   *  dice roll + total payout come only from the frozen Dice engine.
   * ========================================================================= */

  async playSicBo(input: PlaySicBoInput): Promise<SicBoPlayResponse> {
    const { userId, variant, bets, currencyCode, clientSeed, idempotencyKey } = input;

    await this.loadPlayer(userId);
    const currency = await this.loadCurrency(currencyCode);
    const ruleset = await this.variants.resolve(variant); // dice variant service; NotFound for unknown

    if (!Array.isArray(bets) || bets.length === 0) throw new BadRequestException('At least one bet is required');
    if (bets.length > MAX_BETS) throw new BadRequestException(`Too many bets (max ${MAX_BETS})`);
    let totalStake = 0;
    for (const b of bets) {
      if (!ruleset.bets.some((rb: { key: string }) => rb.key === b.type)) throw new BadRequestException(`Unknown bet "${b.type}" for variant "${variant}"`);
      this.assertStake(b.amount, currency.decimals, ruleset.limits.min, ruleset.limits.max);
      totalStake += Number(b.amount);
    }
    if (totalStake > ruleset.limits.tableMax) throw new BadRequestException(`Total stake exceeds table maximum (${ruleset.limits.tableMax})`);
    const stakeStr = this.money(totalStake, currency.decimals);

    const existing = await this.prisma.gameRound.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
    if (existing) return this.sicBoResponse(existing, currency.code, await this.walletView(existing), existing.status !== GameRoundStatus.CREATED);

    let round;
    try {
      round = await this.prisma.gameRound.create({
        data: { userId, gameKey: SICBO_KEY, variant, betType: this.betSummary(bets), currencyId: currency.id, stake: stakeStr, status: GameRoundStatus.CREATED, idempotencyKey },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const dup = await this.prisma.gameRound.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
        if (dup) return this.sicBoResponse(dup, currency.code, await this.walletView(dup), true);
      }
      throw err;
    }

    // Reserve the TOTAL stake once.
    let reservationId: string;
    try {
      const reserved = await this.wallet.reserve(userId, currency.id, stakeStr, `round:${round.id}`, `${round.id}:reserve`);
      reservationId = reserved.reservationId;
    } catch (err) {
      await this.fail(round.id, this.msg(err));
      if (this.msg(err).toLowerCase().includes('insufficient')) throw new BadRequestException('Insufficient balance');
      throw err;
    }
    await this.prisma.gameRound.update({ where: { id: round.id }, data: { status: GameRoundStatus.RESERVED, reservationId } });

    // Authoritative roll (frozen dice engine) — one deterministic, verifiable outcome.
    let roll: Awaited<ReturnType<DiceEngineService['play']>>;
    try {
      roll = await this.dice.play(variant, bets as DiceBet[], clientSeed);
    } catch (err) {
      await this.safeRelease(reservationId, round.id);
      await this.fail(round.id, this.msg(err));
      throw new BadRequestException('Game execution failed; stake refunded');
    }
    const payout = roll.result.settlement.totalWin;
    const resultJson = { kind: SICBO_KEY, bets, values: roll.result.values, total: roll.result.total, isTriple: roll.result.isTriple, winningBets: roll.result.winningBets, settlement: roll.result.settlement };
    await this.prisma.gameRound.update({
      where: { id: round.id },
      data: { status: GameRoundStatus.RESOLVED, payout, result: resultJson as unknown as Prisma.InputJsonValue, fairness: roll.fairness as unknown as Prisma.InputJsonValue },
    });

    // Settle once (consume stake + credit winnings + double-entry ledger).
    let movement;
    try {
      movement = await this.wallet.commitReservation(reservationId, payout, `round:${round.id}`, `${round.id}:commit`);
    } catch (err) {
      await this.prisma.gameRound.update({ where: { id: round.id }, data: { status: GameRoundStatus.PENDING_SETTLEMENT, error: this.msg(err) } });
      this.logger.error(`Sic Bo round ${round.id} settlement failed → PENDING_SETTLEMENT: ${this.msg(err)}`);
      throw new ServiceUnavailableException('Settlement pending — the round will be recovered');
    }
    const settled = await this.prisma.gameRound.update({ where: { id: round.id }, data: { status: GameRoundStatus.SETTLED, betTransactionId: movement.transactionId, settledAt: new Date() } });
    return this.sicBoResponse(settled, currency.code, movement.wallet, false);
  }

  /* =========================================================================
   *  CRASH — two-phase live game. `playCrash` reserves the stake and starts an
   *  authoritative round with a HIDDEN, deterministic crash point (revealed only
   *  at settlement). `cashoutCrash` settles at the server-authoritative multiplier
   *  for the elapsed time. Abandoned running rounds are finalized by recovery.
   *  All money moves through the SAME reserve/commit primitives.
   * ========================================================================= */

  async playCrash(input: PlayCrashInput): Promise<CrashPlayResponse> {
    const { userId, variant, stake, currencyCode, autoCashout, clientSeed, idempotencyKey } = input;

    await this.loadPlayer(userId);
    const currency = await this.loadCurrency(currencyCode);
    const ruleset = await this.crashVariants.resolve(variant);
    this.assertStake(stake, currency.decimals, ruleset.limits.min, ruleset.limits.max);
    if (Number(stake) > ruleset.limits.tableMax) throw new BadRequestException(`Stake exceeds table maximum (${ruleset.limits.tableMax})`);
    if (autoCashout !== undefined && autoCashout !== null) {
      if (!(autoCashout > ruleset.minMultiplier)) throw new BadRequestException(`Auto cash-out must exceed ${ruleset.minMultiplier}`);
      if (autoCashout > ruleset.maxMultiplier) throw new BadRequestException(`Auto cash-out cannot exceed ${ruleset.maxMultiplier}`);
    }

    const existing = await this.prisma.gameRound.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
    if (existing) return this.crashResponse(existing, currency.code, await this.walletView(existing), existing.status !== GameRoundStatus.CREATED);

    let round;
    try {
      round = await this.prisma.gameRound.create({
        data: { userId, gameKey: CRASH_KEY, variant, betType: autoCashout ? `auto@${autoCashout}` : 'manual', currencyId: currency.id, stake, status: GameRoundStatus.CREATED, idempotencyKey },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const dup = await this.prisma.gameRound.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
        if (dup) return this.crashResponse(dup, currency.code, await this.walletView(dup), true);
      }
      throw err;
    }

    // Reserve the stake.
    let reservationId: string;
    try {
      const reserved = await this.wallet.reserve(userId, currency.id, stake, `round:${round.id}`, `${round.id}:reserve`);
      reservationId = reserved.reservationId;
    } catch (err) {
      await this.fail(round.id, this.msg(err));
      if (this.msg(err).toLowerCase().includes('insufficient')) throw new BadRequestException('Insufficient balance');
      throw err;
    }

    // Commit to a deterministic, provably-fair crash point (hidden until settlement).
    const commit = this.fair.createCommit();
    const seed = this.fair.deriveSeed(commit.serverSeed, clientSeed ?? commit.serverSeedHash, commit.nonce);
    const crashPoint = ProvablyFairCrashGenerator.fromRuleset(seed, ruleset);
    const crashTimeMs = Math.min(new MultiplierManager(ruleset).timeToReach(crashPoint), ruleset.roundDurationCapMs);
    const startedAtMs = Date.now();
    const meta: CrashMeta = {
      kind: CRASH_KEY,
      serverSeed: commit.serverSeed,
      serverSeedHash: commit.serverSeedHash,
      clientSeed: clientSeed ?? commit.serverSeedHash,
      nonce: commit.nonce,
      seed,
      crashPoint,
      crashTimeMs,
      startedAtMs,
      autoCashout: autoCashout ?? null,
      growthRatePerSecond: ruleset.growthRatePerSecond,
      minMultiplier: ruleset.minMultiplier,
      maxMultiplier: ruleset.maxMultiplier,
    };
    const started = await this.prisma.gameRound.update({
      where: { id: round.id },
      data: { status: GameRoundStatus.RESERVED, reservationId, result: meta as unknown as Prisma.InputJsonValue, fairness: { serverSeedHash: commit.serverSeedHash, clientSeed: meta.clientSeed, nonce: commit.nonce } as unknown as Prisma.InputJsonValue },
    });
    // Response for a RUNNING round NEVER reveals crashPoint / serverSeed / seed.
    return this.crashResponse(started, currency.code, await this.walletView(started), false);
  }

  /** Cash out the caller's active crash round at the server-authoritative multiplier. */
  async cashoutCrash(input: { userId: string; roundId?: string; idempotencyKey?: string }): Promise<CrashPlayResponse> {
    const { userId, roundId } = input;
    const round = roundId
      ? await this.prisma.gameRound.findUnique({ where: { id: roundId } })
      : await this.prisma.gameRound.findFirst({ where: { userId, gameKey: CRASH_KEY, status: GameRoundStatus.RESERVED }, orderBy: { createdAt: 'desc' } });
    if (!round || round.gameKey !== CRASH_KEY) throw new NotFoundException('No crash round found');
    if (round.userId !== userId) throw new ForbiddenException('Not your round');
    const currency = await this.currencyCode(round.currencyId);

    // Already settled → idempotent replay (double cash-out returns the same result).
    const terminalish: GameRoundStatus[] = [GameRoundStatus.SETTLED, GameRoundStatus.RECOVERED, GameRoundStatus.RESOLVED, GameRoundStatus.PENDING_SETTLEMENT];
    if (terminalish.includes(round.status)) {
      if (round.status === GameRoundStatus.PENDING_SETTLEMENT) return this.crashResponse(await this.recoverRound(round.id), currency, await this.walletView(round), true);
      return this.crashResponse(round, currency, await this.walletView(round), true);
    }
    if (round.status !== GameRoundStatus.RESERVED) throw new ConflictException('Round is not active');

    const meta = this.crashMeta(round);
    const ruleset = await this.crashVariants.resolve(round.variant);
    const elapsedMs = Date.now() - meta.startedAtMs;
    const currentMultiplier = new MultiplierManager(ruleset).valueAt(elapsedMs);
    return this.settleCrash(round.id, currentMultiplier, currency);
  }

  /**
   * Settle a crash round exactly once. `manualCashout` is the server multiplier the
   * player took (live cash-out); `null` finalizes an abandoned/expired round (only an
   * auto cash-out can still win). The claim `RESERVED → RESOLVED` is authoritative, so
   * concurrent cash-outs / a recovery finalize can never double-settle.
   */
  async settleCrash(roundId: string, manualCashout: number | null, currencyCode?: string): Promise<CrashPlayResponse> {
    const claim = await this.prisma.gameRound.updateMany({
      where: { id: roundId, status: GameRoundStatus.RESERVED },
      data: { status: GameRoundStatus.RESOLVED },
    });
    const fresh = await this.prisma.gameRound.findUnique({ where: { id: roundId } });
    if (!fresh) throw new NotFoundException('Round not found');
    const code = currencyCode ?? (await this.currencyCode(fresh.currencyId));
    if (claim.count === 0) {
      // Someone else claimed it — return the current authoritative state (idempotent).
      if (fresh.status === GameRoundStatus.PENDING_SETTLEMENT) return this.crashResponse(await this.recoverRound(fresh.id), code, await this.walletView(fresh), true);
      return this.crashResponse(fresh, code, await this.walletView(fresh), true);
    }

    const meta = this.crashMeta(fresh);
    const ruleset = await this.crashVariants.resolve(fresh.variant);
    const bet: CrashBet = { amount: fresh.stake.toString(), autoCashout: meta.autoCashout ?? undefined };
    const engine = new CrashEngine(ruleset, meta.seed);
    const result = engine.playRound(fresh.id, [bet], [manualCashout]);
    const settlement = result.settlement.bets[0]!;
    const payout = result.settlement.totalWin;
    const settledMeta: CrashMeta = { ...meta, settled: { cashedOutAt: settlement.cashedOutAt, won: settlement.outcome === 'won', payout, reason: manualCashout === null ? 'expired' : 'cashout', crashPoint: result.crashPoint } };
    if (!fresh.reservationId) throw new ConflictException('Round has no reservation');
    await this.prisma.gameRound.update({ where: { id: fresh.id }, data: { payout, result: settledMeta as unknown as Prisma.InputJsonValue } });

    let movement;
    try {
      movement = await this.wallet.commitReservation(fresh.reservationId!, payout, `round:${fresh.id}`, `${fresh.id}:commit`);
    } catch (err) {
      await this.prisma.gameRound.update({ where: { id: fresh.id }, data: { status: GameRoundStatus.PENDING_SETTLEMENT, error: this.msg(err) } });
      this.logger.error(`Crash round ${fresh.id} settlement failed → PENDING_SETTLEMENT: ${this.msg(err)}`);
      throw new ServiceUnavailableException('Settlement pending — the round will be recovered');
    }
    const done = await this.prisma.gameRound.update({ where: { id: fresh.id }, data: { status: GameRoundStatus.SETTLED, betTransactionId: movement.transactionId, settledAt: new Date() } });
    return this.crashResponse(done, code, movement.wallet, false);
  }

  /** The caller's active (running) crash round, or null. Never reveals the crash point. */
  async activeCrashRound(userId: string): Promise<CrashPlayResponse | null> {
    const round = await this.prisma.gameRound.findFirst({
      where: { userId, gameKey: CRASH_KEY, status: GameRoundStatus.RESERVED },
      orderBy: { createdAt: 'desc' },
    });
    if (!round) return null;
    return this.crashResponse(round, await this.currencyCode(round.currencyId), await this.walletView(round), false);
  }

  /** Discover RESERVED crash rounds whose curve has already busted, for finalize-as-loss. */
  async findExpiredCrashRounds(graceMs: number, limit = 25): Promise<string[]> {
    const rounds = await this.prisma.gameRound.findMany({
      where: { gameKey: CRASH_KEY, status: GameRoundStatus.RESERVED },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true, result: true },
    });
    const now = Date.now();
    return rounds
      .filter((r) => {
        const m = r.result as unknown as CrashMeta | null;
        return m && typeof m.startedAtMs === 'number' && now > m.startedAtMs + m.crashTimeMs + graceMs;
      })
      .map((r) => r.id);
  }

  /* =========================================================================
   *  NUMBER LOTTERY — scheduled-draw game. Ticket purchase RESERVES the price and
   *  persists a ticket (GameRound linked to a shared LotteryDraw). The stake stays
   *  reserved until the draw resolves; settlement commits the engine-evaluated prize
   *  (no second debit). All money moves through the SAME reserve/commit primitives.
   * ========================================================================= */

  /** Buy one lottery ticket for the given OPEN draw (reserve price → pending ticket). */
  async buyLotteryTicket(input: BuyLotteryTicketInput, draw: LotteryDrawRow): Promise<LotteryTicketResponse> {
    const { userId, picks, currencyCode, idempotencyKey } = input;

    await this.loadPlayer(userId);
    const currency = await this.loadCurrency(currencyCode);
    if (currency.id !== draw.currencyId) throw new BadRequestException('Ticket currency does not match the draw');

    // Validate the picks server-side (distinct, in range, correct count).
    if (!Array.isArray(picks) || picks.length !== draw.pick) throw new BadRequestException(`Pick exactly ${draw.pick} numbers`);
    const seen = new Set<number>();
    for (const n of picks) {
      if (!Number.isInteger(n) || n < 1 || n > draw.poolSize) throw new BadRequestException(`Numbers must be 1–${draw.poolSize}`);
      if (seen.has(n)) throw new BadRequestException('Numbers must be distinct');
      seen.add(n);
    }
    const sortedPicks = [...picks].sort((a, b) => a - b);
    const ticketPrice = draw.ticketPrice.toString();

    const existing = await this.prisma.gameRound.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
    if (existing) return this.lotteryTicketResponse(existing, currency.code, draw);

    let round;
    try {
      round = await this.prisma.gameRound.create({
        data: {
          userId, gameKey: LOTTERY_KEY, variant: `draw-${draw.drawNumber}`, betType: 'ticket', currencyId: currency.id,
          stake: ticketPrice, status: GameRoundStatus.CREATED, idempotencyKey, drawId: draw.id,
          result: { kind: LOTTERY_KEY, picks: sortedPicks, drawNumber: draw.drawNumber, drawId: draw.id } as unknown as Prisma.InputJsonValue,
          fairness: { serverSeedHash: draw.serverSeedHash, clientSeed: draw.clientSeed, nonce: draw.nonce } as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const dup = await this.prisma.gameRound.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
        if (dup) return this.lotteryTicketResponse(dup, currency.code, draw);
      }
      throw err;
    }

    // Reserve the ticket price. The stake stays locked until the draw resolves.
    try {
      const reserved = await this.wallet.reserve(userId, currency.id, ticketPrice, `round:${round.id}`, `${round.id}:reserve`);
      await this.prisma.gameRound.update({ where: { id: round.id }, data: { status: GameRoundStatus.RESERVED, reservationId: reserved.reservationId } });
    } catch (err) {
      await this.fail(round.id, this.msg(err));
      if (this.msg(err).toLowerCase().includes('insufficient')) throw new BadRequestException('Insufficient balance');
      throw err;
    }
    const ticket = (await this.prisma.gameRound.findUnique({ where: { id: round.id } }))!;
    return this.lotteryTicketResponse(ticket, currency.code, draw);
  }

  /**
   * Settle ONE lottery ticket against the authoritative winning numbers. Called by the
   * draw service after the draw is DRAWN. The guarded `RESERVED → RESOLVED` claim makes it
   * idempotent (a re-settle is a no-op); `commitReservation` is itself idempotent. Prize is
   * evaluated ONLY by the engine (`countMatches` + the draw's prize tiers).
   */
  async settleLotteryTicket(roundId: string, winningNumbers: number[], prizeTiers: Record<string, number>): Promise<'settled' | 'pending' | 'skipped'> {
    const claim = await this.prisma.gameRound.updateMany({
      where: { id: roundId, status: GameRoundStatus.RESERVED },
      data: { status: GameRoundStatus.RESOLVED },
    });
    if (claim.count === 0) return 'skipped'; // already settling/settled, or not a pending ticket

    const round = (await this.prisma.gameRound.findUnique({ where: { id: roundId } }))!;
    const meta = (round.result ?? {}) as { picks?: number[] };
    const picks = meta.picks ?? [];
    const matches = countMatches(picks, winningNumbers);
    const multiplier = prizeTiers[String(matches)] ?? 0;
    const prize = this.money(Number(round.stake) * multiplier, 8);
    const settledResult = { ...(round.result as object), matches, tier: multiplier > 0 ? String(matches) : null, prize, winningNumbers, won: multiplier > 0 };
    if (!round.reservationId) throw new ConflictException('Ticket has no reservation');
    await this.prisma.gameRound.update({ where: { id: roundId }, data: { payout: prize, result: settledResult as unknown as Prisma.InputJsonValue } });

    try {
      const movement = await this.wallet.commitReservation(round.reservationId, prize, `round:${round.id}`, `${round.id}:commit`);
      await this.prisma.gameRound.update({ where: { id: roundId }, data: { status: GameRoundStatus.SETTLED, betTransactionId: movement.transactionId, settledAt: new Date() } });
      return 'settled';
    } catch (err) {
      await this.prisma.gameRound.update({ where: { id: roundId }, data: { status: GameRoundStatus.PENDING_SETTLEMENT, error: this.msg(err) } });
      this.logger.error(`Lottery ticket ${roundId} settlement failed → PENDING_SETTLEMENT: ${this.msg(err)}`);
      return 'pending';
    }
  }

  /* =========================================================================
   *  BACCARAT — single-shot, multi-bet on the EXISTING Card engine. One round =
   *  ONE reservation of the total stake + ONE settlement. Reuses the SAME
   *  reserve/commit primitives; the authoritative cards + total payout come only
   *  from the frozen Card engine (`CardEngineService.play`).
   * ========================================================================= */

  async playBaccarat(input: PlayBaccaratInput): Promise<BaccaratPlayResponse> {
    const { userId, bets, currencyCode, clientSeed, idempotencyKey } = input;

    await this.loadPlayer(userId);
    const currency = await this.loadCurrency(currencyCode);
    const ruleset = await this.cardVariants.resolve(BACCARAT_KEY);
    const allowed = new Set(ruleset.bets.map((b: { key: string }) => b.key));

    if (!Array.isArray(bets) || bets.length === 0) throw new BadRequestException('At least one bet is required');
    if (bets.length > MAX_BETS) throw new BadRequestException(`Too many bets (max ${MAX_BETS})`);
    let totalStake = 0;
    for (const b of bets) {
      if (!allowed.has(b.type)) throw new BadRequestException(`Unknown bet "${b.type}" for baccarat`);
      this.assertStake(b.amount, currency.decimals, ruleset.betLimits.min, ruleset.betLimits.max);
      totalStake += Number(b.amount);
    }
    const stakeStr = this.money(totalStake, currency.decimals);

    const existing = await this.prisma.gameRound.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
    if (existing) return this.baccaratResponse(existing, currency.code, await this.walletView(existing), existing.status !== GameRoundStatus.CREATED);

    let round;
    try {
      round = await this.prisma.gameRound.create({
        data: { userId, gameKey: BACCARAT_KEY, variant: BACCARAT_KEY, betType: this.betSummary(bets), currencyId: currency.id, stake: stakeStr, status: GameRoundStatus.CREATED, idempotencyKey },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const dup = await this.prisma.gameRound.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
        if (dup) return this.baccaratResponse(dup, currency.code, await this.walletView(dup), true);
      }
      throw err;
    }

    let reservationId: string;
    try {
      const reserved = await this.wallet.reserve(userId, currency.id, stakeStr, `round:${round.id}`, `${round.id}:reserve`);
      reservationId = reserved.reservationId;
    } catch (err) {
      await this.fail(round.id, this.msg(err));
      if (this.msg(err).toLowerCase().includes('insufficient')) throw new BadRequestException('Insufficient balance');
      throw err;
    }
    await this.prisma.gameRound.update({ where: { id: round.id }, data: { status: GameRoundStatus.RESERVED, reservationId } });

    let deal: Awaited<ReturnType<CardEngineService['play']>>;
    try {
      deal = await this.card.play(BACCARAT_KEY, bets.map((b) => ({ key: b.type, amount: b.amount })), clientSeed);
    } catch (err) {
      await this.safeRelease(reservationId, round.id);
      await this.fail(round.id, this.msg(err));
      throw new BadRequestException('Game execution failed; stake refunded');
    }
    const payout = deal.result.settlement.totalWin;
    const resultJson = { kind: BACCARAT_KEY, bets, hands: deal.result.hands, winners: deal.result.winners, winningBets: deal.result.winningBets, isTie: deal.result.isTie, settlement: deal.result.settlement, details: deal.result.details };
    await this.prisma.gameRound.update({ where: { id: round.id }, data: { status: GameRoundStatus.RESOLVED, payout, result: resultJson as unknown as Prisma.InputJsonValue, fairness: deal.fairness as unknown as Prisma.InputJsonValue } });

    let movement;
    try {
      movement = await this.wallet.commitReservation(reservationId, payout, `round:${round.id}`, `${round.id}:commit`);
    } catch (err) {
      await this.prisma.gameRound.update({ where: { id: round.id }, data: { status: GameRoundStatus.PENDING_SETTLEMENT, error: this.msg(err) } });
      this.logger.error(`Baccarat round ${round.id} settlement failed → PENDING_SETTLEMENT: ${this.msg(err)}`);
      throw new ServiceUnavailableException('Settlement pending — the round will be recovered');
    }
    const settled = await this.prisma.gameRound.update({ where: { id: round.id }, data: { status: GameRoundStatus.SETTLED, betTransactionId: movement.transactionId, settledAt: new Date() } });
    return this.baccaratResponse(settled, currency.code, movement.wallet, false);
  }

  /* =========================================================================
   *  CARD GAMES (Dragon Tiger · Andar Bahar · Teen Patti) — one generic single-shot
   *  method over the authoritative `card-engine` presets (the same path Baccarat uses,
   *  parametrized by variant). Reserve the total stake → the engine deals + settles
   *  provably-fairly → commit the engine's authoritative `settlement.totalWin` once.
   *  The client sends ONLY its bets; never the hands/winner/payout. Only the approved
   *  P0 variants are enabled (CARD_MONEY_VARIANTS).
   * ========================================================================= */

  async playCard(input: PlayCardInput): Promise<CardPlayResponse> {
    const { userId, variant, bets, currencyCode, clientSeed, idempotencyKey } = input;

    await this.loadPlayer(userId);
    const currency = await this.loadCurrency(currencyCode);
    if (!CARD_MONEY_VARIANTS.has(variant)) throw new BadRequestException(`Unsupported card game "${variant}"`);
    const ruleset = await this.cardVariants.resolve(variant);
    const allowed = new Set(ruleset.bets.map((b: { key: string }) => b.key)); // main bets only (each provably settles)

    if (!Array.isArray(bets) || bets.length === 0) throw new BadRequestException('At least one bet is required');
    if (bets.length > MAX_BETS) throw new BadRequestException(`Too many bets (max ${MAX_BETS})`);
    let totalStake = 0;
    for (const b of bets) {
      if (!allowed.has(b.type)) throw new BadRequestException(`Unknown bet "${b.type}" for ${variant}`);
      this.assertStake(b.amount, currency.decimals, ruleset.betLimits.min, ruleset.betLimits.max);
      totalStake += Number(b.amount);
    }
    const stakeStr = this.money(totalStake, currency.decimals);

    const existing = await this.prisma.gameRound.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
    if (existing) return this.cardResponse(existing, currency.code, await this.walletView(existing), existing.status !== GameRoundStatus.CREATED);

    let round;
    try {
      round = await this.prisma.gameRound.create({
        data: { userId, gameKey: variant, variant, betType: this.betSummary(bets), currencyId: currency.id, stake: stakeStr, status: GameRoundStatus.CREATED, idempotencyKey },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const dup = await this.prisma.gameRound.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
        if (dup) return this.cardResponse(dup, currency.code, await this.walletView(dup), true);
      }
      throw err;
    }

    let reservationId: string;
    try {
      const reserved = await this.wallet.reserve(userId, currency.id, stakeStr, `round:${round.id}`, `${round.id}:reserve`);
      reservationId = reserved.reservationId;
    } catch (err) {
      await this.fail(round.id, this.msg(err));
      if (this.msg(err).toLowerCase().includes('insufficient')) throw new BadRequestException('Insufficient balance');
      throw err;
    }
    await this.prisma.gameRound.update({ where: { id: round.id }, data: { status: GameRoundStatus.RESERVED, reservationId } });

    let deal: Awaited<ReturnType<CardEngineService['play']>>;
    try {
      deal = await this.card.play(variant, bets.map((b) => ({ key: b.type, amount: b.amount })), clientSeed);
    } catch (err) {
      await this.safeRelease(reservationId, round.id);
      await this.fail(round.id, this.msg(err));
      throw new BadRequestException('Game execution failed; stake refunded');
    }
    const payout = deal.result.settlement.totalWin;
    const resultJson = { kind: variant, bets, hands: deal.result.hands, winners: deal.result.winners, winningBets: deal.result.winningBets, isTie: deal.result.isTie, settlement: deal.result.settlement, details: deal.result.details };
    await this.prisma.gameRound.update({ where: { id: round.id }, data: { status: GameRoundStatus.RESOLVED, payout, result: resultJson as unknown as Prisma.InputJsonValue, fairness: deal.fairness as unknown as Prisma.InputJsonValue } });

    let movement;
    try {
      movement = await this.wallet.commitReservation(reservationId, payout, `round:${round.id}`, `${round.id}:commit`);
    } catch (err) {
      await this.prisma.gameRound.update({ where: { id: round.id }, data: { status: GameRoundStatus.PENDING_SETTLEMENT, error: this.msg(err) } });
      this.logger.error(`Card round ${round.id} (${variant}) settlement failed → PENDING_SETTLEMENT: ${this.msg(err)}`);
      throw new ServiceUnavailableException('Settlement pending — the round will be recovered');
    }
    const settled = await this.prisma.gameRound.update({ where: { id: round.id }, data: { status: GameRoundStatus.SETTLED, betTransactionId: movement.transactionId, settledAt: new Date() } });
    return this.cardResponse(settled, currency.code, movement.wallet, false);
  }

  /* =========================================================================
   *  BLACKJACK — interactive. `startBlackjack` reserves the stake and deals; the
   *  hand stays RESERVED (one reservation) while the player acts. Actions
   *  (HIT / STAND / DOUBLE) are serialized by a guarded `actionSeq` optimistic
   *  lock; the hand is reconstructed deterministically from the seed each time
   *  (restart-safe — no in-memory engine state). Settlement is the engine's; it
   *  commits exactly once. SPLIT / INSURANCE are NOT supported by the engine.
   * ========================================================================= */

  async startBlackjack(input: StartBlackjackInput): Promise<BlackjackResponse> {
    const { userId, stake, currencyCode, clientSeed, idempotencyKey } = input;

    await this.loadPlayer(userId);
    const currency = await this.loadCurrency(currencyCode);
    const ruleset = await this.cardVariants.resolve(BLACKJACK_KEY);
    this.assertStake(stake, currency.decimals, ruleset.betLimits.min, ruleset.betLimits.max);

    const existing = await this.prisma.gameRound.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
    if (existing) return this.blackjackResponse(existing, currency.code, await this.walletView(existing));

    let round;
    try {
      round = await this.prisma.gameRound.create({
        data: { userId, gameKey: BLACKJACK_KEY, variant: BLACKJACK_KEY, betType: 'main', currencyId: currency.id, stake, status: GameRoundStatus.CREATED, idempotencyKey },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const dup = await this.prisma.gameRound.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
        if (dup) return this.blackjackResponse(dup, currency.code, await this.walletView(dup));
      }
      throw err;
    }

    let reservationId: string;
    try {
      const reserved = await this.wallet.reserve(userId, currency.id, stake, `round:${round.id}`, `${round.id}:reserve`);
      reservationId = reserved.reservationId;
    } catch (err) {
      await this.fail(round.id, this.msg(err));
      if (this.msg(err).toLowerCase().includes('insufficient')) throw new BadRequestException('Insufficient balance');
      throw err;
    }

    // Commit to a provably-fair shoe; deal deterministically (reconstructable from the seed).
    const commit = this.fair.createCommit();
    const seed = this.fair.deriveSeed(commit.serverSeed, clientSeed ?? commit.serverSeedHash, commit.nonce);
    const meta: BlackjackMeta = {
      kind: BLACKJACK_KEY,
      serverSeed: commit.serverSeed,
      serverSeedHash: commit.serverSeedHash,
      clientSeed: clientSeed ?? commit.serverSeedHash,
      nonce: commit.nonce,
      seed,
      stake,
      playerHits: 0,
      doubled: false,
    };
    // Deal (deterministically) to capture the opening cards for the response.
    const view = this.reconstruct(meta, ruleset, 0);
    meta.player = view.player;
    meta.playerValue = view.playerValue;
    meta.dealerUp = view.dealerUp;
    const started = await this.prisma.gameRound.update({
      where: { id: round.id },
      data: { status: GameRoundStatus.RESERVED, reservationId, result: meta as unknown as Prisma.InputJsonValue, fairness: { serverSeedHash: commit.serverSeedHash, clientSeed: meta.clientSeed, nonce: commit.nonce } as unknown as Prisma.InputJsonValue },
    });
    return this.blackjackResponse(started, currency.code, await this.walletView(started));
  }

  /** Read the caller's blackjack hand state (never reveals the hole card / server seed while active). */
  async blackjackState(userId: string, roundId: string): Promise<BlackjackResponse> {
    const round = await this.prisma.gameRound.findUnique({ where: { id: roundId } });
    if (!round || round.gameKey !== BLACKJACK_KEY) throw new NotFoundException('Blackjack hand not found');
    if (round.userId !== userId) throw new ForbiddenException('Not your hand');
    return this.blackjackResponse(round, await this.currencyCode(round.currencyId), await this.walletView(round));
  }

  /** Apply one blackjack action (HIT / STAND / DOUBLE). Serialized & exactly-once via actionSeq. */
  async blackjackAction(input: BlackjackActionInput): Promise<BlackjackResponse> {
    const { userId, roundId, action } = input;
    const round = await this.prisma.gameRound.findUnique({ where: { id: roundId } });
    if (!round || round.gameKey !== BLACKJACK_KEY) throw new NotFoundException('Blackjack hand not found');
    if (round.userId !== userId) throw new ForbiddenException('Not your hand');
    const code = await this.currencyCode(round.currencyId);

    // Already finished → idempotent replay (action after settlement returns the final state).
    if (round.status !== GameRoundStatus.RESERVED) {
      if (round.status === GameRoundStatus.PENDING_SETTLEMENT) return this.blackjackResponse(await this.recoverRound(round.id), code, await this.walletView(round));
      return this.blackjackResponse(round, code, await this.walletView(round));
    }

    const meta = round.result as unknown as BlackjackMeta;
    const ruleset = await this.cardVariants.resolve(BLACKJACK_KEY);
    const S = round.actionSeq;

    if (action === 'HIT') {
      // Claim the action (optimistic lock): only one HIT at seq S advances.
      const claim = await this.prisma.gameRound.updateMany({ where: { id: roundId, status: GameRoundStatus.RESERVED, actionSeq: S }, data: { actionSeq: S + 1 } });
      if (claim.count === 0) return this.blackjackState(userId, roundId); // concurrent/stale → current state
      const view = this.reconstruct(meta, ruleset, S + 1); // replay S then hit once
      if (view.busted) {
        return this.settleBlackjackRound(roundId, code, { ...meta, playerHits: S + 1, player: view.player, playerValue: view.playerValue }, ruleset, false);
      }
      await this.prisma.gameRound.update({ where: { id: roundId }, data: { result: { ...meta, playerHits: S + 1, player: view.player, playerValue: view.playerValue } as unknown as Prisma.InputJsonValue } });
      return this.blackjackResponse((await this.prisma.gameRound.findUnique({ where: { id: roundId } }))!, code, await this.walletView(round));
    }

    if (action === 'STAND') {
      const claim = await this.prisma.gameRound.updateMany({ where: { id: roundId, status: GameRoundStatus.RESERVED, actionSeq: S }, data: { status: GameRoundStatus.RESOLVED } });
      if (claim.count === 0) return this.blackjackState(userId, roundId);
      return this.settleBlackjackRound(roundId, code, meta, ruleset, false);
    }

    if (action === 'DOUBLE') {
      if (S !== 0) throw new BadRequestException('Double is only allowed on the opening two cards');
      const claim = await this.prisma.gameRound.updateMany({ where: { id: roundId, status: GameRoundStatus.RESERVED, actionSeq: 0 }, data: { status: GameRoundStatus.RESOLVED, actionSeq: 1 } });
      if (claim.count === 0) return this.blackjackState(userId, roundId);
      // Additional reservation for the doubled stake (existing wallet architecture; no direct deduct).
      let reservation2: string;
      try {
        const r2 = await this.wallet.reserve(round.userId, round.currencyId, meta.stake, `round:${round.id}:2`, `${round.id}:reserve2`);
        reservation2 = r2.reservationId;
      } catch (err) {
        // Could not fund the double → revert to an actable hand (release nothing; original stays reserved).
        await this.prisma.gameRound.update({ where: { id: roundId }, data: { status: GameRoundStatus.RESERVED, actionSeq: 0 } });
        if (this.msg(err).toLowerCase().includes('insufficient')) throw new BadRequestException('Insufficient balance to double');
        throw err;
      }
      return this.settleBlackjackRound(roundId, code, { ...meta, doubled: true, reservation2, playerHits: 1 }, ruleset, true);
    }

    throw new BadRequestException(`Unsupported action "${action}"`);
  }

  /* =========================================================================
   *  PLINKO — single-shot. Reserve the stake → the frozen-ported Plinko engine
   *  drops the ball provably-fairly → payout = stake × the authoritative bin
   *  multiplier → commit once. The client never sends the bin/multiplier/payout.
   * ========================================================================= */

  async playPlinko(input: PlayPlinkoInput): Promise<PlinkoPlayResponse> {
    const { userId, rows, risk, stake, currencyCode, clientSeed, idempotencyKey } = input;

    await this.loadPlayer(userId);
    const currency = await this.loadCurrency(currencyCode);
    if (!PLINKO_ROWS.includes(rows)) throw new BadRequestException(`Unsupported rows (allowed: ${PLINKO_ROWS.join(', ')})`);
    if (!PLINKO_RISKS.includes(risk)) throw new BadRequestException(`Unsupported risk (allowed: ${PLINKO_RISKS.join(', ')})`);
    this.assertStake(stake, currency.decimals, PLINKO_LIMITS.min, PLINKO_LIMITS.max);

    const existing = await this.prisma.gameRound.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
    if (existing) return this.plinkoResponse(existing, currency.code, await this.walletView(existing), existing.status !== GameRoundStatus.CREATED);

    let round;
    try {
      round = await this.prisma.gameRound.create({
        data: { userId, gameKey: PLINKO_KEY, variant: 'plinko-pro', betType: `${rows}:${risk}`, currencyId: currency.id, stake, status: GameRoundStatus.CREATED, idempotencyKey },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const dup = await this.prisma.gameRound.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
        if (dup) return this.plinkoResponse(dup, currency.code, await this.walletView(dup), true);
      }
      throw err;
    }

    let reservationId: string;
    try {
      const reserved = await this.wallet.reserve(userId, currency.id, stake, `round:${round.id}`, `${round.id}:reserve`);
      reservationId = reserved.reservationId;
    } catch (err) {
      await this.fail(round.id, this.msg(err));
      if (this.msg(err).toLowerCase().includes('insufficient')) throw new BadRequestException('Insufficient balance');
      throw err;
    }
    await this.prisma.gameRound.update({ where: { id: round.id }, data: { status: GameRoundStatus.RESERVED, reservationId } });

    // Authoritative provably-fair drop.
    const commit = this.fair.createCommit();
    const seed = this.fair.deriveSeed(commit.serverSeed, clientSeed ?? commit.serverSeedHash, commit.nonce);
    let drop;
    try {
      drop = computePlinkoDrop(rows, risk, seed);
    } catch (err) {
      await this.safeRelease(reservationId, round.id);
      await this.fail(round.id, this.msg(err));
      throw new BadRequestException('Game execution failed; stake refunded');
    }
    const payout = this.money(Number(stake) * drop.multiplier, currency.decimals);
    const resultJson = { kind: PLINKO_KEY, rows, risk, bin: drop.bin, multiplier: drop.multiplier, dirs: drop.dirs, table: drop.table };
    await this.prisma.gameRound.update({
      where: { id: round.id },
      data: { status: GameRoundStatus.RESOLVED, payout, result: resultJson as unknown as Prisma.InputJsonValue, fairness: { serverSeed: commit.serverSeed, serverSeedHash: commit.serverSeedHash, clientSeed: clientSeed ?? commit.serverSeedHash, nonce: commit.nonce, seed } as unknown as Prisma.InputJsonValue },
    });

    let movement;
    try {
      movement = await this.wallet.commitReservation(reservationId, payout, `round:${round.id}`, `${round.id}:commit`);
    } catch (err) {
      await this.prisma.gameRound.update({ where: { id: round.id }, data: { status: GameRoundStatus.PENDING_SETTLEMENT, error: this.msg(err) } });
      this.logger.error(`Plinko round ${round.id} settlement failed → PENDING_SETTLEMENT: ${this.msg(err)}`);
      throw new ServiceUnavailableException('Settlement pending — the round will be recovered');
    }
    const settled = await this.prisma.gameRound.update({ where: { id: round.id }, data: { status: GameRoundStatus.SETTLED, betTransactionId: movement.transactionId, settledAt: new Date() } });
    return this.plinkoResponse(settled, currency.code, movement.wallet, false);
  }

  /* =========================================================================
   *  INSTANT GAMES (Limbo · Coin Flip · Wheel) — one generic single-shot method.
   *  Reserve the stake → the frozen-ported instant engine computes the outcome
   *  provably-fairly → payout = stake × the authoritative multiplier → commit once.
   *  The client sends ONLY its choice (target / side / risk); never the
   *  result/multiplier/payout. Same reserve→settle lifecycle as Plinko.
   * ========================================================================= */

  async playInstant(input: PlayInstantInput): Promise<InstantPlayResponse> {
    const { userId, gameKey, selection: rawSelection, stake, currencyCode, clientSeed, idempotencyKey } = input;

    await this.loadPlayer(userId);
    const currency = await this.loadCurrency(currencyCode);
    if (!INSTANT_GAMES.includes(gameKey)) throw new BadRequestException(`Unsupported game (allowed: ${INSTANT_GAMES.join(', ')})`);
    // Validate the player's choice BEFORE any reservation (bad input → 400, no money moves).
    let selection;
    try {
      selection = parseInstantSelection(gameKey, rawSelection ?? {});
    } catch (err) {
      throw new BadRequestException(this.msg(err));
    }
    this.assertStake(stake, currency.decimals, INSTANT_LIMITS.min, INSTANT_LIMITS.max);

    const existing = await this.prisma.gameRound.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
    if (existing) return this.instantResponse(existing, currency.code, await this.walletView(existing), existing.status !== GameRoundStatus.CREATED);

    let round;
    try {
      round = await this.prisma.gameRound.create({
        data: { userId, gameKey, variant: gameKey, betType: selection.betType, currencyId: currency.id, stake, status: GameRoundStatus.CREATED, idempotencyKey },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const dup = await this.prisma.gameRound.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
        if (dup) return this.instantResponse(dup, currency.code, await this.walletView(dup), true);
      }
      throw err;
    }

    let reservationId: string;
    try {
      const reserved = await this.wallet.reserve(userId, currency.id, stake, `round:${round.id}`, `${round.id}:reserve`);
      reservationId = reserved.reservationId;
    } catch (err) {
      await this.fail(round.id, this.msg(err));
      if (this.msg(err).toLowerCase().includes('insufficient')) throw new BadRequestException('Insufficient balance');
      throw err;
    }
    await this.prisma.gameRound.update({ where: { id: round.id }, data: { status: GameRoundStatus.RESERVED, reservationId } });

    // Authoritative provably-fair outcome.
    const commit = this.fair.createCommit();
    const seed = this.fair.deriveSeed(commit.serverSeed, clientSeed ?? commit.serverSeedHash, commit.nonce);
    let outcome;
    try {
      outcome = computeInstant(selection, seed);
    } catch (err) {
      await this.safeRelease(reservationId, round.id);
      await this.fail(round.id, this.msg(err));
      throw new BadRequestException('Game execution failed; stake refunded');
    }
    const payout = this.money(Number(stake) * outcome.multiplier, currency.decimals);
    const resultJson = { ...outcome.result, multiplier: outcome.multiplier, win: outcome.win };
    await this.prisma.gameRound.update({
      where: { id: round.id },
      data: { status: GameRoundStatus.RESOLVED, payout, result: resultJson as unknown as Prisma.InputJsonValue, fairness: { serverSeed: commit.serverSeed, serverSeedHash: commit.serverSeedHash, clientSeed: clientSeed ?? commit.serverSeedHash, nonce: commit.nonce, seed } as unknown as Prisma.InputJsonValue },
    });

    let movement;
    try {
      movement = await this.wallet.commitReservation(reservationId, payout, `round:${round.id}`, `${round.id}:commit`);
    } catch (err) {
      await this.prisma.gameRound.update({ where: { id: round.id }, data: { status: GameRoundStatus.PENDING_SETTLEMENT, error: this.msg(err) } });
      this.logger.error(`Instant round ${round.id} (${gameKey}) settlement failed → PENDING_SETTLEMENT: ${this.msg(err)}`);
      throw new ServiceUnavailableException('Settlement pending — the round will be recovered');
    }
    const settled = await this.prisma.gameRound.update({ where: { id: round.id }, data: { status: GameRoundStatus.SETTLED, betTransactionId: movement.transactionId, settledAt: new Date() } });
    return this.instantResponse(settled, currency.code, movement.wallet, false);
  }

  /* =========================================================================
   *  MINES — interactive. `startMines` reserves the stake and generates a HIDDEN,
   *  deterministic mine board. `minesReveal` reveals safe tiles (multiplier grows)
   *  or hits a mine (loss); `minesCashout` settles at the current multiplier.
   *  Actions are serialized exactly-once by the guarded `actionSeq` optimistic
   *  lock; the board is reconstructed from the seed each time (restart-safe).
   * ========================================================================= */

  async startMines(input: StartMinesInput): Promise<MinesResponse> {
    const { userId, stake, mines, currencyCode, clientSeed, idempotencyKey } = input;

    await this.loadPlayer(userId);
    const currency = await this.loadCurrency(currencyCode);
    this.assertStake(stake, currency.decimals, MINES_LIMITS.min, MINES_LIMITS.max);
    if (!Number.isInteger(mines) || mines < MINES_MIN || mines > MINES_MAX) throw new BadRequestException(`Mines must be ${MINES_MIN}–${MINES_MAX}`);

    const existing = await this.prisma.gameRound.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
    if (existing) return this.minesResponse(existing, currency.code, await this.walletView(existing));

    let round;
    try {
      round = await this.prisma.gameRound.create({
        data: { userId, gameKey: MINES_KEY, variant: 'mines', betType: `mines-${mines}`, currencyId: currency.id, stake, status: GameRoundStatus.CREATED, idempotencyKey },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const dup = await this.prisma.gameRound.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
        if (dup) return this.minesResponse(dup, currency.code, await this.walletView(dup));
      }
      throw err;
    }

    let reservationId: string;
    try {
      const reserved = await this.wallet.reserve(userId, currency.id, stake, `round:${round.id}`, `${round.id}:reserve`);
      reservationId = reserved.reservationId;
    } catch (err) {
      await this.fail(round.id, this.msg(err));
      if (this.msg(err).toLowerCase().includes('insufficient')) throw new BadRequestException('Insufficient balance');
      throw err;
    }

    const commit = this.fair.createCommit();
    const seed = this.fair.deriveSeed(commit.serverSeed, clientSeed ?? commit.serverSeedHash, commit.nonce);
    const meta: MinesMeta = {
      kind: MINES_KEY,
      serverSeed: commit.serverSeed,
      serverSeedHash: commit.serverSeedHash,
      clientSeed: clientSeed ?? commit.serverSeedHash,
      nonce: commit.nonce,
      seed,
      tiles: MINES_TILES,
      mines,
      stake,
      revealed: [],
      multiplier: 1,
    };
    const started = await this.prisma.gameRound.update({
      where: { id: round.id },
      data: { status: GameRoundStatus.RESERVED, reservationId, result: meta as unknown as Prisma.InputJsonValue, fairness: { serverSeedHash: commit.serverSeedHash, clientSeed: meta.clientSeed, nonce: commit.nonce } as unknown as Prisma.InputJsonValue },
    });
    return this.minesResponse(started, currency.code, await this.walletView(started));
  }

  /** Read the caller's mines round state (never reveals the board / server seed while active). */
  async minesState(userId: string, roundId: string): Promise<MinesResponse> {
    const round = await this.prisma.gameRound.findUnique({ where: { id: roundId } });
    if (!round || round.gameKey !== MINES_KEY) throw new NotFoundException('Mines round not found');
    if (round.userId !== userId) throw new ForbiddenException('Not your round');
    return this.minesResponse(round, await this.currencyCode(round.currencyId), await this.walletView(round));
  }

  /** Reveal one tile. Serialized exactly-once via the guarded actionSeq claim. */
  async minesReveal(input: { userId: string; roundId: string; index: number }): Promise<MinesResponse> {
    const { userId, roundId, index } = input;
    const round = await this.prisma.gameRound.findUnique({ where: { id: roundId } });
    if (!round || round.gameKey !== MINES_KEY) throw new NotFoundException('Mines round not found');
    if (round.userId !== userId) throw new ForbiddenException('Not your round');
    const code = await this.currencyCode(round.currencyId);
    if (round.status !== GameRoundStatus.RESERVED) {
      if (round.status === GameRoundStatus.PENDING_SETTLEMENT) return this.minesResponse(await this.recoverRound(round.id), code, await this.walletView(round));
      return this.minesResponse(round, code, await this.walletView(round)); // finished → idempotent replay
    }
    const meta = round.result as unknown as MinesMeta;
    const S = round.actionSeq;
    // Claim this reveal (optimistic lock). Only one action at seq S advances.
    const claim = await this.prisma.gameRound.updateMany({ where: { id: roundId, status: GameRoundStatus.RESERVED, actionSeq: S }, data: { actionSeq: S + 1 } });
    if (claim.count === 0) return this.minesState(userId, roundId); // concurrent/stale → current state

    let outcome;
    try {
      outcome = revealTile(meta.seed, meta.tiles, meta.mines, meta.revealed, index);
    } catch (err) {
      // Invalid tile → undo the claim, keep the round active.
      await this.prisma.gameRound.update({ where: { id: roundId }, data: { actionSeq: S } });
      throw new BadRequestException(this.msg(err));
    }
    if (outcome.hit) {
      // Mine → loss. Settle the reservation with payout 0 (stake consumed).
      return this.settleMines(roundId, code, { ...meta, revealed: meta.revealed, multiplier: 0, settled: { won: false, board: outcome.board!, revealed: meta.revealed, multiplier: 0, hit: index } }, '0');
    }
    if (outcome.cleared) {
      // Board fully cleared → auto cash-out at the max multiplier.
      const payout = this.money(Number(meta.stake) * outcome.multiplier, 8);
      return this.settleMines(roundId, code, { ...meta, revealed: outcome.revealed, multiplier: outcome.multiplier, settled: { won: true, board: outcome.board!, revealed: outcome.revealed, multiplier: outcome.multiplier } }, payout);
    }
    // Safe reveal → stay active.
    await this.prisma.gameRound.update({ where: { id: roundId }, data: { result: { ...meta, revealed: outcome.revealed, multiplier: outcome.multiplier } as unknown as Prisma.InputJsonValue } });
    return this.minesResponse((await this.prisma.gameRound.findUnique({ where: { id: roundId } }))!, code, await this.walletView(round));
  }

  /** Cash out the active mines round at the current multiplier. */
  async minesCashout(input: { userId: string; roundId: string }): Promise<MinesResponse> {
    const { userId, roundId } = input;
    const round = await this.prisma.gameRound.findUnique({ where: { id: roundId } });
    if (!round || round.gameKey !== MINES_KEY) throw new NotFoundException('Mines round not found');
    if (round.userId !== userId) throw new ForbiddenException('Not your round');
    const code = await this.currencyCode(round.currencyId);
    if (round.status !== GameRoundStatus.RESERVED) {
      if (round.status === GameRoundStatus.PENDING_SETTLEMENT) return this.minesResponse(await this.recoverRound(round.id), code, await this.walletView(round));
      return this.minesResponse(round, code, await this.walletView(round));
    }
    const meta = round.result as unknown as MinesMeta;
    if (meta.revealed.length === 0) throw new BadRequestException('Reveal at least one tile before cashing out');
    const S = round.actionSeq;
    const claim = await this.prisma.gameRound.updateMany({ where: { id: roundId, status: GameRoundStatus.RESERVED, actionSeq: S }, data: { status: GameRoundStatus.RESOLVED } });
    if (claim.count === 0) return this.minesState(userId, roundId);
    const mult = cashoutMultiplier(meta.tiles, meta.mines, meta.revealed.length);
    const payout = this.money(Number(meta.stake) * mult, 8);
    const board = mineBoard(meta.tiles, meta.mines, meta.seed); // reveal the board on settle
    return this.settleMines(roundId, code, { ...meta, multiplier: mult, settled: { won: true, board, revealed: meta.revealed, multiplier: mult } }, payout);
  }

  /** Commit a mines round exactly once (win or loss); PENDING_SETTLEMENT on commit failure. */
  private async settleMines(roundId: string, currencyCode: string, meta: MinesMeta, payout: string): Promise<MinesResponse> {
    const round = (await this.prisma.gameRound.findUnique({ where: { id: roundId } }))!;
    await this.prisma.gameRound.update({ where: { id: roundId }, data: { payout, result: meta as unknown as Prisma.InputJsonValue } });
    try {
      const movement = await this.wallet.commitReservation(round.reservationId!, payout, `round:${roundId}`, `${roundId}:commit`);
      const done = await this.prisma.gameRound.update({ where: { id: roundId }, data: { status: GameRoundStatus.SETTLED, betTransactionId: movement.transactionId, settledAt: new Date() } });
      return this.minesResponse(done, currencyCode, movement.wallet);
    } catch (err) {
      await this.prisma.gameRound.update({ where: { id: roundId }, data: { status: GameRoundStatus.PENDING_SETTLEMENT, error: this.msg(err) } });
      this.logger.error(`Mines round ${roundId} settlement failed → PENDING_SETTLEMENT: ${this.msg(err)}`);
      throw new ServiceUnavailableException('Settlement pending — the round will be recovered');
    }
  }

  /* --------------------------------- helpers -------------------------------- */

  /** Deterministically reconstruct a blackjack hand from the seed (replay `hits` player hits). */
  private reconstruct(meta: BlackjackMeta, ruleset: Awaited<ReturnType<CardVariantService['resolve']>>, hits: number, betAmount?: string) {
    const engine = new CardEngine(ruleset, meta.seed);
    const dealt = engine.dealBlackjack('bj', [{ key: 'main', amount: betAmount ?? meta.stake }]);
    let player = dealt.player;
    let busted = false;
    for (let i = 0; i < hits; i += 1) {
      const h = engine.blackjackHit();
      player = h.player;
      busted = h.busted;
    }
    const playerValue = blackjackValue(CardDeserializer.decodeMany(player));
    return { engine, player, playerValue, dealerUp: dealt.dealerUp, busted };
  }

  /** Resolve the dealer, settle the hand once, commit (both reservations when doubled). */
  private async settleBlackjackRound(roundId: string, currencyCode: string, meta: BlackjackMeta, ruleset: Awaited<ReturnType<CardVariantService['resolve']>>, doubled: boolean): Promise<BlackjackResponse> {
    const betAmount = doubled ? this.money(Number(meta.stake) * 2, 8) : meta.stake;
    const view = this.reconstruct(meta, ruleset, meta.playerHits, betAmount);
    const result = view.engine.blackjackResolve(); // dealer plays out + settlement (authoritative)
    const payout = result.settlement.totalWin;
    const totalStake = betAmount;
    const settledMeta: BlackjackMeta = {
      ...meta,
      settled: {
        player: (result.hands.player ?? view.player),
        dealer: (result.hands.dealer ?? []),
        playerValue: (result.details.playerValue as number) ?? view.playerValue,
        dealerValue: (result.details.dealerValue as number) ?? 0,
        winner: (result.details.winner as string) ?? 'dealer',
        payout,
        totalStake,
      },
      extraReservations: meta.reservation2 ? [{ reservationId: meta.reservation2, win: '0', reference: `round:${roundId}:2`, idempotencyKey: `${roundId}:commit2` }] : undefined,
    };
    const round = (await this.prisma.gameRound.findUnique({ where: { id: roundId } }))!;
    await this.prisma.gameRound.update({ where: { id: roundId }, data: { stake: totalStake, payout, result: settledMeta as unknown as Prisma.InputJsonValue } });

    try {
      // Commit the extra (doubled) reservation first (consumes its stake, credits 0), then the primary with the full payout.
      if (meta.reservation2) await this.wallet.commitReservation(meta.reservation2, '0', `round:${roundId}:2`, `${roundId}:commit2`);
      const movement = await this.wallet.commitReservation(round.reservationId!, payout, `round:${roundId}`, `${roundId}:commit`);
      const done = await this.prisma.gameRound.update({ where: { id: roundId }, data: { status: GameRoundStatus.SETTLED, betTransactionId: movement.transactionId, settledAt: new Date() } });
      return this.blackjackResponse(done, currencyCode, movement.wallet);
    } catch (err) {
      await this.prisma.gameRound.update({ where: { id: roundId }, data: { status: GameRoundStatus.PENDING_SETTLEMENT, error: this.msg(err) } });
      this.logger.error(`Blackjack round ${roundId} settlement failed → PENDING_SETTLEMENT: ${this.msg(err)}`);
      throw new ServiceUnavailableException('Settlement pending — the round will be recovered');
    }
  }

  private async loadPlayer(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new NotFoundException('Player not found');
    if (BLOCKED_STATUSES.has(user.status)) throw new ForbiddenException(`Account is ${user.status.toLowerCase()}`);
    return user;
  }

  private async loadCurrency(code: string) {
    const currency = await this.prisma.currency.findUnique({ where: { code: code.toUpperCase() } });
    if (!currency || !currency.isActive) throw new BadRequestException(`Unsupported currency "${code}"`);
    return currency;
  }

  private async walletView(round: { userId: string; currencyId: string }) {
    return this.wallet.getOrCreateWallet(round.userId, round.currencyId);
  }

  private async recoverRound(roundId: string) {
    await this.recover(roundId).catch(() => undefined);
    return (await this.prisma.gameRound.findUnique({ where: { id: roundId } }))!;
  }

  private crashMeta(round: { result: Prisma.JsonValue | null }): CrashMeta {
    const m = round.result as unknown as CrashMeta | null;
    if (!m || typeof m.seed !== 'string') throw new ConflictException('Crash round metadata missing');
    return m;
  }

  private betSummary(bets: Array<{ type: string }>): string {
    return [...new Set(bets.map((b) => b.type))].join('+').slice(0, 64) || 'multi';
  }

  private money(value: number, decimals: number): string {
    return value.toFixed(Math.min(Math.max(decimals, 0), 8));
  }

  private rouletteResponse(round: RoundRow, currencyCode: string, wallet: { available: string; total: string }, replayed: boolean): RoulettePlayResponse {
    const result = (round.result ?? {}) as { pocket?: number; pocketLabel?: string; color?: string; winningBets?: string[]; settlement?: unknown; bets?: unknown };
    const fairness = (round.fairness ?? {}) as { serverSeed?: string; serverSeedHash?: string; clientSeed?: string; nonce?: number };
    return {
      roundId: round.id,
      game: 'roulette',
      variant: round.variant,
      stake: round.stake.toString(),
      currency: currencyCode,
      status: round.status,
      pocket: result.pocket ?? -1,
      pocketLabel: result.pocketLabel ?? '',
      color: (result.color as 'red' | 'black' | 'green') ?? 'green',
      winningBets: result.winningBets ?? [],
      bets: (result.bets as RouletteBet[]) ?? [],
      settlement: (result.settlement as RoulettePlayResponse['settlement']) ?? { bets: [], totalBet: '0', totalWin: '0', net: '0' },
      payout: round.payout.toString(),
      balance: { available: wallet.available, total: wallet.total },
      reference: round.betTransactionId ?? round.id,
      provablyFair: { serverSeed: fairness.serverSeed ?? '', serverSeedHash: fairness.serverSeedHash ?? '', clientSeed: fairness.clientSeed ?? '', nonce: fairness.nonce ?? 0 },
      replayed,
    };
  }

  private sicBoResponse(round: RoundRow, currencyCode: string, wallet: { available: string; total: string }, replayed: boolean): SicBoPlayResponse {
    const result = (round.result ?? {}) as { values?: number[]; total?: number; isTriple?: boolean; winningBets?: string[]; settlement?: unknown; bets?: unknown };
    const fairness = (round.fairness ?? {}) as { serverSeed?: string; serverSeedHash?: string; clientSeed?: string; nonce?: number };
    return {
      roundId: round.id,
      game: 'sic-bo',
      variant: round.variant,
      stake: round.stake.toString(),
      currency: currencyCode,
      status: round.status,
      dice: result.values ?? [],
      total: result.total ?? 0,
      isTriple: result.isTriple ?? false,
      winningBets: result.winningBets ?? [],
      bets: (result.bets as SicBoPlayResponse['bets']) ?? [],
      settlement: (result.settlement as SicBoPlayResponse['settlement']) ?? { bets: [], totalBet: '0', totalWin: '0', net: '0' },
      payout: round.payout.toString(),
      balance: { available: wallet.available, total: wallet.total },
      reference: round.betTransactionId ?? round.id,
      provablyFair: { serverSeed: fairness.serverSeed ?? '', serverSeedHash: fairness.serverSeedHash ?? '', clientSeed: fairness.clientSeed ?? '', nonce: fairness.nonce ?? 0 },
      replayed,
    };
  }

  private lotteryTicketResponse(round: RoundRow, currencyCode: string, draw: LotteryDrawRow): LotteryTicketResponse {
    const meta = (round.result ?? {}) as { picks?: number[]; matches?: number; tier?: string | null; prize?: string; winningNumbers?: number[]; won?: boolean };
    const settled = round.status === GameRoundStatus.SETTLED || round.status === GameRoundStatus.RECOVERED;
    return {
      ticketId: round.id,
      game: 'number-lottery',
      drawId: draw.id,
      drawNumber: draw.drawNumber,
      drawStatus: draw.status,
      drawAt: draw.drawAt.toISOString(),
      picks: meta.picks ?? [],
      ticketPrice: round.stake.toString(),
      currency: currencyCode,
      status: round.status,
      settled,
      matches: meta.matches ?? null,
      tier: meta.tier ?? null,
      winningNumbers: settled ? meta.winningNumbers ?? draw.winningNumbers ?? [] : [],
      payout: round.payout.toString(),
      won: settled ? !!meta.won : null,
      reference: round.betTransactionId ?? round.id,
      provablyFair: {
        serverSeed: settled ? draw.serverSeed : '',
        serverSeedHash: draw.serverSeedHash,
        clientSeed: draw.clientSeed,
        nonce: draw.nonce,
      },
    };
  }

  private baccaratResponse(round: RoundRow, currencyCode: string, wallet: { available: string; total: string }, replayed: boolean): BaccaratPlayResponse {
    const result = (round.result ?? {}) as { hands?: Record<string, string[]>; winners?: string[]; winningBets?: string[]; isTie?: boolean; settlement?: unknown; bets?: unknown };
    const fairness = (round.fairness ?? {}) as { serverSeed?: string; serverSeedHash?: string; clientSeed?: string; nonce?: number };
    return {
      roundId: round.id,
      game: 'baccarat',
      variant: round.variant,
      stake: round.stake.toString(),
      currency: currencyCode,
      status: round.status,
      hands: result.hands ?? {},
      winners: result.winners ?? [],
      winningBets: result.winningBets ?? [],
      isTie: result.isTie ?? false,
      bets: (result.bets as BaccaratPlayResponse['bets']) ?? [],
      settlement: (result.settlement as BaccaratPlayResponse['settlement']) ?? { bets: [], totalBet: '0', totalWin: '0', net: '0' },
      payout: round.payout.toString(),
      balance: { available: wallet.available, total: wallet.total },
      reference: round.betTransactionId ?? round.id,
      provablyFair: { serverSeed: fairness.serverSeed ?? '', serverSeedHash: fairness.serverSeedHash ?? '', clientSeed: fairness.clientSeed ?? '', nonce: fairness.nonce ?? 0 },
      replayed,
    };
  }

  private cardResponse(round: RoundRow, currencyCode: string, wallet: { available: string; total: string }, replayed: boolean): CardPlayResponse {
    const result = (round.result ?? {}) as { hands?: Record<string, string[]>; winners?: string[]; winningBets?: string[]; isTie?: boolean; settlement?: unknown; bets?: unknown };
    const fairness = (round.fairness ?? {}) as { serverSeed?: string; serverSeedHash?: string; clientSeed?: string; nonce?: number };
    return {
      roundId: round.id,
      game: round.variant,
      variant: round.variant,
      stake: round.stake.toString(),
      currency: currencyCode,
      status: round.status,
      hands: result.hands ?? {},
      winners: result.winners ?? [],
      winningBets: result.winningBets ?? [],
      isTie: result.isTie ?? false,
      bets: (result.bets as CardPlayResponse['bets']) ?? [],
      settlement: (result.settlement as CardPlayResponse['settlement']) ?? { bets: [], totalBet: '0', totalWin: '0', net: '0' },
      payout: round.payout.toString(),
      balance: { available: wallet.available, total: wallet.total },
      reference: round.betTransactionId ?? round.id,
      provablyFair: { serverSeed: fairness.serverSeed ?? '', serverSeedHash: fairness.serverSeedHash ?? '', clientSeed: fairness.clientSeed ?? '', nonce: fairness.nonce ?? 0 },
      replayed,
    };
  }

  private blackjackResponse(round: RoundRow, currencyCode: string, wallet: { available: string; total: string }): BlackjackResponse {
    const meta = (round.result ?? {}) as Partial<BlackjackMeta>;
    const active = round.status === GameRoundStatus.RESERVED;
    const settled = meta.settled;
    const canDouble = active && (round.actionSeq ?? 0) === 0;
    return {
      roundId: round.id,
      game: 'blackjack',
      currency: currencyCode,
      status: round.status,
      active,
      stake: round.stake.toString(),
      doubled: !!meta.doubled,
      player: settled ? settled.player : meta.player ?? [],
      playerValue: settled ? settled.playerValue : meta.playerValue ?? 0,
      // Dealer hole card stays hidden while the hand is active.
      dealer: settled ? settled.dealer : meta.dealerUp ?? [],
      dealerValue: settled ? settled.dealerValue : null,
      dealerUpOnly: active,
      legalActions: active ? (canDouble ? ['HIT', 'STAND', 'DOUBLE'] : ['HIT', 'STAND']) : [],
      winner: settled ? settled.winner : null,
      payout: round.payout.toString(),
      balance: { available: wallet.available, total: wallet.total },
      reference: round.betTransactionId ?? round.id,
      provablyFair: {
        serverSeed: settled ? meta.serverSeed ?? '' : '',
        serverSeedHash: meta.serverSeedHash ?? '',
        clientSeed: meta.clientSeed ?? '',
        nonce: meta.nonce ?? 0,
      },
    };
  }

  private plinkoResponse(round: RoundRow, currencyCode: string, wallet: { available: string; total: string }, replayed: boolean): PlinkoPlayResponse {
    const result = (round.result ?? {}) as { rows?: number; risk?: PlinkoRisk; bin?: number; multiplier?: number; dirs?: number[]; table?: number[] };
    const fairness = (round.fairness ?? {}) as { serverSeed?: string; serverSeedHash?: string; clientSeed?: string; nonce?: number };
    return {
      roundId: round.id,
      game: 'plinko',
      variant: round.variant,
      rows: result.rows ?? 0,
      risk: result.risk ?? 'medium',
      bin: result.bin ?? -1,
      multiplier: result.multiplier ?? 0,
      dirs: result.dirs ?? [],
      table: result.table ?? [],
      stake: round.stake.toString(),
      currency: currencyCode,
      status: round.status,
      payout: round.payout.toString(),
      balance: { available: wallet.available, total: wallet.total },
      reference: round.betTransactionId ?? round.id,
      provablyFair: { serverSeed: fairness.serverSeed ?? '', serverSeedHash: fairness.serverSeedHash ?? '', clientSeed: fairness.clientSeed ?? '', nonce: fairness.nonce ?? 0 },
      replayed,
    };
  }

  private instantResponse(round: RoundRow, currencyCode: string, wallet: { available: string; total: string }, replayed: boolean): InstantPlayResponse {
    const result = (round.result ?? {}) as Record<string, unknown> & { multiplier?: number; win?: boolean };
    const fairness = (round.fairness ?? {}) as { serverSeed?: string; serverSeedHash?: string; clientSeed?: string; nonce?: number };
    return {
      roundId: round.id,
      game: round.variant as InstantGameKey,
      betType: round.betType,
      multiplier: result.multiplier ?? 0,
      win: result.win ?? false,
      result,
      stake: round.stake.toString(),
      currency: currencyCode,
      status: round.status,
      payout: round.payout.toString(),
      balance: { available: wallet.available, total: wallet.total },
      reference: round.betTransactionId ?? round.id,
      provablyFair: { serverSeed: fairness.serverSeed ?? '', serverSeedHash: fairness.serverSeedHash ?? '', clientSeed: fairness.clientSeed ?? '', nonce: fairness.nonce ?? 0 },
      replayed,
    };
  }

  private minesResponse(round: RoundRow, currencyCode: string, wallet: { available: string; total: string }): MinesResponse {
    const meta = (round.result ?? {}) as Partial<MinesMeta>;
    const active = round.status === GameRoundStatus.RESERVED;
    const settled = meta.settled;
    const tiles = meta.tiles ?? MINES_TILES;
    const mines = meta.mines ?? 0;
    const revealed = settled ? settled.revealed : meta.revealed ?? [];
    const nextMult = active ? cashoutMultiplier(tiles, mines, revealed.length) : (settled?.multiplier ?? 0);
    return {
      roundId: round.id,
      game: 'mines',
      currency: currencyCode,
      status: round.status,
      active,
      stake: round.stake.toString(),
      tiles,
      mines,
      revealed,
      // Current cash-out multiplier + potential payout while active; final on settle.
      multiplier: nextMult,
      potentialPayout: this.money(Number(round.stake) * nextMult, 8),
      // The mine board is revealed ONLY once the round is over.
      board: settled ? settled.board : null,
      hit: settled?.hit ?? null,
      won: settled ? !!settled.won : null,
      payout: round.payout.toString(),
      balance: { available: wallet.available, total: wallet.total },
      reference: round.betTransactionId ?? round.id,
      provablyFair: {
        serverSeed: settled ? meta.serverSeed ?? '' : '',
        serverSeedHash: meta.serverSeedHash ?? '',
        clientSeed: meta.clientSeed ?? '',
        nonce: meta.nonce ?? 0,
      },
    };
  }

  private crashResponse(round: RoundRow, currencyCode: string, wallet: { available: string; total: string }, replayed: boolean): CrashPlayResponse {
    const meta = (round.result ?? {}) as Partial<CrashMeta>;
    const running = round.status === GameRoundStatus.RESERVED;
    const settled = meta.settled;
    return {
      roundId: round.id,
      game: 'crash',
      variant: round.variant,
      stake: round.stake.toString(),
      currency: currencyCode,
      status: round.status,
      running,
      startedAtMs: meta.startedAtMs ?? 0,
      serverSeedHash: meta.serverSeedHash ?? '',
      clientSeed: meta.clientSeed ?? '',
      autoCashout: meta.autoCashout ?? null,
      growthRatePerSecond: meta.growthRatePerSecond ?? 0,
      maxMultiplier: meta.maxMultiplier ?? 0,
      // Revealed ONLY once the round is no longer running.
      crashPoint: running ? null : settled?.crashPoint ?? meta.crashPoint ?? null,
      cashoutMultiplier: running ? null : settled?.cashedOutAt ?? null,
      won: running ? null : !!settled?.won,
      payout: round.payout.toString(),
      balance: { available: wallet.available, total: wallet.total },
      reference: round.betTransactionId ?? round.id,
      provablyFair: running
        ? { serverSeed: '', serverSeedHash: meta.serverSeedHash ?? '', clientSeed: meta.clientSeed ?? '', nonce: meta.nonce ?? 0 }
        : { serverSeed: meta.serverSeed ?? '', serverSeedHash: meta.serverSeedHash ?? '', clientSeed: meta.clientSeed ?? '', nonce: meta.nonce ?? 0 },
      replayed,
    };
  }

  /* ----------------------------- shared helpers ----------------------------- */

  private async resolveExisting(round: RoundRow, currencyCode: string): Promise<PlayDiceResponse> {
    if (round.status === GameRoundStatus.SETTLED || round.status === GameRoundStatus.RECOVERED) {
      const wallet = await this.wallet.getOrCreateWallet(round.userId, round.currencyId);
      return this.toResponse(round, currencyCode, wallet, true);
    }
    if (round.status === GameRoundStatus.PENDING_SETTLEMENT) return this.recover(round.id);
    if (round.status === GameRoundStatus.FAILED) throw new ConflictException('The previous attempt failed; retry with a new idempotency key');
    if (round.status === GameRoundStatus.RECOVERY_FAILED) throw new ConflictException('This round needs manual settlement recovery — contact support');
    // CREATED / RESERVED / RESOLVED / RECOVERING — a concurrent operation is still in flight.
    throw new ConflictException('Round already in progress');
  }

  private toResponse(round: RoundRow, currencyCode: string, wallet: { available: string; total: string }, replayed: boolean): PlayDiceResponse {
    const result = (round.result ?? {}) as { values?: number[]; total?: number; isTriple?: boolean; winningBets?: string[] };
    const fairness = (round.fairness ?? {}) as { serverSeed?: string; serverSeedHash?: string; clientSeed?: string; nonce?: number };
    const won = Number(round.payout) > 0;
    return {
      roundId: round.id,
      game: GAME_KEY,
      variant: round.variant,
      betType: round.betType,
      stake: round.stake.toString(),
      currency: currencyCode,
      status: round.status,
      result: { values: result.values ?? [], total: result.total ?? 0, isTriple: result.isTriple ?? false, won, winningBets: result.winningBets ?? [] },
      payout: round.payout.toString(),
      balance: { available: wallet.available, total: wallet.total },
      reference: round.betTransactionId ?? round.id,
      provablyFair: {
        serverSeed: fairness.serverSeed ?? '',
        serverSeedHash: fairness.serverSeedHash ?? '',
        clientSeed: fairness.clientSeed ?? '',
        nonce: fairness.nonce ?? 0,
      },
      replayed,
    };
  }

  private assertStake(stake: string, decimals: number, min: number, max: number): void {
    const dp = stake.includes('.') ? stake.split('.')[1]!.length : 0;
    if (dp > decimals) throw new BadRequestException(`Stake exceeds ${decimals} decimal places for this currency`);
    const value = Number(stake);
    if (!Number.isFinite(value) || value <= 0) throw new BadRequestException('Stake must be positive');
    if (value < min) throw new BadRequestException(`Stake below minimum (${min})`);
    if (value > max) throw new BadRequestException(`Stake above maximum (${max})`);
  }

  private async fail(roundId: string, error: string): Promise<void> {
    await this.prisma.gameRound.update({ where: { id: roundId }, data: { status: GameRoundStatus.FAILED, error } }).catch(() => undefined);
  }

  private async safeRelease(reservationId: string, roundId: string): Promise<void> {
    try {
      await this.wallet.releaseReservation(reservationId, `${roundId}:release`);
    } catch (err) {
      this.logger.error(`Failed to release reservation ${reservationId} for round ${roundId}: ${this.msg(err)}`);
    }
  }

  private async currencyCode(currencyId: string): Promise<string> {
    const c = await this.prisma.currency.findUnique({ where: { id: currencyId }, select: { code: true } });
    return c?.code ?? '';
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}

type RoundRow = {
  id: string;
  userId: string;
  variant: string;
  betType: string;
  currencyId: string;
  stake: Prisma.Decimal;
  payout: Prisma.Decimal;
  status: GameRoundStatus;
  betTransactionId: string | null;
  reservationId: string | null;
  actionSeq?: number;
  result: Prisma.JsonValue | null;
  fairness: Prisma.JsonValue | null;
};

/* --------------------------------- baccarat -------------------------------- */

export interface PlayBaccaratInput {
  userId: string;
  bets: Array<{ type: string; amount: string }>;
  currencyCode: string;
  clientSeed?: string;
  idempotencyKey: string;
}
export interface PlayCardInput {
  userId: string;
  variant: string;
  bets: Array<{ type: string; amount: string }>;
  currencyCode: string;
  clientSeed?: string;
  idempotencyKey: string;
}
export interface CardPlayResponse {
  roundId: string;
  game: string;
  variant: string;
  stake: string;
  currency: string;
  status: GameRoundStatus;
  hands: Record<string, string[]>;
  winners: string[];
  winningBets: string[];
  isTie: boolean;
  bets: Array<{ type: string; amount: string }>;
  settlement: { bets: CardBetSettlement[]; totalBet: string; totalWin: string; net: string };
  payout: string;
  balance: { available: string; total: string };
  reference: string;
  provablyFair: { serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number };
  replayed: boolean;
}

export interface CardBetSettlement {
  key: string;
  amount: string;
  outcome: 'won' | 'lost' | 'push';
  payout: number;
  returned: string;
}

export interface BaccaratPlayResponse {
  roundId: string;
  game: 'baccarat';
  variant: string;
  stake: string;
  currency: string;
  status: GameRoundStatus;
  hands: Record<string, string[]>;
  winners: string[];
  winningBets: string[];
  isTie: boolean;
  bets: Array<{ type: string; amount: string }>;
  settlement: { bets: CardBetSettlement[]; totalBet: string; totalWin: string; net: string };
  payout: string;
  balance: { available: string; total: string };
  reference: string;
  provablyFair: { serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number };
  replayed: boolean;
}

/* -------------------------------- blackjack -------------------------------- */

export interface StartBlackjackInput {
  userId: string;
  stake: string;
  currencyCode: string;
  clientSeed?: string;
  idempotencyKey: string;
}

export type BlackjackActionKind = 'HIT' | 'STAND' | 'DOUBLE';

export interface BlackjackActionInput {
  userId: string;
  roundId: string;
  action: BlackjackActionKind;
}

/** Server-only interactive blackjack state, persisted in `GameRound.result`. */
interface BlackjackMeta {
  kind: 'blackjack';
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  seed: string;
  stake: string;
  playerHits: number;
  doubled: boolean;
  reservation2?: string;
  extraReservations?: Array<{ reservationId: string; win: string; reference?: string; idempotencyKey?: string }>;
  // Display snapshots (recomputed deterministically; safe to persist).
  player?: string[];
  playerValue?: number;
  dealerUp?: string[];
  settled?: { player: string[]; dealer: string[]; playerValue: number; dealerValue: number; winner: string; payout: string; totalStake: string };
}

export interface BlackjackResponse {
  roundId: string;
  game: 'blackjack';
  currency: string;
  status: GameRoundStatus;
  active: boolean;
  stake: string;
  doubled: boolean;
  player: string[];
  playerValue: number;
  dealer: string[];
  dealerValue: number | null;
  dealerUpOnly: boolean;
  legalActions: BlackjackActionKind[];
  winner: string | null;
  payout: string;
  balance: { available: string; total: string };
  reference: string;
  provablyFair: { serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number };
}

/* ---------------------------------- sic bo --------------------------------- */

export interface PlaySicBoInput {
  userId: string;
  variant: string;
  bets: Array<{ type: string; amount: string }>;
  currencyCode: string;
  clientSeed?: string;
  idempotencyKey: string;
}

export interface SicBoBetSettlement {
  type: string;
  amount: string;
  outcome: 'won' | 'lost';
  payout: number;
  returned: string;
}

export interface SicBoPlayResponse {
  roundId: string;
  game: 'sic-bo';
  variant: string;
  stake: string;
  currency: string;
  status: GameRoundStatus;
  dice: number[];
  total: number;
  isTriple: boolean;
  winningBets: string[];
  bets: Array<{ type: string; amount: string }>;
  settlement: { bets: SicBoBetSettlement[]; totalBet: string; totalWin: string; net: string };
  payout: string;
  balance: { available: string; total: string };
  reference: string;
  provablyFair: { serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number };
  replayed: boolean;
}

/* ------------------------------- number lottery ---------------------------- */

export interface BuyLotteryTicketInput {
  userId: string;
  picks: number[];
  currencyCode: string;
  idempotencyKey: string;
}

/** The subset of a LotteryDraw row the bridge needs (avoids a hard Prisma type import). */
export interface LotteryDrawRow {
  id: string;
  drawNumber: number;
  status: string;
  poolSize: number;
  pick: number;
  ticketPrice: Prisma.Decimal;
  currencyId: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  winningNumbers: number[];
  drawAt: Date;
}

export interface LotteryTicketResponse {
  ticketId: string;
  game: 'number-lottery';
  drawId: string;
  drawNumber: number;
  drawStatus: string;
  drawAt: string;
  picks: number[];
  ticketPrice: string;
  currency: string;
  status: GameRoundStatus;
  settled: boolean;
  matches: number | null;
  tier: string | null;
  winningNumbers: number[];
  payout: string;
  won: boolean | null;
  reference: string;
  provablyFair: { serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number };
}

/* --------------------------------- roulette -------------------------------- */

export interface PlayRouletteInput {
  userId: string;
  variant: string;
  bets: Array<{ type: string; amount: string; selection?: number[] }>;
  currencyCode: string;
  clientSeed?: string;
  idempotencyKey: string;
}

export interface RouletteBetSettlement {
  type: string;
  amount: string;
  selection: number[];
  outcome: 'won' | 'lost' | 'push';
  payout: number;
  returned: string;
}

export interface RoulettePlayResponse {
  roundId: string;
  game: 'roulette';
  variant: string;
  stake: string;
  currency: string;
  status: GameRoundStatus;
  pocket: number;
  pocketLabel: string;
  color: 'red' | 'black' | 'green';
  winningBets: string[];
  bets: Array<{ type: string; amount: string; selection?: number[] }>;
  settlement: { bets: RouletteBetSettlement[]; totalBet: string; totalWin: string; net: string };
  payout: string;
  balance: { available: string; total: string };
  reference: string;
  provablyFair: { serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number };
  replayed: boolean;
}

/* ---------------------------------- crash ---------------------------------- */

export interface PlayCrashInput {
  userId: string;
  variant: string;
  stake: string;
  currencyCode: string;
  autoCashout?: number | null;
  clientSeed?: string;
  idempotencyKey: string;
}

/** Server-only crash round state, persisted in `GameRound.result`. */
interface CrashMeta {
  kind: 'crash';
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  seed: string;
  crashPoint: number;
  crashTimeMs: number;
  startedAtMs: number;
  autoCashout: number | null;
  growthRatePerSecond: number;
  minMultiplier: number;
  maxMultiplier: number;
  settled?: { cashedOutAt: number | null; won: boolean; payout: string; reason: 'cashout' | 'expired'; crashPoint: number };
}

export interface CrashPlayResponse {
  roundId: string;
  game: 'crash';
  variant: string;
  stake: string;
  currency: string;
  status: GameRoundStatus;
  running: boolean;
  startedAtMs: number;
  serverSeedHash: string;
  clientSeed: string;
  autoCashout: number | null;
  growthRatePerSecond: number;
  maxMultiplier: number;
  /** Revealed only after the round settles (null while running). */
  crashPoint: number | null;
  cashoutMultiplier: number | null;
  won: boolean | null;
  payout: string;
  balance: { available: string; total: string };
  reference: string;
  provablyFair: { serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number };
  replayed: boolean;
}

/* ---------------------------------- plinko --------------------------------- */

export interface PlayPlinkoInput {
  userId: string;
  rows: number;
  risk: PlinkoRisk;
  stake: string;
  currencyCode: string;
  clientSeed?: string;
  idempotencyKey: string;
}

export interface PlayInstantInput {
  userId: string;
  gameKey: InstantGameKey;
  /** The player's choice only: `{ target }` (limbo) | `{ side }` (coin-flip) | `{ risk }` (wheel). */
  selection: Record<string, unknown>;
  stake: string;
  currencyCode: string;
  clientSeed?: string;
  idempotencyKey: string;
}
export interface InstantPlayResponse {
  roundId: string;
  game: InstantGameKey;
  betType: string;
  multiplier: number;
  win: boolean;
  result: Record<string, unknown>;
  stake: string;
  currency: string;
  status: GameRoundStatus;
  payout: string;
  balance: { available: string; total: string };
  reference: string;
  provablyFair: { serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number };
  replayed: boolean;
}
export interface PlinkoPlayResponse {
  roundId: string;
  game: 'plinko';
  variant: string;
  rows: number;
  risk: PlinkoRisk;
  bin: number;
  multiplier: number;
  dirs: number[];
  table: number[];
  stake: string;
  currency: string;
  status: GameRoundStatus;
  payout: string;
  balance: { available: string; total: string };
  reference: string;
  provablyFair: { serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number };
  replayed: boolean;
}

/* ----------------------------------- mines --------------------------------- */

export interface StartMinesInput {
  userId: string;
  stake: string;
  mines: number;
  currencyCode: string;
  clientSeed?: string;
  idempotencyKey: string;
}

/** Server-only interactive mines state, persisted in `GameRound.result`. */
interface MinesMeta {
  kind: 'mines';
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  seed: string;
  tiles: number;
  mines: number;
  stake: string;
  revealed: number[];
  multiplier: number;
  settled?: { won: boolean; board: number[]; revealed: number[]; multiplier: number; hit?: number };
}

export interface MinesResponse {
  roundId: string;
  game: 'mines';
  currency: string;
  status: GameRoundStatus;
  active: boolean;
  stake: string;
  tiles: number;
  mines: number;
  revealed: number[];
  multiplier: number;
  potentialPayout: string;
  /** Mine positions — null while the round is active; revealed only on settle. */
  board: number[] | null;
  hit: number | null;
  won: boolean | null;
  payout: string;
  balance: { available: string; total: string };
  reference: string;
  provablyFair: { serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number };
}
