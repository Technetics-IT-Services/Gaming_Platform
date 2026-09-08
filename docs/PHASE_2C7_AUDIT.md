# Phase 2C.7 — Pre-Implementation Audit (Real-Money Game Expansion v2)

**Step 1 deliverable — audit only. No production code written.** This audit inventories every
candidate game against 20 production criteria, corrects the production baseline, and recommends the
highest-value, lowest-risk onboarding set for the 2C.7 window.

---

## 0. Correction to the stated baseline (important, honest)

The task brief lists the current real-money games as **Dice, Crash, Plinko, Mines (4)**. The repository
disagrees: the wired real-money endpoints in
`apps/backend/src/modules/gaming-money/game-money.controller.ts` cover **nine** games already in
production:

| # | Game | Real-money route(s) | Since |
|---|------|---------------------|-------|
| 1 | Dice | `GET dice/config`, `POST dice/play` | 2B |
| 2 | Crash | `crash/config,state,play,cashout` | 2C.2 |
| 3 | Roulette | `roulette/config,play` | 2C.2 |
| 4 | Sic Bo | `sic-bo/config,play` | 2C.3 |
| 5 | Number Lottery | `lottery/config,draw,tickets,buy` | 2C.3 |
| 6 | Baccarat | `baccarat/config,play` | 2C.4 |
| 7 | Blackjack | `blackjack/config,start,:id,:id/action` | 2C.4 |
| 8 | Plinko | `plinko/config,play` | 2C.6 |
| 9 | Mines | `mines/config,start,:id,:id/reveal,:id/cashout` | 2C.6 |

This materially changes 2C.7's scope: the remaining catalog is **instant games** and **extra card
games**, not the flagship crypto games (which are done). This audit plans against the *actual* state.

---

## 1. Reusable, frozen money core (confirmed present)

- **`GameMoneyBridgeService`** — one money path for all games (reserve → engine → commit). Already
  hosts dice/crash/roulette/sicbo/lottery/baccarat/blackjack/plinko/mines. Additive methods only.
- **`WalletEngineService`** — reservations, ledger, treasury, settlement, invariant enforcement (frozen).
- **`GameMoneyRecoveryService`** + scheduler — `PENDING_SETTLEMENT` drain (2C.1, frozen).
- **`ProvablyFairService`** — commit/derive/reveal (frozen).
- **`GameMoneyHistoryService`** — `GET history`, `GET history/:roundId`; redaction allowlist
  (`serverSeed/seed/crashPoint`). Reuse as-is.
- **Authoritative engine packages** under `games/`: `card-engine`, `crash-engine`, `dice-engine`,
  `lottery-engine`, `roulette-engine`, `sports-engine`. (Plinko/Mines were ported into
  `gaming-money/engines/` in 2C.6 — the precedent for porting frontend-only engines.)

### Two proven money patterns to reuse
- **Single-shot** (dice/roulette/sicbo/baccarat/plinko): `reserve(stake)` → engine → `commit(payout)`.
- **Interactive** (blackjack/mines): `start`(reserve+hidden state) → guarded `actionSeq` actions →
  `cashout`/loss → settle; deterministic seed replay (restart-safe).

---

## 2. Candidate matrix

Legend: ✅ yes · ❌ no · ➖ n/a · **PORT** = frontend engine exists, needs additive server port ·
**PRESET** = authoritative `card-engine` preset already exists.

| Game | FE | Backend engine | Runtime | Prov-Fair | RTP doc | Real-money | Bridge | Recovery | Mobile (money) | Tests | Status | Recommended action |
|------|----|----|----|----|----|----|----|----|----|----|----|----|
| **Dice** | ✅ | ✅ dice-engine | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **PRODUCTION** | none |
| **Crash** | ✅ | ✅ crash-engine | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **PRODUCTION** | none |
| **Roulette** | ✅ | ✅ roulette-engine | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **PRODUCTION** | none |
| **Sic Bo** | ✅ | ✅ dice-engine(var) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **PRODUCTION** | none |
| **Number Lottery** | ✅ | ✅ lottery-engine | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **PRODUCTION** | none |
| **Baccarat** | ✅ | ✅ card-engine | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **PRODUCTION** | none |
| **Blackjack** | ✅ | ✅ card-engine | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **PRODUCTION** | none |
| **Plinko** | ✅ | ✅ ported | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **PRODUCTION** | none |
| **Mines** | ✅ | ✅ ported | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **PRODUCTION** | none |
| **Limbo** | ✅ | **PORT** (instant) | ✅ | ✅ rng.ts | ✅ 1% edge | ❌ | ❌ | ➖ | ❌ | ✅ instant | **CANDIDATE P0** | Port engine → single-shot money |
| **Coin Flip** | ✅ | **PORT** | ✅ | ✅ | ✅ | ❌ | ❌ | ➖ | ❌ | ✅ | **CANDIDATE P0** | Port → single-shot money |
| **Wheel** | ✅ | **PORT** | ✅ | ✅ | ✅ | ❌ | ❌ | ➖ | ❌ | ✅ | **CANDIDATE P0** | Port → single-shot money |
| **Dragon Tiger** | ✅ | ✅ **PRESET** | ✅ | ✅ | ✅ payouts | ❌ | ❌ | ➖ | ❌ | ✅ phase3 | **CANDIDATE P0** | Generic card-play bridge method |
| **Andar Bahar** | ✅ | ✅ **PRESET** | ✅ | ✅ | ✅ | ❌ | ❌ | ➖ | ❌ | ✅ | **CANDIDATE P0** | Generic card-play bridge method |
| **Teen Patti** | ✅ | ✅ **PRESET** (+3 variants) | ✅ | ✅ | ✅ | ❌ | ❌ | ➖ | ❌ | ✅ | **CANDIDATE P0** | Generic card-play bridge method |
| **Keno** | ✅ | **PORT** | ✅ | ✅ | ✅ paytable | ❌ | ❌ | ➖ | ❌ | ✅ | **CANDIDATE P1** | Port → single-shot money |
| **Hi-Lo** | ✅ (+route) | **PORT** interactive | ✅ RuntimeGameEngine | ✅ | ✅ | ❌ | ❌ | ➖ | ❌ | ✅ hilo | **CANDIDATE P1** | Interactive (Mines pattern) |
| **Tower** | ✅ | **PORT** interactive | ✅ | ✅ | ✅ 1% edge | ❌ | ❌ | ➖ | ❌ | ✅ | **CANDIDATE P1** | Interactive (Mines pattern) |
| **Lucky-7** | ✅ | ✅ **PRESET** | ✅ | ✅ | ✅ | ❌ | ❌ | ➖ | ❌ | ✅ | **CANDIDATE P1** | Generic card-play (after P0 card method) |
| **Casino War** | ✅ | ✅ **PRESET** | ✅ | ✅ | ✅ | ❌ | ❌ | ➖ | ❌ | ✅ | **CANDIDATE P1** | Generic card-play |
| **Fruit Slots / Slots** | ✅ full engine | **PORT** | ✅ | ✅ | ✅ rtp.ts | ❌ | ❌ | ➖ | ❌ | ✅ fruit-slots | **CANDIDATE P1** | Port → single-shot spin (richer UI) |
| **Bingo** | ✅ | **PORT** | ✅ | ✅ | ⚠ partial | ❌ | ❌ | ➖ | ❌ | ✅ | **CANDIDATE P2** | Port; heavier UI |
| **Poker / Texas Hold'em** | ✅ full multiplayer (table-engine, tournament) | ⚠ card-engine ante-preset only | ⚠ | ✅ | ⚠ | ❌ | ❌ | ➖ | ❌ | ✅ poker | **DEFER P2** | Multiplayer session infra — out of scope for deadline |

Also present (minor instant engines): `grid-reveal`, `lucky-pick` — scratch/reveal variants, P2.

**Demo-wallet note:** demo-wallet lives only in `components/games/prototype/*` and dashboard pages —
**never** in the `*-money` paths. New money games must get **fresh `*-money` UIs** (not the prototype
components), exactly as prior phases did. A no-demo-wallet regression test is required per game.

---

## 3. Why the recommended set

Onboarding cost is dominated by **how much authoritative backend the game needs**. Two clusters are
essentially free of engine risk:

- **Instant single-shot games** (Limbo, Coin Flip, Wheel, Keno) — pure frontend engines with a clean
  provably-fair contract (`rng.nextFloat({serverSeed, clientSeed, nonce})`), already unit-tested. Port
  to `gaming-money/engines/` with **parity tests** (the exact Plinko 2C.6 precedent) and add **one
  generic single-shot "instant-play" bridge method**.
- **Card table games** (Dragon Tiger, Andar Bahar, Teen Patti — later Lucky-7, Casino War) — the
  authoritative `card-engine` **already supports these variants as presets** (proven in
  `games/card-engine/src/engine.spec.ts`). Baccarat already rides this exact path; it is only
  hardcoded to the `'baccarat'` key. Add **one additive generic `playCard(variant, bets)` bridge
  method** and these games settle through the same reserve→resolve→commit lifecycle.

So the entire P0 set is deliverable with **two additive bridge methods + engine ports + DTOs + routes +
mobile UIs**, zero changes to frozen financial semantics.

Interactive ladder games (**Hi-Lo, Tower**) are Mines-shaped (start → reveal/predict → cashout/bust)
and reuse the proven `actionSeq` + seed-replay interactive pattern — higher UI/state cost, hence P1.

**Poker/Texas Hold'em** is genuine multiplayer (dedicated `table-engine.ts` + `tournament.ts`) and
would need shared-table session infrastructure and a settlement model the single-player money
lifecycle does not cover → **defer to P2** (a STOP condition: don't force a multiplayer game into the
single-shot path).

---

## 4. Complexity & risk estimates

| Priority | Games | New backend | New frontend | Risk | Rough effort |
|----------|-------|-------------|--------------|------|--------------|
| **P0-instant** | Limbo, Coin Flip, Wheel | 3 engine ports + 1 generic instant-play method + DTOs + 3 routes | 3 mobile boards + api clients + hooks | Low | ~0.5 day |
| **P0-card** | Dragon Tiger, Andar Bahar, Teen Patti | 1 generic card-play method + DTO + 3 routes (engine reused) | 3 mobile boards + api clients | Low | ~0.5 day |
| **P1-instant** | Keno | 1 port + reuse instant-play + route | 1 board | Low-med | ~0.25 day |
| **P1-interactive** | Hi-Lo, Tower | 2 interactive ports + 2 lifecycles (Mines pattern) | 2 interactive boards | Medium | ~0.75 day |
| **P1-card** | Lucky-7, Casino War | reuse card-play + 2 routes | 2 boards | Low | ~0.25 day |
| **P1-slots** | Fruit Slots | 1 port + route | 1 richer reel board | Medium | ~0.5 day |
| **P2** | Bingo, Poker | significant | significant | High | out of window |

---

## 5. Blockers / dependencies / STOP-conditions to watch

- **Card-play genericity:** `bridge.playBaccarat` + `baccarat/config` are hardcoded to `'baccarat'`.
  Onboarding card games needs a generic `playCard(variant, bets)` (additive) — must **verify each
  target variant resolves and its bet keys validate** before wiring; if a preset's payout/tie rules
  are ambiguous, STOP and document rather than guess.
- **Parity for ported engines:** for every ported instant/slots engine, prove server output ==
  frontend output across the input space (Plinko-style parity test). If frontend and backend disagree,
  STOP and document the discrepancy — do not silently change the frozen frontend math.
- **Interactive recovery:** Hi-Lo/Tower must persist enough `GameRound` state to reconstruct
  deterministically from the seed (like Mines) so `GameMoneyRecoveryService` can settle. If a mechanic
  can't be reconstructed from persisted seed+choices, STOP.
- **RTP documentation:** most engines encode house edge in config (Limbo 1%, Tower 0.99, card payouts
  in presets); Bingo's RTP is only partially documented — treat as P2 until derived.
- **Provably-fair reuse:** instant/card engines already consume the runtime PF float/seed; no second
  fairness system needed. Interactive games must not leak hidden state (trap/next card) before settle.
- **Environment:** live financial verification depends on the disposable `gp_phase1` Postgres
  (55432) + Redis (56379). Present now; if unavailable at verify time, report BLOCKED (never fabricate).

---

## 6. Recommendation for the 2C.7 window

**Commit to the P0 set of 6** — high popularity, low risk, all reuse the frozen core via **two additive
bridge methods**:

1. **Limbo** · 2. **Coin Flip** · 3. **Wheel** — instant single-shot (engine ports + parity).
4. **Dragon Tiger** · 5. **Andar Bahar** · 6. **Teen Patti** — card single-shot (authoritative preset reuse).

**Stretch (P1, only if P0 lands with time to spare):** **Keno** (trivial single-shot) and **Hi-Lo**
(interactive, exercises the Mines pattern on a card ladder). Lucky-7/Casino War become near-free once
the generic card-play method exists.

**Explicitly out of scope:** Poker/Texas Hold'em multiplayer (P2), Bingo (P2), Fruit Slots (P1, only if
everything above is done — the reel UI is the costly part, not the money).

This maximizes useful catalog breadth (3 global instant games + 3 top Indian card games) while keeping
every change additive and financially safe.

---

## 7. What each onboarded game will deliver (definition of done)

Per game: additive engine/bridge method + DTO (whitelist rejects server-owned fields) + authenticated
route (`@CurrentUser('id')`) + mobile-first `*-money` board (375/390/412, sticky authoritative balance,
no demo-wallet) + api client/hook (balance synced from server) + tests (validation, auth, identity,
stake, win, loss, RTP/math, provably-fair replay, idempotency, duplicate, concurrency, insufficient,
recovery where applicable, financial invariant, ledger integrity, no-negative, history linkage,
demo-wallet isolation; parity test for ported engines) + live financial verification + a
`docs/<GAME>_MONEY_GAME.md`.

**No frozen financial semantics modified. Phase 2C.8 will not be started.**

---

## 8. STOP — awaiting approval

Per instruction, this is the audit only. **No implementation has begun.** Awaiting approval of the
recommended P0 set (and any P1 stretch) before writing production code.
