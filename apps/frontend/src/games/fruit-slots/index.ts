/**
 * Fruit Slots (Sprint 2) — public surface. A new single-shot slot on the FROZEN
 * runtime; money moves only through the frozen settlement/ledger.
 */
export { FruitSlotsEngine, FRUIT_SLOTS_ENGINE_KEY, defaultSlotConfig, playRound, evaluateSpin, spinMatrix } from './engine';
export { PAYTABLE, SCATTER } from './paytable';
export { buildReels, windowFor, LINES, STRIP_LENGTH } from './reels';
export { reelStops, reelNonce } from './provably-fair';
export { estimateRtp, type RtpEstimate } from './rtp';
export { Symbol, REELS, ROWS, PAYLINES, type SlotConfig, type SpinResult, type LineWin, type Paytable, type ScatterConfig, type SlotRecord } from './types';
