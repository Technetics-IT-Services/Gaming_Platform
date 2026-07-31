/**
 * Number Lottery (Sprint 4) — public surface. A scheduled-draw game on the FROZEN
 * runtime; money moves only through the frozen settlement/ledger.
 */
export { NumberLotteryEngine, LOTTERY_ENGINE_KEY, LOTTERY_DEFAULT } from './engine';
export { ScheduledDrawEngine, DrawStatus, type Draw, type TicketRef, type DrawConfig } from './draw-engine';
export { choose, tierCounts, tierProbabilities, tierFor, countMatches } from './probability';
export { DEFAULT_PRIZE_TABLE, rtp, rtpBreakdown } from './prizes';
export { pickDistinct, deriveDraw, quickPick, verifyDraw, type DrawVerification } from './provably-fair';
export { PrizeTier, type LotteryConfig, type LotteryState, type TicketPick, type DrawResult, type PrizeTable, type LotteryRecord } from './types';
