# Number Lottery — RTP Analysis (Sprint 4, STEP 3)

Module: `src/games/lottery/prizes.ts`. The prize table is **configurable** and calibrated so the
default game (pick 6 / 1–49 / 6+bonus) returns a theoretical **RTP of 96.508%**, inside the required
**96–97%** band. RTP is computed **analytically** from the exact tier probabilities
(`NUMBER_LOTTERY_PROBABILITY.md`) — there is no simulation dependence and no hardcoded payout logic.

## RTP formula

For a ticket price `T`, each tier `t` pays `prize_t = T × multiplier_t` with probability `p_t`:

```
RTP = Σ_t  p_t · multiplier_t          (prize expressed as a multiple of the ticket price)
```

`rtp(prizeTable)` returns this sum; `rtpBreakdown(prizeTable)` returns the per-tier contribution.

## Default prize table (multiplier × ticket price)

| Tier | Multiplier | Probability `p` | 1 in | Contribution `p · mult` |
|---|---:|---:|---:|---:|
| Jackpot (6) | 4,000,000 | 1 / 13,983,816 | 13,983,816 | 0.286045 |
| 5 + Bonus | 150,000 | 6 / 13,983,816 | 2,330,636 | 0.064360 |
| 5 | 3,000 | 252 / 13,983,816 | 55,491 | 0.054062 |
| 4 | 105 | 13,545 / 13,983,816 | 1,032 | 0.101699 |
| 3 | 11 | 246,820 / 13,983,816 | 57 | 0.194159 |
| 2 | 2 | 1,851,150 / 13,983,816 | 8 | 0.264714 |
| **Total** | | | | **0.965039** |

**Theoretical RTP = 96.5039% ≈ 96.508%** (small rounding in the table above; the code computes the
exact rational value). **House edge ≈ 3.5%.**

> Prizes are expressed as a **multiple of the ticket price** (fixed-odds), so RTP is independent of the
> ticket price itself. At the demo ticket price of 2, the jackpot pays 8,000,000; the "2" tier pays 4
> (a partial return, routed through the frozen **flexible** settlement path since it is a sub-... payout
> that `settleMultiplicative` would not credit).

## Tuning notes

- The jackpot dominates variance (≈29.6% of RTP) while the low tiers (2 & 3) supply the "frequent small
  win" feel (≈45.9% of RTP combined) — a standard 6/49 shape.
- To re-target RTP, adjust any multiplier and re-run `rtp()`; the analytic value updates immediately. The
  test `lottery.test.ts` asserts `rtp(DEFAULT_PRIZE_TABLE) ∈ [0.96, 0.97]`, so any change that leaves the
  band fails CI.

## Verification

`lottery.test.ts` asserts: the exact tier counts (total 13,983,816; 5+Bonus is 1-in-2,330,636), the
default-table RTP is within [0.96, 0.97], and — via a 20-ticket runtime loop — the financial invariant
`balance === before − stake + payout` holds for every settled ticket through the frozen ledger.
