# Plinko — RTP Report (Sprint 1, STEP 2)

Target RTP band: **96–97%**. Every board (5 row counts × 3 risk profiles = 15 configs) is calibrated
into the band. Values below are the computed multiplier tables and their exact expected RTP
(`Σ P(bin) × mult(bin)` over the Binomial(rows, 0.5) distribution). All 15 are asserted in
`plinko.test.ts` to satisfy `0.96 ≤ RTP ≤ 0.97`.

## Computed RTP per configuration

| Rows | Risk | RTP | House edge |
|---|---|---|---|
| 8 | low | 96.54% | 3.46% |
| 8 | medium | 96.68% | 3.32% |
| 8 | high | 96.47% | 3.53% |
| 10 | low | 96.72% | 3.28% |
| 10 | medium | 96.45% | 3.55% |
| 10 | high | 96.48% | 3.52% |
| 12 | low | 96.21% | 3.79% |
| 12 | medium | 96.62% | 3.38% |
| 12 | high | 96.49% | 3.51% |
| 14 | low | 96.43% | 3.57% |
| 14 | medium | 96.46% | 3.54% |
| 14 | high | 96.49% | 3.51% |
| 16 | low | 96.57% | 3.43% |
| 16 | medium | 96.69% | 3.31% |
| 16 | high | 96.52% | 3.48% |

**All configs: 96.21% – 96.72% (within the 96–97% target).**

## Representative multiplier tables

**16 rows** (centre → edges shown left half; symmetric):

- **Low**: `4.41, 3.55, 2.8, 2.17, 1.65, 1.25, 0.97, 0.79, 0.74` (centre) … mirror … `4.41`
- **Medium**: `14.9, 10.8, 7.46, 4.88, 2.97, 1.66, 0.87, 0.49, 0.41` (centre) …
- **High**: `38.5, 25.5, 15.9, 9.05, 4.58, 1.93, 0.62, 0.16, 0.1` (centre) …

**8 rows**:

- **Low**: `3.56, 2.27, 1.34, 0.78, 0.59, 0.78, 1.34, 2.27, 3.56`
- **Medium**: `8.34, 4.18, 1.66, 0.49, 0.23, 0.49, 1.66, 4.18, 8.34`
- **High**: `14.1, 5.78, 1.67, 0.23, 0.1, 0.23, 1.67, 5.78, 14.1`

(The full table for any board is `plinkoTable(rows, risk)`.)

## Interpretation

- **Low risk** — narrow range (~0.7×–4.4×): frequent near-even outcomes, low variance.
- **Medium risk** — moderate range (~0.4×–15×): balanced volatility.
- **High risk** — wide range (~0.1×–38.5× at 16 rows): rare large edge hits, frequent small centres.

RTP is identical across risk levels (~96.5%); only variance changes. Payout is `stake × mult` on every
drop, so realized RTP converges to these figures over volume.
