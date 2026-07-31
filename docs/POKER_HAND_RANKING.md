# Texas Hold'em — Hand Ranking (Sprint 5, STEP 4)

Module: `src/games/poker/hand-eval.ts`. The evaluator finds the **best 5-card hand from any 5–7 cards**
by enumerating the `C(7,5) = 21` five-card subsets and taking the strongest. Pure — no RNG, no IO.

## Categories (low → high)

| # | Category | Example | Tiebreak `ranks` |
|--:|---|---|---|
| 1 | High Card | A♠ K♥ Q♦ J♣ 9♠ | all 5 ranks, high→low |
| 2 | Pair | A♠ A♥ K♦ Q♣ J♠ | pair rank, then 3 kickers |
| 3 | Two Pair | A♠ A♥ K♦ K♣ Q♠ | high pair, low pair, kicker |
| 4 | Three of a Kind | A♠ A♥ A♦ K♣ Q♠ | trips rank, then 2 kickers |
| 5 | Straight | A♠ K♥ Q♦ J♣ T♠ | high card of the run |
| 6 | Flush | A♠ J♠ 9♠ 5♠ 2♠ | all 5 ranks, high→low |
| 7 | Full House | A♠ A♥ A♦ K♣ K♠ | trips rank, pair rank |
| 8 | Four of a Kind | A♠ A♥ A♦ A♣ K♠ | quad rank, kicker |
| 9 | Straight Flush | 9♥ 8♥ 7♥ 6♥ 5♥ | high card of the run |
| 10 | Royal Flush | A♠ K♠ Q♠ J♠ T♠ | (straight flush, ace-high) |

`HandCategory` is an enum with these exact ordinals; a Royal Flush is reported as its own category (10)
for presentation but is mechanically an ace-high straight flush.

## Ranks & the wheel

Card ranks are `2…10, J=11, Q=12, K=13, A=14`. The **wheel** (A-2-3-4-5) is a valid straight in which the
ace plays **low** — its high card is **5**, so it loses to a 6-high straight. `straightHigh` handles this
by appending a phantom `1` for the ace when scanning for five consecutive distinct ranks.

## Comparison & ties

`compareHands(a, b)` returns `> 0`, `< 0`, or **exactly `0`**:

1. Compare `category` first.
2. Within a category, compare the `ranks` array lexicographically (high → low).
3. Equal category **and** equal ranks ⇒ `0` — a genuine tie, which drives **split pots**.

`evaluate7` picks the best subset using `compareHands`; `evaluate5` scores an exact five. Both return
`{ category, name, ranks, cards }` where `cards` are the five forming the hand.

## Tested guarantees (`poker.test.ts`)

- Every category is recognised (Royal Flush … High Card).
- Best-5-of-7 correctly completes a flush from board + hole cards.
- Kicker tiebreaks (A-A-K-Q-**J** beats A-A-K-Q-**T**) and exact splits (identical hands → `0`).
- The wheel is the lowest straight (6-high beats 5-high).
