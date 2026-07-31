# Sic Bo — Paytable (Sprint 3, STEP 3)

Module: `src/games/sic-bo/paytable.ts`. Payouts are **derived from the exact win probabilities** to a
uniform target RTP (no hardcoded odds): for a flat bet, `return = targetRTP / P` and `odds = return − 1`
(where `targetRTP = 0.972`). The tiered Single bet scales the classic 1:1 / 2:1 / 3:1 ladder to the same
target. This yields a **uniform ~2.8% house edge** across the whole table (a fair-odds Sic Bo — rarer
bets pay more than traditional Macau tables so every bet meets the platform's 96–98% RTP policy).

## Odds table (`X : 1`)

| Bet | Odds (to 1) | RTP |
|---|---|---|
| Small / Big | 1 : 1 | 97.22% |
| Odd / Even | 1 : 1 | 97.22% |
| Single — 1 appearance | 1.11 : 1 | — |
| Single — 2 appearances | 2.17 : 1 | — |
| Single — 3 appearances | 3.22 : 1 | (blended) 97.23% |
| Double (specific) | 12.12 : 1 | 97.19% |
| Triple (specific) | 208.95 : 1 | 97.20% |
| Any Triple | 33.99 : 1 | 97.19% |
| Combo2 (two numbers) | 6 : 1 | 97.22% |
| Combo3 (three numbers) | 33.99 : 1 | 97.19% |
| Total 4 or 17 | 68.98 : 1 | 97.19% |
| Total 5 or 16 | 33.99 : 1 | 97.19% |
| Total 6 or 15 | 20.0 : 1 | 97.22% |
| Total 7 or 14 | 13.0 : 1 | 97.22% |
| Total 8 or 13 | 9.0 : 1 | ~97.2% |
| Total 9 or 12 | 7.4 : 1 | 97.22% |
| Total 10 or 11 | 6.78 : 1 | 97.25% |

> Odds are computed at runtime by `oddsFor(bet)` from the exact probability — the table above is the
> rendered result, not a hardcoded source of truth. A winning bet's **total return** (stake + winnings)
> is `betReturn(bet, dice) × amount`, derived strictly from the dice outcome.

## Payout mechanics

- Every placed bet is independent. On a roll: `payout = Σ over winning bets round(amount × return)`.
- Losing bets return nothing (their chips are part of the total stake, already debited).
- Net = total payout − total stake. The frozen flexible settlement classifies the round outcome by net.

## Single bet (tiered)

A Single bet on `n` pays by how many dice show `n`: `1.11 : 1` (one), `2.17 : 1` (two), `3.22 : 1`
(three). The three tier multipliers are the classic 2×/3×/4× returns scaled by `0.972 / 0.9213` so the
blended RTP is 97.23%.
