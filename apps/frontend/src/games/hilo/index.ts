/**
 * Hi-Lo game (Sprint 2) — public surface. A new interactive game on the FROZEN
 * runtime; money moves only through the frozen settlement/ledger.
 */
export { HiLoEngine, HILO_ENGINE_KEY } from './engine';
export { cardOf, counts, probability, stepMultiplier, oddsFor, isCorrect, fullDeck } from './math';
export { drawCard, drawNonce, verifyRound, hiloFairness, type HiLoVerification } from './provably-fair';
export { HILO_DEFAULT, type HiLoConfig, type HiLoState, type HiLoCard, type HiLoDirection, type HiLoOdds, type HiLoRecord } from './types';
