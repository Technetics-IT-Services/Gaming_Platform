import { Module } from '@nestjs/common';

import { DiceModule } from '../dice/dice.module';
import { CrashModule } from '../crash/crash.module';
import { RouletteModule } from '../roulette/roulette.module';
import { CardModule } from '../card/card.module';
import { ProvablyFairService } from '../runtime/services/provably-fair.service';
import { WalletEngineModule } from '../wallet-engine/wallet-engine.module';
import { GameMoneyController } from './game-money.controller';
import { AdminGameMoneyController } from './admin-game-money.controller';
import { GameMoneyBridgeService } from './game-money-bridge.service';
import { GameMoneyHistoryService } from './game-money-history.service';
import { GameMoneyRecoveryService } from './game-money-recovery.service';
import { GameMoneyRecoveryScheduler } from './game-money-recovery.scheduler';
import { LotteryDrawService } from './lottery-draw.service';
import { LotteryDrawScheduler } from './lottery-draw.scheduler';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { ResponsibleGamingModule } from '../responsible-gaming/responsible-gaming.module';

/**
 * Gaming-Money module (Phase 2B + 2C.2) — the reusable Game Money Bridge. Additively composes
 * the existing frozen engines (`DiceEngineService`, `CrashEngineService`, `RouletteEngineService`)
 * for game math and `WalletEngineService` for money; it owns only orchestration + the `GameRound`
 * record. `ProvablyFairService` is the same stateless seeding used by every engine. PrismaService
 * comes from the global DatabaseModule. No frozen module is modified.
 */
@Module({
  imports: [WalletEngineModule, DiceModule, CrashModule, RouletteModule, CardModule, ResponsibleGamingModule],
  controllers: [GameMoneyController, AdminGameMoneyController, CatalogController],
  providers: [GameMoneyBridgeService, GameMoneyHistoryService, GameMoneyRecoveryService, GameMoneyRecoveryScheduler, LotteryDrawService, LotteryDrawScheduler, ProvablyFairService, CatalogService],
  exports: [GameMoneyBridgeService, GameMoneyRecoveryService, LotteryDrawService],
})
export class GamingMoneyModule {}
