# Plinko — Provably Fair (Sprint 1, STEP 3)

Module: `src/games/plinko/provably-fair.ts`. Plinko reuses the **frozen** provably-fair platform
(`IProvablyFairProvider`) — no randomness lives outside it, and every drop is independently verifiable.

## How the path is derived

For a board of `rows`, each row's left/right step comes from one provably-fair float keyed by the
committed seeds and a per-row sub-nonce:

```
rowNonce(nonce, i) = nonce · 100 + i          (rows ≤ 16, so sub-nonces never collide across rounds)
float_i            = rng.nextFloat({ serverSeed, clientSeed, nonce: rowNonce(nonce, i) })
step_i             = float_i ≥ 0.5 ? +1 (right) : −1 (left)
landing bin        = count of right steps      (0 … rows)
multiplier         = plinkoTable(rows, risk)[bin]
```

`derivePath(rng, fairness, rows)` returns `{ dirs, bin, floats }` — fully deterministic in
`(serverSeed, clientSeed, nonce, rows)`.

## What every drop exposes

- **Server seed** (revealed on rotation) and **hashed server seed** (committed up front).
- **Client seed** (player-controlled).
- **Nonce** (round counter).
- **Generated path** (`dirs` — L/R per row).
- **Landing position** (`bin`) and **multiplier**.
- **Verification result**.

The UI's Provably-Fair panel shows all of these for the latest drop; history stores them per drop.

## Verification

A player (or auditor) reproduces any drop:

```ts
const v = verifyDrop(rng, { serverSeed, clientSeed, nonce, rows, expectedBin, expectedDirs });
// v.valid === true  ⇔  the recomputed path + landing bin match the recorded outcome
```

`verifyDrop` recomputes the path from the revealed seeds and compares the landing bin (and the exact
`dirs` if provided). Tampering with any input flips `valid` to `false` (test-asserted: a bumped
`expectedBin` fails verification).

## Fairness guarantees

- **Determinism** — same seeds + nonce ⇒ same path, always (verified in tests).
- **Commit-reveal** — the server-seed hash is published before the bet; the server seed is revealed on
  rotation so past drops become verifiable without letting players predict future ones.
- **Independence per round** — the `nonce·100 + i` sub-nonce scheme gives each row an independent,
  non-overlapping provably-fair draw across rounds.
- **No side-channel randomness** — the engine calls only `rng.nextFloat`; there is no `Math.random`,
  no time-based seed, and no hidden state.

## Replay

`replayDrop(rng, record)` reconstructs the path, rebuilds the animation timeline, and re-verifies the
drop — so a player can watch any historical drop fall exactly as it did, with the verification result
shown.
