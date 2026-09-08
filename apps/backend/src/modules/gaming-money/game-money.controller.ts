import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponsibleGamingGuard, RgProtected } from '../responsible-gaming/responsible-gaming.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../authorization/rbac.constants';
import { DiceVariantService } from '../dice/services/dice-variant.service';
import { CrashVariantService } from '../crash/services/crash-variant.service';
import { RouletteVariantService } from '../roulette/services/roulette-variant.service';
import { CardVariantService } from '../card/services/card-variant.service';
import { PlayDiceDto } from './dto/play-game.dto';
import { CashoutCrashDto, PlayCrashDto } from './dto/play-crash.dto';
import { PlayRouletteDto } from './dto/play-roulette.dto';
import { PlaySicBoDto } from './dto/play-sic-bo.dto';
import { BuyLotteryTicketDto } from './dto/buy-lottery-ticket.dto';
import { PlayBaccaratDto } from './dto/play-baccarat.dto';
import { BlackjackActionDto, StartBlackjackDto } from './dto/blackjack.dto';
import { PlayPlinkoDto } from './dto/play-plinko.dto';
import { MinesRevealDto, StartMinesDto } from './dto/mines.dto';
import { PlayCoinFlipDto, PlayLimboDto, PlayWheelDto } from './dto/play-instant.dto';
import { PlayCardDto } from './dto/play-card.dto';
import { instantConfig } from './engines/instant-engine';
import { PLINKO_RISKS, PLINKO_ROWS, plinkoTable, type PlinkoRisk } from './engines/plinko-engine';
import { MINES_MAX, MINES_MIN, MINES_TILES, gridMultiplier } from './engines/mines-engine';
import { GameHistoryQueryDto } from './dto/game-history.dto';
import { GameMoneyBridgeService } from './game-money-bridge.service';
import { GameMoneyHistoryService } from './game-money-history.service';
import { GameMoneyRecoveryService } from './game-money-recovery.service';
import { LotteryDrawService } from './lottery-draw.service';
import { ActivityType } from '@prisma/client';
import { ActivityEventService } from '../events/activity-event.service';

const DEFAULT_VARIANT = 'sic-bo';
const SIMPLE_BETS = ['big', 'small', 'odd', 'even'];
const CRASH_VARIANT = 'crash';
const ROULETTE_VARIANT = 'european';
const SICBO_VARIANT = 'sic-bo';

/**
 * Real-money game API (Phase 2B). Authenticated by the global `JwtAuthGuard`; the userId
 * is taken from the JWT (`@CurrentUser('id')`) and never from the client body. This is a
 * thin adapter over {@link GameMoneyBridgeService}.
 */
@ApiTags('Games (real money)')
@ApiBearerAuth()
@Controller('games')
// Responsible gaming is enforced BEFORE any handler here runs, so no stake can be reserved while a
// self-exclusion, cooling-off, wager cap or loss cap blocks it. Applied at CONTROLLER level on
// purpose: a play route added later is protected by default rather than needing to be remembered.
// This is an ADDITIVE layer — GameMoneyBridgeService and the WalletEngine are untouched.
@UseGuards(ResponsibleGamingGuard)
@RgProtected('WAGER')
export class GameMoneyController {
  constructor(
    private readonly bridge: GameMoneyBridgeService,
    private readonly variants: DiceVariantService,
    private readonly crashVariants: CrashVariantService,
    private readonly rouletteVariants: RouletteVariantService,
    private readonly recovery: GameMoneyRecoveryService,
    private readonly lotteryDraws: LotteryDrawService,
    private readonly cardVariants: CardVariantService,
    private readonly history: GameMoneyHistoryService,
    private readonly events: ActivityEventService,
  ) {}

  /* -------------------------------- history --------------------------------- */

  @Get('history')
  @ApiOperation({ summary: 'My game history (rounds, stake/payout/netResult; filter + paginate)' })
  gameHistory(@CurrentUser('id') userId: string, @Query() query: GameHistoryQueryDto) {
    return this.history.listRounds(userId, query);
  }

  @Get('history/:roundId')
  @ApiOperation({ summary: 'Full traceability for one of my rounds (round → reservation → transactions → ledger)' })
  roundDetails(@CurrentUser('id') userId: string, @Param('roundId') roundId: string) {
    return this.history.roundDetails(userId, roundId);
  }

  @Get('dice/config')
  @ApiOperation({ summary: 'Dice money-game config (limits + bet options) for the client' })
  async config() {
    const ruleset = await this.variants.resolve(DEFAULT_VARIANT);
    return {
      variant: ruleset.key,
      name: ruleset.name,
      limits: ruleset.limits,
      bets: ruleset.bets.filter((b) => SIMPLE_BETS.includes(b.key)).map((b) => ({ key: b.key, label: b.label, payout: b.payout })),
    };
  }

  @Post('dice/play')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Play one real-money dice round (stake → engine → settlement)' })
  async play(@CurrentUser('id') userId: string, @Body() dto: PlayDiceDto) {
    const result = await this.bridge.playDice({
      userId,
      variant: dto.variant,
      betType: dto.betType,
      stake: dto.stake,
      currencyCode: dto.currency,
      clientSeed: dto.clientSeed,
      idempotencyKey: dto.idempotencyKey,
    });
    // Phase 2D.9 (X-02): emitted HERE, at the controller, never inside the frozen GameMoneyBridge.
    // Keyed by the round id, so a replayed idempotent request records exactly one event.
    await this.events.record({
      userId, type: ActivityType.GAME_PLAY, eventKey: `round:${result.roundId}`,
      metadata: { gameKey: 'dice', variant: dto.variant, currency: dto.currency },
    });
    return result;
  }

  /* --------------------------------- crash ---------------------------------- */

  @Get('crash/config')
  @ApiOperation({ summary: 'Crash money-game config (limits + curve params) for the client' })
  async crashConfig() {
    const rs = await this.crashVariants.resolve(CRASH_VARIANT);
    return {
      variant: rs.key,
      name: rs.name,
      limits: rs.limits,
      minMultiplier: rs.minMultiplier,
      maxMultiplier: rs.maxMultiplier,
      growthRatePerSecond: rs.growthRatePerSecond,
    };
  }

  @Get('crash/state')
  @ApiOperation({ summary: "The caller's active crash round (running), if any" })
  crashState(@CurrentUser('id') userId: string) {
    return this.bridge.activeCrashRound(userId);
  }

  @Post('crash/play')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start one real-money crash round (reserve stake → running)' })
  playCrash(@CurrentUser('id') userId: string, @Body() dto: PlayCrashDto) {
    return this.bridge.playCrash({
      userId,
      variant: dto.variant,
      stake: dto.stake,
      currencyCode: dto.currency,
      autoCashout: dto.autoCashout ?? null,
      clientSeed: dto.clientSeed,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  @Post('crash/cashout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cash out the active crash round at the server-authoritative multiplier' })
  cashoutCrash(@CurrentUser('id') userId: string, @Body() dto: CashoutCrashDto) {
    return this.bridge.cashoutCrash({ userId, roundId: dto.roundId, idempotencyKey: dto.idempotencyKey });
  }

  /* -------------------------------- roulette -------------------------------- */

  @Get('roulette/config')
  @ApiOperation({ summary: 'Roulette money-game config (bet board + limits + wheel) for the client' })
  async rouletteConfig() {
    const rs = await this.rouletteVariants.resolve(ROULETTE_VARIANT);
    return {
      variant: rs.key,
      name: rs.name,
      limits: rs.limits,
      maxNumber: rs.layout.maxNumber,
      greenPockets: rs.layout.greenPockets,
      redNumbers: rs.layout.redNumbers,
      betTypes: rs.betTypes.map((b) => ({ key: b.key, label: b.label, category: b.category, payout: b.payout, selectionSize: b.selectionSize ?? null })),
    };
  }

  @Post('roulette/play')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Play one real-money roulette spin (multi-bet → one settlement)' })
  playRoulette(@CurrentUser('id') userId: string, @Body() dto: PlayRouletteDto) {
    return this.bridge.playRoulette({
      userId,
      variant: dto.variant,
      bets: dto.bets,
      currencyCode: dto.currency,
      clientSeed: dto.clientSeed,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  /* --------------------------------- sic bo --------------------------------- */

  @Get('sic-bo/config')
  @ApiOperation({ summary: 'Sic Bo money-game config (full bet board + limits) for the client' })
  async sicBoConfig() {
    const rs = await this.variants.resolve(SICBO_VARIANT);
    return {
      variant: rs.key,
      name: rs.name,
      limits: rs.limits,
      diceCount: rs.diceCount,
      faces: rs.faces,
      bets: rs.bets.map((b: { key: string; label: string; category: string; payout: number }) => ({ key: b.key, label: b.label, category: b.category, payout: b.payout })),
    };
  }

  @Post('sic-bo/play')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Play one real-money Sic Bo board (multi-bet → one roll → one settlement)' })
  playSicBo(@CurrentUser('id') userId: string, @Body() dto: PlaySicBoDto) {
    return this.bridge.playSicBo({
      userId,
      variant: dto.variant,
      bets: dto.bets,
      currencyCode: dto.currency,
      clientSeed: dto.clientSeed,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  /* ----------------------------- number lottery ----------------------------- */

  @Get('lottery/config')
  @ApiOperation({ summary: 'Number-Lottery config (pool, pick, ticket price, prize tiers)' })
  lotteryConfig() {
    const c = this.lotteryDraws.config;
    return { pool: c.pool, pick: c.pick, ticketPrice: c.ticketPrice, currency: c.currency, prizeTiers: c.prizeTiers };
  }

  @Get('lottery/draw')
  @ApiOperation({ summary: 'The current open draw (id, number, draw time, commitment)' })
  async lotteryDraw() {
    return this.lotteryDraws.toJsonDraw(await this.lotteryDraws.currentOpenDraw());
  }

  @Get('lottery/tickets')
  @ApiOperation({ summary: "The caller's recent lottery tickets + results" })
  myLotteryTickets(@CurrentUser('id') userId: string) {
    return this.lotteryDraws.myTickets(userId);
  }

  @Post('lottery/buy')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Buy one lottery ticket (reserve price → pending shared draw)' })
  async buyLotteryTicket(@CurrentUser('id') userId: string, @Body() dto: BuyLotteryTicketDto) {
    const draw = await this.lotteryDraws.getDrawForPurchase(dto.drawId);
    return this.bridge.buyLotteryTicket({ userId, picks: dto.picks, currencyCode: dto.currency, idempotencyKey: dto.idempotencyKey }, draw);
  }

  /* -------------------------------- baccarat -------------------------------- */

  @Get('baccarat/config')
  @ApiOperation({ summary: 'Baccarat money-game config (bet board + limits) for the client' })
  async baccaratConfig() {
    const rs = await this.cardVariants.resolve('baccarat');
    return { variant: rs.key, name: rs.name, limits: rs.betLimits, bets: rs.bets.map((b: { key: string; label: string; payout: number }) => ({ key: b.key, label: b.label, payout: b.payout })) };
  }

  @Post('baccarat/play')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Play one real-money Baccarat round (multi-bet → one deal → one settlement)' })
  playBaccarat(@CurrentUser('id') userId: string, @Body() dto: PlayBaccaratDto) {
    return this.bridge.playBaccarat({ userId, bets: dto.bets, currencyCode: dto.currency, clientSeed: dto.clientSeed, idempotencyKey: dto.idempotencyKey });
  }

  /* ------------------------------- blackjack -------------------------------- */

  @Get('blackjack/config')
  @ApiOperation({ summary: 'Blackjack money-game config (limits, dealer rule, supported actions)' })
  async blackjackConfig() {
    const rs = await this.cardVariants.resolve('blackjack');
    return { variant: rs.key, name: rs.name, limits: rs.betLimits, dealerStandValue: rs.dealerStandValue, payout: rs.bets[0]?.payout ?? 2, actions: ['HIT', 'STAND', 'DOUBLE'], unsupported: ['SPLIT', 'INSURANCE'] };
  }

  @Post('blackjack/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start one real-money Blackjack hand (reserve stake → deal)' })
  startBlackjack(@CurrentUser('id') userId: string, @Body() dto: StartBlackjackDto) {
    return this.bridge.startBlackjack({ userId, stake: dto.stake, currencyCode: dto.currency, clientSeed: dto.clientSeed, idempotencyKey: dto.idempotencyKey });
  }

  @Get('blackjack/:roundId')
  @ApiOperation({ summary: "Read the caller's blackjack hand state (hole card hidden while active)" })
  blackjackState(@CurrentUser('id') userId: string, @Param('roundId') roundId: string) {
    return this.bridge.blackjackState(userId, roundId);
  }

  @Post('blackjack/:roundId/action')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply a blackjack action (HIT / STAND / DOUBLE) to the active hand' })
  blackjackAction(@CurrentUser('id') userId: string, @Param('roundId') roundId: string, @Body() dto: BlackjackActionDto) {
    return this.bridge.blackjackAction({ userId, roundId, action: dto.action });
  }

  /* --------------------------------- plinko --------------------------------- */

  @Get('plinko/config')
  @ApiOperation({ summary: 'Plinko config (rows, risks, per-board multiplier tables, limits)' })
  plinkoConfig() {
    const boards = PLINKO_ROWS.flatMap((rows) => PLINKO_RISKS.map((risk) => ({ rows, risk, multipliers: plinkoTable(rows, risk as PlinkoRisk) })));
    return { rows: PLINKO_ROWS, risks: PLINKO_RISKS, limits: { min: 1, max: 10000 }, boards };
  }

  @Post('plinko/play')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Play one real-money Plinko drop (reserve → engine → settle)' })
  playPlinko(@CurrentUser('id') userId: string, @Body() dto: PlayPlinkoDto) {
    return this.bridge.playPlinko({ userId, rows: dto.rows, risk: dto.risk, stake: dto.stake, currencyCode: dto.currency, clientSeed: dto.clientSeed, idempotencyKey: dto.idempotencyKey });
  }

  /* ------------------------- instant games (single-shot) ------------------------- */

  @Get('limbo/config')
  @ApiOperation({ summary: 'Limbo config (min target, max multiplier, house edge, limits)' })
  limboConfig() {
    return instantConfig('limbo');
  }

  @Post('limbo/play')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Play one real-money Limbo round (reserve → engine → settle)' })
  playLimbo(@CurrentUser('id') userId: string, @Body() dto: PlayLimboDto) {
    return this.bridge.playInstant({ userId, gameKey: 'limbo', selection: { target: dto.target }, stake: dto.stake, currencyCode: dto.currency, clientSeed: dto.clientSeed, idempotencyKey: dto.idempotencyKey });
  }

  @Get('coin-flip/config')
  @ApiOperation({ summary: 'Coin Flip config (sides, payout, limits)' })
  coinFlipConfig() {
    return instantConfig('coin-flip');
  }

  @Post('coin-flip/play')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Play one real-money Coin Flip round (reserve → engine → settle)' })
  playCoinFlip(@CurrentUser('id') userId: string, @Body() dto: PlayCoinFlipDto) {
    return this.bridge.playInstant({ userId, gameKey: 'coin-flip', selection: { side: dto.side }, stake: dto.stake, currencyCode: dto.currency, clientSeed: dto.clientSeed, idempotencyKey: dto.idempotencyKey });
  }

  @Get('wheel/config')
  @ApiOperation({ summary: 'Wheel config (risks, segment tables, limits)' })
  wheelConfig() {
    return instantConfig('wheel');
  }

  @Post('wheel/play')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Play one real-money Wheel round (reserve → engine → settle)' })
  playWheel(@CurrentUser('id') userId: string, @Body() dto: PlayWheelDto) {
    return this.bridge.playInstant({ userId, gameKey: 'wheel', selection: { risk: dto.risk }, stake: dto.stake, currencyCode: dto.currency, clientSeed: dto.clientSeed, idempotencyKey: dto.idempotencyKey });
  }

  /* --------------------- card games (Dragon Tiger · Andar Bahar · Teen Patti) --------------------- */

  private async cardConfig(variant: string) {
    const rs = await this.cardVariants.resolve(variant);
    return {
      variant: rs.key,
      name: rs.name,
      limits: rs.betLimits,
      sides: rs.sides,
      tieRule: rs.tieRule,
      bets: rs.bets.map((b: { key: string; label: string; payout: number }) => ({ key: b.key, label: b.label, payout: b.payout })),
    };
  }

  @Get('dragon-tiger/config')
  @ApiOperation({ summary: 'Dragon Tiger config (bets, payouts, limits)' })
  dragonTigerConfig() {
    return this.cardConfig('dragon-tiger');
  }

  @Post('dragon-tiger/play')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Play one real-money Dragon Tiger round (reserve → engine → settle)' })
  playDragonTiger(@CurrentUser('id') userId: string, @Body() dto: PlayCardDto) {
    return this.bridge.playCard({ userId, variant: 'dragon-tiger', bets: dto.bets, currencyCode: dto.currency, clientSeed: dto.clientSeed, idempotencyKey: dto.idempotencyKey });
  }

  @Get('andar-bahar/config')
  @ApiOperation({ summary: 'Andar Bahar config (bets, payouts, limits)' })
  andarBaharConfig() {
    return this.cardConfig('andar-bahar');
  }

  @Post('andar-bahar/play')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Play one real-money Andar Bahar round (reserve → engine → settle)' })
  playAndarBahar(@CurrentUser('id') userId: string, @Body() dto: PlayCardDto) {
    return this.bridge.playCard({ userId, variant: 'andar-bahar', bets: dto.bets, currencyCode: dto.currency, clientSeed: dto.clientSeed, idempotencyKey: dto.idempotencyKey });
  }

  @Get('teen-patti/config')
  @ApiOperation({ summary: 'Teen Patti config (bets, payouts, limits)' })
  teenPattiConfig() {
    return this.cardConfig('teen-patti');
  }

  @Post('teen-patti/play')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Play one real-money Teen Patti round (reserve → engine → settle)' })
  playTeenPatti(@CurrentUser('id') userId: string, @Body() dto: PlayCardDto) {
    return this.bridge.playCard({ userId, variant: 'teen-patti', bets: dto.bets, currencyCode: dto.currency, clientSeed: dto.clientSeed, idempotencyKey: dto.idempotencyKey });
  }

  /* ---------------------------------- mines --------------------------------- */

  @Get('mines/config')
  @ApiOperation({ summary: 'Mines config (grid size, mine range, sample multiplier progression, limits)' })
  minesConfig() {
    // Sample cash-out multiplier progression per mine count (safe reveals 1..n) for the client to display.
    const progressions: Record<number, number[]> = {};
    for (const m of [1, 3, 5, 10]) {
      progressions[m] = Array.from({ length: MINES_TILES - m }, (_, k) => gridMultiplier(MINES_TILES, m, k + 1));
    }
    return { tiles: MINES_TILES, minMines: MINES_MIN, maxMines: MINES_MAX, limits: { min: 1, max: 10000 }, progressions };
  }

  @Post('mines/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start one real-money Mines round (reserve stake → hidden board)' })
  startMines(@CurrentUser('id') userId: string, @Body() dto: StartMinesDto) {
    return this.bridge.startMines({ userId, stake: dto.stake, mines: dto.mines, currencyCode: dto.currency, clientSeed: dto.clientSeed, idempotencyKey: dto.idempotencyKey });
  }

  @Get('mines/:roundId')
  @ApiOperation({ summary: "Read the caller's mines round (board hidden while active)" })
  minesState(@CurrentUser('id') userId: string, @Param('roundId') roundId: string) {
    return this.bridge.minesState(userId, roundId);
  }

  @Post('mines/:roundId/reveal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reveal one tile of the active Mines round' })
  minesReveal(@CurrentUser('id') userId: string, @Param('roundId') roundId: string, @Body() dto: MinesRevealDto) {
    return this.bridge.minesReveal({ userId, roundId, index: dto.index });
  }

  @Post('mines/:roundId/cashout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cash out the active Mines round at the current multiplier' })
  minesCashout(@CurrentUser('id') userId: string, @Param('roundId') roundId: string) {
    return this.bridge.minesCashout({ userId, roundId });
  }

  /* ---------------- settlement recovery — admin operational surface --------------- */

  @Get('recovery/health')
  @RequirePermissions(PERMISSIONS.WALLETS_READ)
  @ApiOperation({ summary: 'Settlement-recovery health (pending/recovering/failed counts, oldest age)' })
  recoveryHealth() {
    return this.recovery.health();
  }

  @Post('recovery/sweep')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.WALLETS_ADJUST)
  @ApiOperation({ summary: 'Trigger one settlement-recovery sweep (manual/operator)' })
  recoverySweep() {
    return this.recovery.sweep();
  }

  @Post('recovery/:roundId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.WALLETS_ADJUST)
  @ApiOperation({ summary: 'Manually recover a single PENDING_SETTLEMENT round (operator)' })
  recoverOne(@Param('roundId') roundId: string) {
    return this.recovery.recoverOne(roundId);
  }
}
