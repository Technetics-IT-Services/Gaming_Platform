# Sic Bo — RTP Report (Sprint 3, STEP 3)

Target RTP band: **96–98%**. Because Sic Bo has only 216 equally-likely outcomes, RTP is computed
**exactly** (no Monte-Carlo): `RTP(bet) = Σ_over 216 outcomes betReturn(bet, dice) / 216`
(`src/games/sic-bo/rtp.ts`). Every one of the **72 distinct bets** in the table is verified in the band.

## Result — all 72 bets: 97.19% – 97.25%

| Bet group | RTP | House edge |
|---|---|---|
| Small / Big / Odd / Even | 97.22% | 2.78% |
| Single (blended, tiered) | 97.23% | 2.77% |
| Double (specific) | 97.19% | 2.81% |
| Triple (specific) | 97.20% | 2.80% |
| Any Triple | 97.19% | 2.81% |
| Combo2 (two numbers) | 97.22% | 2.78% |
| Combo3 (three numbers) | 97.19% | 2.81% |
| Total 4–17 (each) | 97.19% – 97.25% | 2.75% – 2.81% |

**Table-wide: min 97.19%, max 97.25%, across 72 bets — squarely within the 96–98% target.**
Asserted directly in `sic-bo.test.ts`: every `betRtp(bet) ∈ [0.96, 0.98]`, and `rtpRange()` min/max in
band.

## Why uniform

Payouts are derived as `return = 0.972 / P` (2-decimal rounded), so every bet's expected return is
`P × (0.972/P) = 0.972`, up to a small rounding residue that keeps it inside the band. The tiered Single
bet scales its ladder to the same target. This is a **fair-odds Sic Bo** with a uniform ~2.8% edge — by
design, rarer bets pay more than a traditional Macau table (e.g. specific triple 208.95:1 vs the classic
150:1/180:1) so no bet falls below 96% RTP.

## No hardcoded winning logic

`betReturn(bet, dice)` resolves the win **strictly from the dice** (`resolveBet` enumerates the rules)
and derives the payout from the probability-based paytable. There are no hardcoded outcomes, counts or
payouts — changing the target RTP re-derives the whole table.

## Realized RTP

Over volume, realized RTP converges to ~97.2% per bet (and for any mix of bets, the blended RTP is the
stake-weighted average). The frozen ledger credits the exact per-round payout; the financial invariant
(`balance = before − stake + payout`) is asserted across many real rolls in the runtime-integration
tests.
