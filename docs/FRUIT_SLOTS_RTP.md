# Fruit Slots — RTP Report (Sprint 2)

Target RTP band: **96–97%**. The shipped configuration is verified two independent ways: an **exact
analytic** computation (deterministic, no Monte-Carlo variance) and a **Monte-Carlo** simulation over
the frozen provably-fair provider. Module: `src/games/fruit-slots/rtp.ts`.

## Exact RTP (deterministic) — 96.579%

Because each payline draws one symbol per reel with probability `weight/36` (independent), the exact
per-line expectation is computed by enumerating the full 8⁵ symbol space; the scatter-count
distribution is derived by scanning each reel's 3-window and convolving across the 5 reels; free spins
add `E[awarded] × freeSpinMultiplier × baseUnits`.

| Component | Value |
|---|---|
| Line RTP (20 lines) | 87.68% |
| Scatter RTP | 1.47% |
| **Base-game RTP** | **89.15%** |
| Expected free spins per round `E[awarded]` | 0.0416 |
| Free-spin uplift factor `1 + E[awarded]×2` | ×1.0832 |
| **Total RTP** | **96.579%** — within 96–97% ✅ |
| House edge | **3.421%** |

`exactRtp(config).rtp` is asserted in `fruit-slots.test.ts` to satisfy `0.96 ≤ RTP ≤ 0.97`.

## Monte-Carlo (cross-check)

`estimateRtp(pf, config, { spins })` plays N deterministic rounds and averages the total win in
stake-units. The free-spin feature (max single-round win in the thousands of × line-bet) gives high
variance, so a stable estimate needs a large N:

| Spins | RTP estimate |
|---|---|
| 50,000 | ~0.9–1.0 (noisy, feature-driven) |
| 2,000,000 | ~96.4% (converging to the analytic value) |

The regular test suite asserts the **exact** RTP (fast + deterministic) and only sanity-bounds the
50k-spin Monte-Carlo (hit rate 10–30%, RTP within [0.85, 1.15]) to avoid feature-variance flakiness.

## Other metrics

- **Hit rate** (any win): ~16% of spins.
- **Free-spin trigger rate**: ~0.5% of spins (3+ scatters).
- **Max observed single-round win**: thousands of × line-bet (free-spin round with ×2 multiplier).

## Payout mechanics

Every spin: `payout = round(totalUnits × lineBet)`, `lineBet = stake / 20`. So `E[payout]/stake =
E[totalUnits]/20 = RTP`. Realized RTP converges to 96.579% over volume; the frozen ledger credits the
exact per-spin payout (financial invariant asserted in the runtime-integration tests).
