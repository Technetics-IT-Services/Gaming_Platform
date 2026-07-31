# Plinko — Mathematics (Sprint 1, STEP 2)

Module: `src/games/plinko/math.ts`. No hardcoded winning logic — the provably-fair path decides the
bin; this defines the probability distribution and the payout table.

## Probability distribution (Galton board)

A ball takes `rows` independent left/right steps (each p = 0.5). The number of right steps `k` is the
landing bin, distributed **Binomial(rows, 0.5)**:

```
P(bin = k) = C(rows, k) / 2^rows,   k = 0 … rows
```

`binomialProbs(rows)` returns this vector. It sums to 1 and is symmetric (`P(k) = P(rows−k)`) — the
centre bins are the most likely, the edges the least.

## Multiplier tables (derived, not hardcoded)

Tables are generated from a symmetric **shape** and calibrated to a target RTP:

1. **Shape weights** `w(k) = 1 + gain · (d/(rows/2))^curve`, where `d = |k − rows/2|` (0 at centre,
   rising to the edges). `gain`/`curve` set the variance per risk:
   - **low**: gain 5, curve 2 (flat — small edges, centre near 1×)
   - **medium**: gain 35, curve 2.5
   - **high**: gain 400, curve 3.1 (spiky — huge edges, tiny centre)
2. **Calibrate the scale** so the table's expected RTP hits the 96–97% target. RTP is monotonic in the
   overall scale, so a binary search on `scale` converges; multipliers are rounded (2 dp small, 1 dp
   mid, integer ≥ 100) and clamped to a floor of `0.1×` so every bin returns something.

```
mult(k) = max(0.1, round(w(k) · scale)),   scale chosen s.t.  Σ P(k)·mult(k) ∈ [0.96, 0.97]
```

## Expected value & house edge

```
RTP  = Σ_k P(k) · mult(k)           (expectedRtp)
Edge = 1 − RTP                      (houseEdge)  ≈ 3.3–3.8%
```

Because payout = `stake × mult` for **every** drop (sub-1 bins included), the realized return
converges to the table RTP by the law of large numbers — there is no separate "win only" cutoff that
would distort it.

## Variance by risk

Higher risk widens `max(table) − min(table)`: `high > medium > low` (asserted in tests). Low risk is a
gentle, mostly-near-1× distribution; high risk is a rare-huge-edge, frequent-small-centre distribution
— same RTP, very different variance, so players pick their volatility.

## Properties (all test-asserted)

- `Σ P(k) = 1`, symmetric.
- Every (rows × risk) table has RTP ∈ [0.96, 0.97].
- Edge multiplier > centre multiplier; `min(table) > 0`.
- `range(high) > range(medium) > range(low)`.
