/**
 * Fruit Slots — paytable + scatter config (Sprint 2).
 *
 * Multipliers are × line-bet for 3/4/5 of a kind. The absolute values are calibrated
 * (see `rtp.ts` + FRUIT_SLOTS_RTP.md) so the total RTP — base game + scatter + the
 * resolved free-spin round — lands in the 96–97% band. Wild pays the top line; scatter
 * pays × total-bet and awards free spins.
 */
import { type Paytable, type ScatterConfig, Symbol } from './types';

/** Line paytable (× line bet). Higher symbols pay more; wild tops the line pays. */
export const PAYTABLE: Paytable = {
  [Symbol.Cherry]: { 3: 6.09, 4: 12.17, 5: 31.39 },
  [Symbol.Lemon]: { 3: 6.09, 4: 15.19, 5: 37.47 },
  [Symbol.Orange]: { 3: 10.16, 4: 25.35, 5: 62.77 },
  [Symbol.Plum]: { 3: 12.17, 4: 31.39, 5: 74.95 },
  [Symbol.Bell]: { 3: 19.21, 4: 50.6, 5: 125.55 },
  [Symbol.Seven]: { 3: 31.39, 4: 94.16, 5: 313.87 },
  [Symbol.Wild]: { 3: 50.6, 4: 150.9, 5: 627.74 },
};

export const SCATTER: ScatterConfig = {
  // × total bet, anywhere on the 5×3 window
  pays: { 3: 2.53, 4: 10.12, 5: 50.6 },
  freeSpins: { 3: 8, 4: 12, 5: 20 },
  freeSpinMultiplier: 2,
};
