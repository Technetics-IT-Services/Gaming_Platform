# Fruit Slots — Paytable (Sprint 2)

Module: `src/games/fruit-slots/paytable.ts`. Line pays are **× line bet** (total bet ÷ 20). Values are
tuned so the total RTP lands in the 96–97% band (see `FRUIT_SLOTS_RTP.md`).

## Line paytable (× line bet)

| Symbol | 3 of a kind | 4 of a kind | 5 of a kind |
|---|---|---|---|
| 🍒 Cherry | 6.09 | 12.17 | 31.39 |
| 🍋 Lemon | 6.09 | 15.19 | 37.47 |
| 🍊 Orange | 10.16 | 25.35 | 62.77 |
| 🍇 Plum | 12.17 | 31.39 | 74.95 |
| 🔔 Bell | 19.21 | 50.60 | 125.55 |
| 7️⃣ Seven | 31.20 | 94.16 | 313.87 |
| ⭐ Wild | 50.60 | 150.90 | 627.74 |

- **Wild (⭐)** substitutes for all symbols except scatter, and pays the top line values when it forms
  its own line of a kind.
- Wins are evaluated **left-to-right** from reel 1; only the highest win per line counts.

## Scatter (💰) — × total bet, anywhere

| Scatters | Pays (× total bet) | Free spins awarded |
|---|---|---|
| 3 | 2.53 | 8 |
| 4 | 10.12 | 12 |
| 5+ | 50.60 | 20 |

- Scatter pays are added to the win regardless of paylines.
- **3+ scatters** trigger the **free-spin round**; free spins apply a **×2 win multiplier**
  (`freeSpinMultiplier`). Free-spin wins are added to the same round's payout (no re-trigger).

## Reel composition (per 36-cell strip, all 5 reels)

| Symbol | Count | Frequency |
|---|---|---|
| Cherry | 8 | 22.2% |
| Lemon | 7 | 19.4% |
| Orange | 6 | 16.7% |
| Plum | 5 | 13.9% |
| Bell | 4 | 11.1% |
| Seven | 3 | 8.3% |
| Wild | 2 | 5.6% |
| Scatter | 1 | 2.8% |

The 20 paylines are the classic middle/top/bottom + V/zigzag set (`reels.ts` `LINES`).
