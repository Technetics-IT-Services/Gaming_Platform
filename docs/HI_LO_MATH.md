# Hi-Lo — Mathematics & RTP (Sprint 2)

Module: `src/games/hilo/math.ts`. No hardcoded winning logic — probabilities come from the live deck
composition, the card from the provably-fair stream.

## Deck & probabilities

Standard 52-card deck, ranks 2..14 (J=11, Q=12, K=13, A=14), 4 suits. Cards are drawn **without
replacement**, so probabilities update every step. For a current rank `c` and remaining deck `R`:

```
P(higher) = |{ card ∈ R : rank > c }| / |R|
P(lower)  = |{ card ∈ R : rank < c }| / |R|
P(equal)  = |{ card ∈ R : rank = c }| / |R|
```

## Multiplier & house edge

The multiplier offered for a prediction is the **fair inverse-probability payout** discounted by the
house edge:

```
stepMultiplier(dir) = (1 − edge) / P(dir),   edge = 0.035  (config: houseEdge)
```

An impossible prediction (P = 0, e.g. "higher" on the last Ace) offers no multiplier and is disabled.

## RTP = 1 − edge (96.5%), path-independent

Each step's expected value is:

```
E[step] = P(dir) × stepMultiplier(dir) = P(dir) × (1 − edge)/P(dir) = 1 − edge = 0.965
```

Because every step returns `1 − edge` in expectation and the running multiplier is the product of the
steps taken, **cashing out at any point has an RTP of 1 − edge = 96.5%**, regardless of how many
predictions were made or which directions were chosen. This is asserted directly in the tests
(`P × stepMultiplier ≈ 0.965` for every rank/direction). The result therefore sits in the **96–97%**
target band by construction, independent of player strategy.

> Note: cashing out is only permitted after **at least one** prediction (multiplier > 1). A trivial
> "deal then immediately cash out" is disallowed, so there is no zero-risk 100%-RTP action.

## Progressive multiplier

```
multiplier₀ = 1
multiplierₙ = multiplierₙ₋₁ × stepMultiplier(dirₙ)   on a correct prediction
```

Payout on cash-out = `round(stake × multiplierₙ)`; a wrong prediction ends the round with payout 0
(stake lost). Both settle through the frozen flexible settlement.

## Worked example

Current card rank 2, full remaining deck of 51 after the first card:
`P(higher) = 48/51`, `stepMultiplier(higher) = 0.965 × 51/48 ≈ 1.025×`. Predict "higher" correctly →
multiplier ≈ 1.03×; cash out → `round(stake × 1.03)`. E[value] = (48/51) × 1.025 = 0.965.
