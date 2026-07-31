# Number Lottery — Probability Model (Sprint 4, STEP 3)

Module: `src/games/lottery/probability.ts`. Default game: **pick 6 from 1–49**, draw **6 main + 1
bonus**. Tier probabilities are the exact **hypergeometric** counts — no hardcoded numbers (`choose` +
`tierCounts` derive them); `tierFor` classifies strictly from the match counts.

## Combinatorics

Total ways to choose 6 of 49: `C(49,6) = 13,983,816`. For a fixed ticket, the number of main-draws that
match exactly `k` of the ticket's 6 numbers is:

```
matchK = C(6, k) · C(43, 6 − k)
```

## Exact tier odds (matches the standard 6/49)

| Tier | Winning draws | Probability | 1 in |
|---|---|---|---|
| Jackpot (6) | `C(6,6)·C(43,0)` = 1 | 1 / 13,983,816 | **13,983,816** |
| 5 + Bonus | 6 | 6 / 13,983,816 | **2,330,636** |
| 5 (no bonus) | 258 − 6 = 252 | 252 / 13,983,816 | **55,491** |
| 4 | `C(6,4)·C(43,2)` = 13,545 | 13,545 / 13,983,816 | **1,032** |
| 3 | `C(6,3)·C(43,3)` = 246,820 | 246,820 / 13,983,816 | **57** |
| 2 | `C(6,2)·C(43,4)` = 1,851,150 | 1,851,150 / 13,983,816 | **8** |

### The 5 / 5+Bonus split

There are `C(6,5)·C(43,1) = 258` main-draws matching exactly 5 of the ticket. The bonus is drawn from the
43 non-main numbers; the ticket's single unmatched number equals the bonus in exactly `C(6,5) = 6` of
these (one per unmatched slot). So **5+Bonus = 6** and **5-only = 252** — asserted in the tests.

## Provably-fair draw

Seven distinct numbers are drawn from 1–49 via the frozen provider (`nextFloat` per index, selecting from
a shrinking pool). The first 6 (sorted) are the main numbers; the 7th is the bonus. Quick-pick tickets
draw 6 distinct the same way (a different nonce base). Both are deterministic in `(serverSeed, clientSeed,
nonce)` and `verifyDraw`-reproducible.

## Match classification

`tierFor(matches, bonusMatch)` returns the tier strictly from counts: 6 → Jackpot; 5 & bonus →
5+Bonus; 5 → Five; 4 → Four; 3 → Three; 2 → Two; else no prize. `countMatches(ticket, main)` counts the
intersection. There is **no hardcoded winning logic** — outcomes derive entirely from the drawn numbers.
