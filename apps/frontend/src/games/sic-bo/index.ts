/**
 * Sic Bo game (Sprint 3) — public surface. A new table game on the FROZEN runtime;
 * money moves only through the frozen settlement/ledger.
 */
export { SicBoEngine, SIC_BO_ENGINE_KEY, type SicBoConfig } from './engine';
export { ALL_OUTCOMES, resolveBet, winCount, probability, total, isTriple, countOf, singleTierProbs } from './probability';
export { betReturn, oddsFor, singleReturns, TARGET_RTP } from './paytable';
export { rollDice, dieNonce, verifyRoll, type DiceVerification } from './provably-fair';
export { betRtp, betHouseEdge, allBets, rtpRange } from './rtp';
export { BetType, type Bet, type PlacedBet, type BetResult, type Dice, type SicBoState, type SicBoRecord } from './types';
