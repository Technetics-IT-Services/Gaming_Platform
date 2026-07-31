# Sic Bo — Probability Model (Sprint 3, STEP 3)

Module: `src/games/sic-bo/probability.ts`. Three dice → **216 equally-likely outcomes**. Every
probability and win test is derived by **enumerating those 216 outcomes** and applying the bet rules —
there is no hardcoded winning logic and no hardcoded counts (`winCount` / `probability` iterate
`ALL_OUTCOMES`).

## Exact win counts (out of 216)

| Bet | Winning outcomes | Probability |
|---|---|---|
| Small (4–10, no triple) | 105 | 48.61% |
| Big (11–17, no triple) | 105 | 48.61% |
| Odd (no triple) | 105 | 48.61% |
| Even (no triple) | 105 | 48.61% |
| Single (a number appears) | 91 | 42.13% |
| Double (≥ 2 of a number) | 16 | 7.41% |
| Triple (specific) | 1 | 0.46% |
| Any Triple | 6 | 2.78% |
| Combo2 (two numbers both appear) | 30 | 13.89% |
| Combo3 (three numbers all appear) | 6 | 2.78% |
| Total 4 or 17 | 3 | 1.39% |
| Total 5 or 16 | 6 | 2.78% |
| Total 6 or 15 | 10 | 4.63% |
| Total 7 or 14 | 15 | 6.94% |
| Total 8 or 13 | 21 | 9.72% |
| Total 9 or 12 | 25 | 11.57% |
| Total 10 or 11 | 27 | 12.50% |

## Single-bet appearance tiers

For a Single bet on number `n`, the count of appearances is distributed (out of 216):

- exactly 1: `3 × (1/6)(5/6)²` = 75/216 (34.72%)
- exactly 2: `3 × (1/6)²(5/6)` = 15/216 (6.94%)
- exactly 3: `(1/6)³` = 1/216 (0.46%)

`singleTierProbs(n)` returns these; the tier drives the Single payout (more appearances → more pay).

## Totals distribution (symmetric about 10.5)

Total counts rise from the edges (4 and 17: 3 each) to the centre (10 and 11: 27 each) — a triangular
distribution over the 216 outcomes. The full distribution is enumerated, not tabulated by hand.

## Notes

- **Triples** cause Small/Big/Odd/Even to **lose** (the house edge on the even-money bets).
- All probabilities sum consistently: e.g. `P(Small) + P(Big) + P(any triple) = 105 + 105 + 6 = 216`.
- Every derived probability is unit-tested (`winCount(Small)=105`, `AnyTriple=6`, `Total4=3`,
  `Total10=27`, …).
