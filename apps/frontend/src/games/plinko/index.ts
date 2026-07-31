/**
 * Plinko game (Game Expansion v2.0, Sprint 1) — public surface.
 *
 * A production Plinko built entirely on the FROZEN GameRuntime + settlement + ledger.
 * It registers as a `RuntimeGameEngine` (`engineKey: 'plinko-pro'`) and moves money
 * only through the frozen settlement path — no platform, runtime, wallet or ledger
 * code is modified.
 */
export { PlinkoEngine, PLINKO_ENGINE_KEY, PLINKO_DEFAULT } from './engine';
export { plinkoTable, buildTable, binomialProbs, expectedRtp, houseEdge } from './math';
export { derivePath, verifyDrop, fairnessSummary, rowNonce, type DerivedPath, type FairnessSummary, type VerificationResult } from './provably-fair';
export { buildTimeline, binToX, PlinkoAnimation, type Frame, type AnimationPhase } from './animation';
export { layoutFor, layoutMode, pegPositions, type BoardLayout, type LayoutMode } from './layout';
export { replayDrop, AutoPlayController, type AutoPlayConfig, type AutoPlayDecision } from './replay';
export { PLINKO_RISKS, PLINKO_ROWS, type PlinkoRisk, type PlinkoConfig, type PlinkoPick, type PlinkoState, type PlinkoDropRecord } from './types';
