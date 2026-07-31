# Platform Architecture — The Engineering Standard

> **Status:** Adopted (Phase 2.1) · **Scope:** the single architectural direction every
> future module follows — 25+ casino games, sportsbook, Admin/Finance/Partner portals,
> referral, VIP, rewards, analytics, audit, and future live casino.
>
> **This document is a standard, not an implementation.** Phase 2.1 defined the
> contracts and this document. It did **not** wire games to the real wallet, build
> games, or change any gameplay. Runtime integration begins in Phase 2.2.

---

## 1. Why this exists

The pre-Phase-2 audit found two well-built halves that don't meet:

- **Backend (strong):** NestJS + Prisma + PostgreSQL, a double-entry **wallet-engine**
  ledger (holds, idempotency, optimistic + Redis locking), **RBAC**, provably-fair RNG,
  and four config-driven engines (card/dice/roulette/crash) on a real **game-sdk** plugin
  framework (`packages/game-sdk`).
- **Frontend (polished, but a demo):** every playable game is a **bespoke** React
  component with its **own RNG** and a **client-side demo wallet** (`stores/demo-wallet.ts`,
  localStorage). It **bypasses** the engines, the runtime, and the ledger.

The result: games don't use the real engines, the wallet is a demo, and there is no unified
runtime contract. **Phase 2.1 fixes the *direction*, not the wiring:** one set of contracts
both halves implement, so every future module plugs into the same shape.

---

## 2. Canonical layering

```
        ┌─────────────────────────── UI (React) ───────────────────────────┐
        │  Game components render state + collect intent. They NEVER call    │
        │  the wallet, settlement, history, analytics, or the network path.  │
        └───────────────────────────────┬───────────────────────────────────┘
                                         │  IGameRuntime (the ONLY door)
        ┌────────────────────────────────▼──────────────────────────────────┐
        │                            RUNTIME                                  │
        │  Orchestrates the canonical game lifecycle. Owns ordering, retries, │
        │  idempotency, event emission. Depends only on provider interfaces.  │
        └───┬──────────┬──────────┬──────────┬──────────┬──────────┬─────────┘
            │ IGameEngine  IWalletProvider  ISettlement  IHistory  IProvablyFair …
            ▼          ▼          ▼          ▼          ▼          ▼
        Engine     Wallet    Settlement   History    Analytics  Notifications
        (pure)     (ledger)                          Leaderboard  ProvablyFair
```

**Rule:** UI → Runtime → (Engine + Providers). Games never reach past the Runtime.
There are two interchangeable implementations of every provider — a **demo** one (client
store, for local play) and a **real** one (backend ledger/Prisma) — selected by config.
Because the UI is written against the interface, the same game works in both modes unchanged.

---

## 3. Platform contracts

Canonical, type-only interfaces live in **`packages/types/src/contracts/`** and are exported
from `@gaming-platform/types`. They are framework-agnostic (browser + NestJS + engines) and
contain no business logic. The folder is self-contained so it can later graduate to a
dedicated `@gaming-platform/contracts` package without churn.

| Contract | File | Purpose |
|---|---|---|
| Primitives + `GameLifecyclePhase`, `SessionStatus`, `RoundStatus`, `BetOutcome` | `contracts/common.ts` | Shared vocabulary; `Money` is a decimal **string** (mirrors `Decimal(38,18)`). |
| `IBetRequest`, `IBetResult`, `IBetSelection`, `IStake`, `IAutoBetConfig`, `ICashOutRequest/Result`, `BetMode`, `RiskLevel` | `contracts/betting.ts` | The one bet shape for single / multiple / auto / cash-out. |
| `IGameEngine`, `IGameSession`, `IGameResult`, `IGameDescriptor`, `IGameCapabilities` | `contracts/game.ts` | A game = descriptor + pure engine. |
| `IGameRuntime`, `IRuntimeEvent`, `RuntimeEventType` | `contracts/runtime.ts` | The sole UI↔platform door. |
| `IWalletProvider`, `ISettlementProvider`, `IGameHistoryProvider`, `IProvablyFairProvider`, `IFairnessProof`, `INotificationProvider`, `IAnalyticsProvider`, `ILeaderboardProvider` | `contracts/providers.ts` | Pluggable dependencies (demo + real impls). |

```ts
import type { IGameRuntime, IBetRequest, IWalletProvider } from '@gaming-platform/types';
```

---

## 4. The canonical game lifecycle

**Every** game — instant, card, table, future live — runs this exact sequence, driven by the
Runtime (`GameLifecyclePhase`). A game engine only participates in **Execute Engine** and
**Calculate Result**; it never performs the money or IO steps.

```
Player intent
  → Create / resolve Session      (IGameRuntime.createSession)
  → Validate Bet                  (stake limits, session/game state)  ── IBetRequest
  → Debit Wallet                  (IWalletProvider.debit, idempotencyKey)
  → Execute Engine                (IGameEngine.createRound + IProvablyFairProvider)
  → Calculate Result              (engine → IGameResult, multiplier, fairness)
  → Settlement                    (ISettlementProvider.settle → IBetResult)
  → Credit Wallet                 (IWalletProvider.credit, on win/push/refund)
  → Save History                  (IGameHistoryProvider.record)
  → Update Statistics             (per-game stats)
  → Notifications                 (INotificationProvider, best-effort)
  → Analytics                     (IAnalyticsProvider, best-effort)
```

**Invariants**
- **Idempotency:** debit/credit dedupe on `IBetRequest.idempotencyKey`; a retried request
  never double-charges or double-pays.
- **Order:** money-out precedes engine execution; money-in follows settlement. Interactive
  games (blackjack, hi-lo, tower) loop Execute↔Calculate via `IGameEngine.step` before Settlement.
- **Fairness first:** `serverSeedHash` is committed at session/round start; the played result
  carries `IFairnessProof` so any outcome is independently verifiable — including on the
  frontend once games consume the engine (today's demo RNG will be replaced, not extended).
- **Best-effort tail:** Notifications/Analytics failures never fail a settled bet.

---

## 5. Runtime, wallet, bet & settlement flows

**Runtime flow** — the UI holds an `IGameRuntime`, calls `createSession` once, then
`placeBet` / `playRound` / `cashOut`, and `subscribe`s for `IRuntimeEvent`s
(`bet.placed → wallet.debited → engine.executed → result.calculated → settled → wallet.credited`).
The UI reacts to events; it does not orchestrate.

**Wallet flow** — only the Runtime → `IWalletProvider`. Real impl posts paired `LedgerEntry`
DEBIT/CREDIT via the wallet-engine (`WalletBalance.version` optimistic lock, Redis lock,
idempotency key); demo impl mutates `stores/demo-wallet.ts`. Same interface, so the UI is
identical in both modes.

**Bet flow** — one `IBetRequest` shape; the game-specific payload lives in
`selections[].pick` and `metadata`. `BetMode` selects single / multiple / auto; the Runtime
replays singles for auto-bet and settles multiples together.

**Settlement flow** — `ISettlementProvider.settle(session, result, bet, wallet)` maps a raw
`IGameResult` (fairness-relevant, money-free) to a settled `IBetResult` and performs the credit.
Keeping settlement separate from the engine lets house-edge / payout policy evolve without
touching game logic.

---

## 6. Shared betting model

`IBetRequest` supports, from one shape:

- **Single / Multiple** — `mode` + `selections[]` (N for accumulators).
- **Auto Bet** — `autoBet` (`rounds`, on-win/on-loss stake adjust, stop-on-profit/loss); the
  Runtime replays single bets and enforces stops.
- **Cash Out** — `ICashOutRequest` for games that declare `capabilities.cashOut` (crash-style).
- **Multiplier / Risk** — `IBetResult.multiplier`, `RiskLevel` on request.
- **Provably Fair** — `clientSeed` in, `IFairnessProof` out.
- **Forward-compatible (not built in 2.1):** `IGameCapabilities.multiplayer / liveDealer /
  tournament` gate future runtime features without contract changes.

---

## 7. Standard game module structure

Every future game is a folder that owns only presentation + config + an engine adapter. It
does **not** re-implement RNG, wallet, or history — those come from the Runtime.

```
<game>/
├── config.ts          # IGameDescriptor + engine preset (pure data)
├── engine-adapter.ts  # maps UI intent ↔ IBetRequest/IGameResult for its engine
├── runtime.ts         # obtains the shared IGameRuntime (no bespoke orchestration)
├── ui/                # React components (render state + collect intent only)
├── hooks/             # view hooks over runtime events
├── types.ts           # game-local pick/state types
├── assets/            # art/audio (data URIs or bundled)
├── tests/             # engine-adapter + component tests
└── README.md          # rules, payouts, capabilities
```

Rule **G2 (engine reuse):** no game ships bespoke runtime/wallet plumbing. Rule **G4
(zero-redesign scale):** adding a game = descriptor + preset + engine registration.

---

## 8. Service standardization

One service per concern, one interface each; existing backend services already satisfy most
and are **not** rewritten in 2.1.

| Concern | Contract | Backend impl (exists) | Demo impl (exists) |
|---|---|---|---|
| Wallet | `IWalletProvider` | `wallet-engine` (double-entry ledger) | `stores/demo-wallet.ts` |
| Game engine | `IGameEngine` | `games/*` engine plugins + `packages/game-sdk` | frontend prototypes (to migrate) |
| Runtime | `IGameRuntime` | `modules/runtime` (to add wallet wiring) | to be added (2.2) |
| Settlement | `ISettlementProvider` | engine payout + wallet credit (to unify) | `lib/game-result.ts settleRound` |
| History | `IGameHistoryProvider` | `modules/transactions` (read) | demo-wallet ledgers |
| Provably fair | `IProvablyFairProvider` | `modules/runtime/provably-fair.service` | — (demo uses local RNG today) |
| Leaderboard | `ILeaderboardProvider` | `modules/tournament` | `lib/leaderboard-mock.ts` |
| Analytics | `IAnalyticsProvider` | `modules/analytics` (stub) | no-op |
| Notifications | `INotificationProvider` | `modules/notifications` (realtime; persistence stub) | no-op |

**Duplicates to consolidate later (report only, not changed in 2.1):** two per-game table
implementations (`components/{roulette,dice,card}/*-table.tsx` vs `components/games/prototype/*`);
two header/nav systems; `settleRound` coupling to singleton `store.getState()`.

---

## 9. API contract standardization

Every game exposes the **same** operations — never game-specific endpoints unless a title
genuinely cannot be expressed by the shared shape.

| Operation | Contract method | Notes |
|---|---|---|
| Create Session | `IGameRuntime.createSession` | returns `IGameSession` (+ `serverSeedHash`) |
| Get Session | `IGameRuntime.getSession` | |
| Place Bet | `IGameRuntime.placeBet` | `IBetRequest → IBetResult`, idempotent |
| Play Round | `IGameRuntime.playRound?` | non-interactive convenience |
| Cash Out | `IGameRuntime.cashOut?` | only if `capabilities.cashOut` |
| History | `IGameHistoryProvider.list` | cursor-paginated |
| Statistics | per-game stats read | |
| Provably Fair | `IProvablyFairProvider.commit/verify` | |

Transport (REST vs WebSocket) is an implementation detail behind the interface; interactive/
realtime games use the WS runtime, instant games may use request/response — the UI contract is
identical either way.

---

## 10. Folder conventions (target)

```
apps/
  frontend/            # Next.js app (UI + demo providers)
  backend/             # NestJS API (real providers, engines host)
packages/
  types/               # shared types + contracts/  ← platform contracts live here (2.1)
  game-sdk/            # engine plugin framework (BaseGamePlugin, PluginHost, registry)
  ui/                  # design system
  auth/ config/ shared/ wallet-core/ tournament-core/ ops-core/ ai-core/ database/
games/
  card-engine/ crash-engine/ dice-engine/ roulette-engine/ lottery-engine/ sports-engine/
```

Files are **not** relocated in 2.1 (avoiding regressions). Future domain folders
(`runtime/`, `betting/`, `settlement/`, `providers/`) are introduced as their real
implementations land, following the contracts above. When `contracts/` grows beyond types,
promote it to `packages/contracts`.

---

## 11. Coding & module conventions

- **Money is a decimal string** end-to-end (`Money`); never a JS float.
- **Idempotency keys** on every wallet-affecting call.
- Games depend on **interfaces**, never concrete providers or stores.
- Engines are **pure** (input + RNG → result); no IO, no wallet, no `Date.now()`/`Math.random()`
  in engine output (use the provably-fair provider).
- Enums/statuses come from `contracts/common.ts`; do not redefine locally.
- `import type` for all contract imports (type-only, tree-shaken).

---

## 12. Future extension guidelines

**Add a game:** write `config.ts` (`IGameDescriptor` + engine preset), an `engine-adapter.ts`,
UI that renders engine state and emits `IBetRequest`; register the engine plugin. No wallet,
RNG, or history code.

**Add a provider (portal/finance/etc.):** implement the relevant `I*Provider`; the Runtime and
UI consume it unchanged. New portals get a **role-aware guard** (RBAC helpers `hasPermission`/
`hasRole` already exist in `auth-store` but are currently unenforced — enforcement is a
prerequisite before shipping privileged portals).

**Add realtime/multiplayer/live/tournament:** flip the `IGameCapabilities` flags and back them
with runtime features — the bet/result/settlement contracts already accommodate them.

---

## 13. What Phase 2.1 delivered (and did not)

**Delivered:** the contracts (`packages/types/src/contracts/*`), this standard, the canonical
lifecycle, and the service/API/folder conventions.

**Deliberately not touched:** no game behavior, no wallet wiring, no new gameplay, no UI
redesign, no service rewrites, no file relocations. Existing gameplay is unchanged.

**Next (Phase 2.2):** implement `IGameRuntime` + a demo and real provider set, and migrate one
reference game (Crash or Dice) end-to-end onto the runtime to prove the path before the wider
game expansion.

## 14. Interactive runtime & flexible settlement (Phase 2.3C)

The runtime completed two **generic, additive** capabilities so multi-step games and
non-multiplicative payouts run on the same core. The runtime still knows **no game rules** — it
owns the state machine and stores opaque state; engines decide transitions and payouts.

### 14.1 Interactive engine

An engine implements **exactly one** shape (both optional on `RuntimeGameEngine` / `IGameEngine`):

- **Single-shot** — `createRound(input) → IGameResult` (crash, dice, roulette, plinko).
- **Interactive** — `start(input) → IStepResult` and `step(input + gameState + action) → IStepResult`.

`IStepResult` = `{ state: RuntimeState; gameState; availableActions?; settlement?; display? }`.
`gameState` is **opaque** to the runtime; the UI renders it. When `state === Completed`, the engine
MUST include a `settlement` (see 14.3).

### 14.2 State machine

`RuntimeState`: `Waiting → Running → AwaitingPlayer → AwaitingSystem → Completed | Cancelled | Expired`.
The runtime drives it:

- `startInteractive(bet)` → validate → **debit** → `engine.start` → store state → emit `STEP_STARTED`
  + `STATE_CHANGED`. If the engine completes on start, it settles immediately.
- `submitAction({ roundId, action })` → routes a generic `PlayerAction { type, payload? }` to
  `engine.step`; the **engine** decides legality (throws to reject). Emits `PLAYER_ACTION` →
  `STEP_COMPLETED` → `STATE_CHANGED`; on `Completed`, settles.
- `getStep(roundId)` → current `{ state, gameState }`.
- `cancelInteractive({ roundId })` → refund the stake + `Cancelled`.
- An action past the session idle window → `Expired` (`SESSION_EXPIRED`).

Guards: unknown round → `ROUND_NOT_FOUND`; action after terminal → `ROUND_ALREADY_SETTLED`.

### 14.3 Flexible settlement model

`ISettlementResult` replaces the `stake × multiplier` assumption:

```
{ type: SettlementType; payout: Money; refund?: Money; bonus?: Money;
  multiplier?: number; metadata?; display?; reason? }
```

`SettlementType` = `Win | Loss | Push | Refund | Bonus | Jackpot | Custom`. The settlement provider
credits `payout + refund + bonus`, maps `type` (+ net for `Custom`) to the canonical `BetOutcome`,
and carries `metadata` through to history. **Absent** `settlement` → the legacy multiplicative path
(crash/dice/roulette/plinko unchanged). Single-shot engines may also emit `result.settlement` for
absolute payouts (jackpots, bonuses) via the normal `placeBet` path.

New generic events (additive; no renames): `STEP_STARTED`, `STEP_COMPLETED`, `PLAYER_ACTION`,
`STATE_CHANGED`, `SETTLEMENT_UPDATED`.

### 14.4 Card-game integration guide (interactive)

1. Write a pure engine with `start` (deal → `AwaitingPlayer`, `availableActions`) and `step`
   (validate the action; on a terminal move return `Completed` + an `ISettlementResult`; else the
   next `AwaitingPlayer`/`AwaitingSystem` state). Derive randomness from the injected
   `rng.nextFloat` (vary `clientSeed` by draw index for reproducibility).
2. Register `{ engine, descriptor }` in `src/games/registry.ts` (descriptor `rewards` for XP).
3. In the component: `startInteractive(bet)` on play; render `step.gameState`; wire buttons to
   `submitAction({ roundId, action: { type } })`; the runtime settles on `Completed`.

Reference: `src/runtime/testing/mock-engines.ts::MockCardEngine` (proof only — not a real game).

### 14.5 Slot integration guide (flexible settlement)

A slot is single-shot: `createRound` returns `IGameResult` with a `settlement` of type `Win` /
`Jackpot` / `Bonus` (absolute `payout` + `bonus`, plus `metadata` like `{ jackpot: true }`), or
`Loss`. The component drives it with `startRound` → animate → `cashOut`/`finishRound`, or
`placeBet` for an instant reveal. Per-round game naming (each slot title) remains a follow-up if a
single `slots` descriptor is insufficient. Reference:
`src/runtime/testing/mock-engines.ts::MockSlotEngine`.

### 14.6 Backward compatibility

All Phase 2.3C changes are additive: optional contract fields (`IGameResult.settlement`,
`IBetResult.metadata`), optional engine methods, appended enum members, and new runtime methods.
Crash, Dice, Roulette and Plinko are unchanged and verified by the existing suite (199 tests green,
runtime coverage ≥ Phase 2.3A thresholds).

## 15. Full runtime adoption (Phase 3)

**Every wagering game now runs through the runtime.** All 12 use `IGameRuntime`, the game
registry, an engine, `SessionManager`, `BetEngine`, the provider layer (settlement / history /
provably-fair), the event bus and feature flags. No game touches the wallet, history, RNG,
settlement or session directly.

- **Single-shot reveals** (Crash, Dice, Roulette, Plinko, Dragon Tiger, Andar Bahar, Lucky 7,
  Baccarat, Teen Patti) — a pure engine + `startRound` → animate → `cashOut`/`finishRound`.
- **Interactive** (Blackjack, Casino War) — `startInteractive` → `submitAction` → `resolve`, with
  the dealer/war reveal deferred to `AwaitingSystem` so settlement lands at the animation end.
- **Slots** — a single `slots` engine with flexible settlement (Win / Jackpot + `metadata`),
  serving the generic renderer for many titles.

Two **minimal, generic, additive** runtime capabilities completed adoption (the only Phase 3
runtime changes — no architecture/provider/contract/event/state-machine changes):

1. **`raiseStake({ roundId, amount })`** — increases a live interactive round's committed stake,
   debiting the increment through the wallet. The generic primitive behind a blackjack *double* or
   a casino-war *go to war*; the runtime knows nothing about either.
2. **Per-round history identity** — `bet.metadata.gameName` / `bet.metadata.statsKey` override the
   ledger display name + stats key for that round (the generic slot renderer keys each title). A
   settlement-aware XP guard awards none on Push/Refund (matching the legacy behaviour).

### 15.1 Engine guide (single-shot)

Write a pure `RuntimeGameEngine.createRound(input) → IGameResult`: derive the outcome from
`rng.nextFloat(fairness)` (reuse `@/lib/deck` for cards), set `multiplier` (0 on a loss) and a
`display: { label, value }` so history keeps the game's own label. Register `{ engine, descriptor }`
in `src/games/registry.ts` with `rewards` for XP. The component calls `startRound` → animates the
engine's `state` → settles via `cashOut` (win) / `finishRound` (loss).

### 15.2 Interactive engine guide

Implement `start` (deal → `AwaitingPlayer` + `availableActions`) and `step` (validate the action;
draw/compute; return the next state). For a reveal that should settle at the animation end, return
`AwaitingSystem` from the decision step and settle on a follow-up `resolve` action. Emit the terminal
`settlement` (an `ISettlementResult`) on `Completed`. For a mid-round extra bet, the UI calls
`raiseStake` before the action; the engine reads the (now-raised) `bet.stake` at settlement.

### 15.3 Slot guide

One `slots` engine handles every title: the UI passes `{ slug, jackpot }` as the selection pick and
`{ gameName, statsKey }` as `bet.metadata`. The engine builds the reel strips from the slug, derives
the stops from `rng.nextFloat`, and returns a flexible `ISettlementResult` (`Win`/`Jackpot` with an
absolute payout + `metadata`). Reels animate to the engine's `targets`.

### 15.4 Regression

Gameplay, animations, payouts, history, XP, provably-fair and UI are preserved; the only intended
change across the migrated games is that per-round *exact-seed replay* becomes "play/deal again"
(the frozen runtime exposes reproduction via `getReplay`, not same-seed re-roll). 212 tests green;
runtime coverage ≥ Phase 2.3A thresholds.

## 16. New instant games on the frozen runtime (Phase 4)

Nine new games were added with **zero platform changes** — only `src/games/**` (engines +
registry) plus UI. This proves the runtime is a true platform: a new game = a pure engine + a
registry entry + a UI that calls the runtime.

| Game | Type | Rules & payout | House edge |
|---|---|---|---|
| **Limbo** | single-shot | Pick a target; a crash-curve multiplier is generated; win pays the target if generated ≥ target. P(win)=edge/T. | ~1% |
| **Coin Flip** | single-shot | Heads/tails; correct call pays 1.98× (fair 2× − 1%). | ~1% |
| **Wheel** | single-shot | Pick a risk; land on a segment multiplier (0 = lose). Each risk set has mean ≈ 0.96. | ~4% |
| **Mines** | interactive | 5×5 grid, N mines; reveal safe tiles to grow the multiplier; cash out any time. | ~1% |
| **Bomb Hunt** | interactive | Same engine as Mines, 4×4 grid (a game = config). | ~1% |
| **Tower** | interactive | Climb rows; pick a safe tile each row to climb; cash out any time. | ~1% |
| **Keno** | single-shot | Pick ≤10 of 40; 10 drawn; pick×match paytable. | table |
| **Bingo** | single-shot | 5×5 card, 10 drawn; pay by completed lines (of 12). | table |
| **Lucky Pick** | single-shot | Pick 1 of 5 boxes; weighted multiplier tier (mean ≈ 0.96). | ~4% |

### 16.1 Randomness

Every game derives ALL randomness from the runtime's provably-fair provider — no `Math.random`,
no local generators. Single-value games call `rng.nextFloat(fairness)`; multi-value games
(Keno/Bingo/Mines/Tower) use `src/games/instant/rng.ts` (`floatAt`, `shuffleFair`), which vary the
`clientSeed` by index so a round yields several reproducible floats from one commit. Interactive
boards (mine/trap positions) are recomputed from fairness on every step and never sent to the
client until the round ends — provably fair + tamper-evident.

### 16.2 Adding a game (the whole checklist)

1. **Engine** in `src/games/**` — a pure `RuntimeGameEngine`: `createRound` (single-shot) or
   `start`/`step` (interactive), returning `multiplier`/`display` or a flexible `settlement`.
2. **Registry** — one `GAME_MODULES` entry: `{ engine, descriptor }` with capabilities, limits,
   `rewards`. (Reuse an engine across games via config — Mines + Bomb Hunt share `grid-reveal`.)
3. **UI** — a component that calls `useGameRuntime(gameId)` + `startRound`/`cashOut`/`finishRound`
   (single-shot) or `startInteractive`/`submitAction` (interactive) — **never a provider directly**
   (reference: `LimboGame`). Route it in the play dispatcher (`demo-games.ts` + `demo-play.tsx`).

No runtime, provider, contract, event, or state-machine change is required — verified: Phase 4
touched zero files under `src/runtime/**` or `packages/types`.

## 17. Production game UI kit (Phase 4B)

Every instant game now has a production UI — all built as **pure UI over the frozen runtime**
(zero platform/engine/registry changes). The UIs live in
`src/components/games/prototype/instant/` and are lazy-loaded + routed through
`demo-play.tsx` (via `INSTANT_PROTO` in `demo-games.ts`).

### 17.1 Shared UI primitives (`instant/shared.tsx`)

- **`BetAmount`** — amount input + ½/2× + quick chips (labelled controls).
- **`HistoryStrip`** — recent-results strip with an empty state.
- **`Stat`** — a stat tile.
- **`ProvablyFair`** — a native `<details>` disclosure surfacing the round's committed
  `serverSeedHash` (keyboard-operable, screen-reader friendly).

Reuse these for any new game's UI so bet controls, history, and the fairness panel stay
consistent and accessible.

### 17.2 UI contract

A game UI calls **only** `useGameRuntime(gameId)` + the runtime lifecycle — never a provider,
wallet, RNG, or settlement:
- **Single-shot** (Coin Flip, Wheel, Keno, Bingo, Lucky Pick): `startRound` → animate the engine's
  `state` → `cashOut` (win) / `finishRound` (loss).
- **Interactive** (Mines, Bomb Hunt, Tower): `startInteractive` → `submitAction`
  (`reveal`/`pick`/`cashout`); render `step.gameState`, settle on `Completed`.

### 17.3 Animation, sound, accessibility, responsiveness

- **Animations** (framer-motion) are presentation-only and never gate settlement: coin spin,
  wheel rotation (SVG wedges), tile reveal, explosion, floor climb, ball draw, number reveal, box
  reveal. Reduced-motion is honoured by the shared `@/lib/sound` (muted by default) and by keeping
  outcomes independent of animation.
- **Sound**: cues come from `@/lib/sound` (`click/coin/win/jackpot/lose/reveal/cashout/ball/…`) with
  a global mute — never hardcoded in engines.
- **Accessibility**: `role="radiogroup"`/`radio` for choices, `role="grid"/"gridcell"` for boards,
  `aria-label`/`aria-live` on stages, focusable native controls, disabled-state management.
- **Responsive**: a `2fr/1fr` stage-plus-controls grid that stacks on mobile; boards use CSS grid
  with `aspect-square` cells; `max-w` caps keep the stage centred on desktop.
- **Performance**: each game is a `next/dynamic` lazy chunk; game state lives in the runtime for
  interactive rounds (the UI holds only view state); no per-frame React state in hot paths.

## 18. Production ledger & wallet (Phase 5A)

The demo financial layer is now backed by a **production-grade double-entry ledger** — the single
financial source of truth. **Zero platform change**: the Runtime, providers used by games, engines,
registry, settlement flow, event bus and session manager are untouched; money still flows
**Game → Runtime → Wallet Provider → `useDemoWallet` → Ledger**.

### 18.1 Ledger architecture (`src/lib/ledger/`)

Framework-agnostic TS (no React/store) so it lifts to a backend unchanged.

- **`LedgerEntry`** — one side of a transaction on one account: `direction` (credit/debit),
  `amount` (positive integer minor units — never a float), `balanceBefore`/`balanceAfter` (audit).
- **`Transaction`** — a balanced set of entries (Σ credits === Σ debits), the atomic movement,
  tagged with `type`, `status`, `reference`, `reason`, `actor`, `idempotencyKey`, `correlationId`,
  `gameId`, `roundId`, `metadata`, `reversalOf`.
- **`Ledger`** — append-only entries + transactions; `post()` validates balance + amounts, guards
  per-account negatives (system accounts exempt), and dedupes on `idempotencyKey` (exactly-once).
  **Balances are derived** (`balanceOf` is a re-derivable cache; `deriveBalance` replays entries;
  `reconcile()` proves cached === replayed and the system sum is 0). `history()` paginates/filters;
  `snapshot()`/`hydrate()` persist.

Accounts: `player:{id}:wallet` (spendable), `:locked` (reserved), `:vault` (savings), `house:main`
+ `external:world` (system counterparties that may go negative — they mirror total player liability).

### 18.2 Wallet architecture (`WalletService`)

The money API over the ledger: `createWallet`, `getBalance` (available/locked/total), `credit`,
`debit` (negative-guarded), `transfer`, `reserve`/`release`, `rollback` (posts the mirror image),
`history`, `reconcile`. Every operation is idempotent on its key and retry-safe.

### 18.3 Transaction model & flow

`TransactionType`: Deposit, Withdrawal, Bet, Win, Refund, Adjustment, Bonus, Promotion,
ManualCredit, ManualDebit, Jackpot, Transfer, Reserve, Release, Reversal. Each movement posts a
balanced pair (player account ↔ house/external). A bet: `debit player:wallet` + `credit house`; a
win: `credit player:wallet` + `debit house`; a deposit: `credit wallet` + `debit external`.

### 18.4 Idempotency, concurrency, audit

- **Idempotency**: `post()` returns the existing transaction for a repeated `idempotencyKey` —
  exactly-once. A duplicate settlement retry credits once. (In a DB: a unique index on the key.)
- **Concurrency**: single-threaded here, but the two-phase project→guard→commit + idempotency give
  retry safety and prevent double-spend/overdraw. (In a DB: a row `version` / `SELECT … FOR
  UPDATE`, mapped from this design.)
- **Audit**: every entry carries before/after balances; every transaction carries who (`actor`),
  when (`at`), why (`reason`/`reference`), correlation/game/round ids, and metadata.

### 18.5 Migration (STEP 9)

`src/stores/wallet-ledger.ts` holds the authoritative session `WalletService`, seeded once from the
restored balance. `useDemoWallet`'s money actions **mirror** every movement into it; the store's
`balance` projection is reconciled to the ledger (`reconcileWallet`) and stays byte-identical, so
the demo casino behaves exactly as before while the ledger is the source of truth. The store's
public API is unchanged — the wallet provider, history provider and UI need no changes.

### 18.6 Database model & future payment integration points

Lift-to-backend mapping: `ledger_accounts`, `ledger_entries` (append-only, indexed by
`account`,`transaction_id`,`at`), `transactions` (unique on `idempotency_key`). Balances are a
materialized view / running total re-derivable from entries. **Payment integration points (later
phases, NOT implemented here):** Deposit/Withdrawal transaction types are placeholders where a
gateway (Razorpay/Stripe/Cashfree/PhonePe/UPI) would post the `external:world` leg after
provider confirmation; KYC/withdrawal-approval gate the `Withdrawal` posting. None of that exists
yet — this phase delivers only the ledger + wallet foundation.

## 19. Payment platform & gateways (Phase 5B)

A **provider-agnostic** payment platform sits below the ledger: deposits flow
`PaymentService → ledger port → wallet → ledger`. The casino never depends on a
gateway vendor — each is an adapter behind `IPaymentProvider`. **Zero platform
change** (nothing under `src/runtime/**`, `packages/types`, `src/games/**`, or the
game providers). Module: `src/lib/payments/` (framework-agnostic TS).

### 19.1 Provider abstraction

`IPaymentProvider`: `createDepositIntent`, `verifyPayment` (callback), `verifyWebhook`,
`capturePayment`, `cancelPayment`, `refundPayment`, `queryStatus`, `healthCheck`. Every gateway
implements it; **no provider-specific logic lives outside its adapter**. `GatewayRegistry` +
`createGatewayRegistry(configs)` register only the configured gateways and stay open to new ones
(Paytm/PayPal) without touching existing code.

### 19.2 Gateway adapters — real signature schemes

- **Razorpay** — callback `HMAC-SHA256(order_id|payment_id, keySecret)`; webhook
  `HMAC-SHA256(rawBody, webhookSecret)` in `x-razorpay-signature`.
- **Stripe** — `Stripe-Signature: t=…,v1=…`; `HMAC-SHA256(${t}.${rawBody}, endpointSecret)` with a
  replay-tolerance window; redirects are unsigned so completion is webhook-only.
- **Cashfree** — `x-webhook-signature = base64(HMAC-SHA256(${timestamp}${rawBody}, secret))` with a
  timestamp replay window.
- **PhonePe** — `X-VERIFY = sha256(base64Body + endpoint + saltKey)###saltIndex` (SHA-256, base64
  body decoded after verification).

No network calls are made (no live keys); `createDepositIntent` returns the modeled order the
client SDK would open. All ops are async, matching real gateway I/O.

### 19.3 Deposit lifecycle & webhook flow

`createDeposit` (validate → `Created` → gateway intent → `Pending`) → checkout → **webhook**
(`verifyWebhook`: signature + replay window) or signed **callback** → normalize → **credit the
ledger port** → `Succeeded`. Only verified events touch the ledger. Statuses: Created, Pending,
Authorized, Captured, Succeeded, Failed, Cancelled, Expired, Refunded, Reversed. Every step writes
an audit record (no secrets) and emits a payment event (a payment-local emitter — the runtime
EventBus is untouched).

### 19.4 Idempotency (exactly-once)

Triple-guarded: (1) **webhook-event dedup** (`processedEvents` set — duplicate/replayed events are
no-ops), (2) an **intent status guard** (a `Succeeded` intent never re-credits), and (3) the
**ledger idempotency key** `deposit:<intentId>` (the ledger dedupes too). Verified across duplicate
webhooks, a duplicate callback, and a webhook+callback race — the wallet is credited exactly once.

### 19.5 Security & ledger integration

Timing-safe signature comparison; per-webhook replay window; input validation (positive-integer
amount, currency, known provider); cryptographically-random ids; secrets used only to compute a
digest (never logged — asserted). On success the flow is: create ledger transaction → credit wallet
→ update payment status → write audit → emit event — **never a direct balance change**. Refunds
reverse via the ledger `debit` port.

### 19.6 Provider integration guide

To add a gateway: (1) write `MyProvider implements IPaymentProvider` in
`src/lib/payments/providers/` (its signature scheme only), (2) add its config to `GatewayConfigs`
and register it in `createGatewayRegistry`. Nothing else changes — the `PaymentService`, ledger,
wallet, runtime, and games are all untouched. **Not implemented (later phases):** withdrawal
approval, KYC, AML, fraud detection, and any finance/admin/partner portal.

## 20. Withdrawals, treasury & finance operations (Phase 5C)

The **cash-out** layer above the ledger: `Games → Runtime → Wallet → Ledger → Withdrawal
Service → Treasury Engine → Payout Gateway → external`. **The Runtime never knows withdrawals
exist** — money leaves the platform only through this workflow, and every movement is
double-entry through the Phase 5A ledger (no balance is ever touched directly). **Zero platform
change** (nothing under `src/runtime/**`, the game engines, registry, game providers, settlement,
event bus, or session manager). Module: `src/lib/treasury/` (framework-agnostic TS).

### 20.1 Withdrawal model & lifecycle

A `Withdrawal` carries `id` (opaque `wd_<hex>`), human `reference` (`WD-000001`), player, amount
(integer minor units), currency, `status`, method/destination (masked), `correlationId`,
`idempotencyKey`, approval/rejection metadata, `ledgerRefs` (the txn id of each step:
reserve/commit/settle/disburse/release/reverse) and timestamps. The lifecycle supports full and
partial cash-outs, cancel, reject, reversal and retry.

### 20.2 Approval state machine (STEP 4)

A configurable, **validated** transition table (`WITHDRAWAL_TRANSITIONS`): `Draft → Requested →
PendingReview → Approved → Processing → Completed`, with `Rejected`/`Cancelled`/`Failed`/`Reversed`
branches. `Failed → Processing` (retry) and `Completed → Reversed` are allowed; terminal states
(`Rejected`/`Cancelled`/`Reversed`) have no exits. Every service action calls `assertTransition`
before moving money, so an out-of-order approval or settlement can never occur.

### 20.3 Treasury engine — double-entry money flow (STEP 3)

`TreasuryEngine` posts balanced pairs over the ledger through four treasury accounts:
`player:{id}:locked` (Reserve) → `treasury:pending` (commit) → `treasury:settlement` →
`external:world` (disburse). Steps: `commit` (locked→pending), `settle` (pending→settlement, then
settlement→external, `external:world` allowed negative), `releasePending` (pending→locked, undo a
commit), `reverse` (external→wallet, undo a completed disbursement). `external:world` is the single
shared outside-world account (also used by deposits), so its balance equals `-(net funds inside the
platform)`.

### 20.4 Withdrawal service (STEPs 2 & 10)

`WithdrawalService` orchestrates: `createRequest` (validate limits + available balance, idempotency
dedupe, **reserve** wallet→locked, status `Requested`) → `submitForReview` → `approve` (authorizer
hook) → `process` (**commit** locked→pending + call the payout gateway) → on success **settle**
(pending→external, `Completed`), on failure `Failed` (funds stay in pending). Branches: `reject`/
`cancel` **release** funds back to the wallet (cancel-from-`Failed` first unwinds the commit),
`retry` re-attempts a failed payout, `reverse` returns a completed disbursement. The canonical rule
holds: **Reserve → ledger txn → await approval → settle → release/finalize → audit; never a direct
balance change.** Each lifecycle step is keyed (`wd-reserve:<id>`, `wd-commit:<id>`,
`wd-settle:<id>`, …) so retries are idempotent.

### 20.5 Financial limits (STEP 5)

`WithdrawalValidator` enforces: positive-integer amount, `min`, `perTransaction`, a **rolling-day
`dailyMax`** (tallied from active withdrawals via an injectable clock), and the player's
**available balance** (`INSUFFICIENT_FUNDS`). Cancelled/rejected/reversed withdrawals free daily
headroom again. The ledger's own per-account negative-balance guard is the final backstop.

### 20.6 Reconciliation (STEP 6)

`reconcile()` proves the whole ledger balances (`systemSum === 0`) **and** that the
`treasury:pending` balance equals the sum of `Processing`/`Failed` withdrawals, flagging any
`unmatched` ids. `treasurySummary` reports reserved/pending/settlement/external totals + balanced
flag; `settlementSummary` reports completed count + amount.

### 20.7 Manual operations (STEP 7)

All authorizer-gated and fully audited: `manualAdjustment` (ledger credit/debit, actor recorded in
the reason + audit), `manualRelease` (free a stuck reservation), `manualRetry`, `manualReversal`.
No operation bypasses the ledger.

### 20.8 Reporting & security (STEPs 8 & 9)

Reporting: `history` (filter by player/status/date/search, cursor pagination), `pending`,
`completed`, `rejected`, `treasurySummary`, `settlementSummary`, `auditTrail`. Security: injectable
`Authorizer` (approve/reject/manual/reverse/retry) and `RateLimiter` hooks, input validation,
cryptographically-random opaque ids + correlation ids, per-step idempotency keys (replay
protection), and an audit record on every action carrying **no** sensitive data.

### 20.9 Payout provider integration guide

To add a payout rail: implement `IPayoutGateway.payout(...)` (returns `{ok, reference?, reason?}`)
and inject it into `WithdrawalService` — exactly like the deposit port. Nothing else changes; the
ledger, wallet, treasury, runtime and games are untouched. Risk/compliance gating arrived in Phase
5D (§21); the Phase 5C service exposes an optional hook for it.

## 21. Risk, compliance & fraud platform (Phase 5D)

A **provider-agnostic** Risk & Compliance Platform sits between the Withdrawal Service and the
Treasury Engine: `Withdrawal Service → Risk & Compliance → Treasury Engine`. **Risk evaluates;
Treasury executes.** The platform makes decisions and **never moves money** — money movement stays
with the Treasury Engine + Ledger. **Zero platform change**: nothing under `src/runtime/**`, the
game engines, registry, game providers, settlement, event bus, session manager, ledger, treasury
*accounting* (`treasury-engine.ts`), or payment platform is modified. The treasury integration is a
single **optional, additive** hook. Module: `src/lib/compliance/` (framework-agnostic TS).

### 21.1 Decision engine (STEP 1)

`DecisionEngine` aggregates the policy reasons + resolved signals into one `DecisionResult`
(`action`, `allowed`, `reasons`, `riskScore`, `signals`). Actions, by severity: **Approve <
ManualReview < Hold < Escalate < Reject** — the most severe fired reason wins; none ⇒ Approve. Only
`allowed === true` (Approve) lets Treasury proceed. Pure + deterministic; the aggregate 0–100
`riskScore` is dominated by the worst signal, nudged by the rest.

### 21.2 Policy engine (STEP 2)

`PolicyEngine` is a runtime registry of data-driven `DecisionRule`s (`set`/`remove`/`toggle`), so
new policy ships as configuration, not code. `defaultPolicyRules(config)` provides a
production-representative set — KYC-required-for-withdrawal, AML sanctions/watchlist/PEP,
high-value manual review (VIP-exempt), restricted jurisdictions, high fraud score, velocity
exceeded, untrusted device, business hours, responsible-gaming cap — every threshold a parameter.

### 21.3 KYC framework (STEP 3)

`IKYCProvider` adapters behind `KYCService`, which caches the latest `KYCResult`
(`VerificationStatus`/`DocumentStatus`/`IdentityStatus`/level) per player so the **synchronous**
decision path reads a status without an inline call. `MockKYCProvider` only — no real credentials.

### 21.4 AML framework (STEP 4)

`IAMLProvider` adapters behind `AMLService`; screening yields `SanctionsCheck` + `PEPCheck` +
`WatchlistCheck` → `RiskFlag[]` + `RiskLevel`, cached per player. `MockAMLProvider` seeds hits +
high-risk jurisdictions deterministically. Adapters only — no external API credentials.

### 21.5 Fraud framework (STEP 5)

`FraudEngine` blends configurable-weight `FraudSignal`s into a 0–100 `FraudScore`: velocity, rapid
deposits/withdrawals, duplicate accounts (shared device/IP), bad device reputation, unusual bet
patterns, and an **impossible-travel** hook (distinct recent countries). A `FraudModel` interface is
the explicit **future-ML integration point** — a model contributes additional weighted signals.

### 21.6 Device trust (STEP 6)

`DeviceTrustService` fronts `IDeviceTrustProvider` (IP reputation / VPN / Tor / proxy hooks) and a
trusted-device registry, deriving a `DeviceRisk` band (Trusted/Unknown/Suspicious/Blocked — Tor is
blocked, VPN/proxy/low-rep is suspicious). `DeviceFingerprint` carries a browser-fingerprint hash
hook. `MockDeviceProvider` only.

### 21.7 Geofencing (STEP 7)

`GeoService` classifies a `GeoSignal` into `GeoStatus` (Allowed/Restricted/Blocked/Unknown) against
configurable blocked-countries, allow-lists, and per-country restricted states, plus a
timezone-consistency hook (a coarse location-spoof heuristic). Optional `IGeoProvider` IP lookup.

### 21.8 Velocity controls (STEP 8)

`VelocityControls` keeps rolling-window counters per player + `VelocityKind` (deposits, withdrawals,
failed attempts, logins, device changes, IP changes), pruned to the widest window. All limits are
configuration; an injectable clock keeps it testable.

### 21.9 Compliance audit (STEP 9)

`ComplianceAudit` append-only-records **every** decision: action, reasons (rule codes), risk score,
KYC/AML/fraud/device/geo status, timestamp, actor, correlation id — queryable by
player/correlation/action/operation/date. 100% audit coverage (one record per decision).

### 21.10 Treasury integration (STEP 10)

`ComplianceService` is the facade: `decide(ctx)` is **synchronous** over cached provider snapshots +
the sync engines (so the Withdrawal Service gates inline without changing its signature);
`evaluate(ctx)` is the async full path that refreshes providers first. The Withdrawal Service takes
an **optional** `decisionGate` and calls `decideWithdrawal(...)` **before** reserving funds — on any
non-Approve it throws `COMPLIANCE_BLOCKED` and **no ledger posting occurs** (Approve ⇒ Treasury
reserves; Reject/Hold/ManualReview/Escalate ⇒ Treasury stops). The gate is declared structurally in
the treasury layer, so neither module imports the other. With no gate wired, behavior is byte-
identical to Phase 5C (all 287 prior tests stay green).

### 21.11 Integration & extension guide

Compose the platform with `ComplianceService.create(config)` (mock providers + default policy) or
wire the parts directly. To go to production: swap each `Mock*Provider` for a real adapter
(implementing `IKYCProvider`/`IAMLProvider`/`IDeviceTrustProvider`/`IGeoProvider`), tune the policy
config, and register a `FraudModel`. Nothing in the runtime, games, ledger, treasury accounting, or
payment platform changes. **Not implemented (by design):** any Finance/Admin/Partner portal UI.

## 22. Operations & administration platform (Phase 6A)

An enterprise back-office layer for internal staff: `Player Platform → existing APIs → Operations
API → Admin Services → existing platform services`. It **consumes** the frozen services (ledger/
wallet, treasury/withdrawals, compliance) through **read-only ports** and exposes RBAC-gated
administration. **Zero platform change**: nothing under `src/runtime/**`, games, ledger, treasury,
payments, compliance, settlement, event bus or session manager is modified — operations is purely
additive and never on a write/settlement path. Module: `src/lib/operations/` (framework-agnostic TS).

### 22.1 Operations architecture (STEP 1)

`OperationsService` is the single RBAC-enforced facade composing the sub-services: `PlayerService`,
`AccountService`, `SupportService`, `SearchService`, `AuditViewerService`, `DashboardService`,
`HealthService`, `ReportingService`. The frozen services are wrapped by thin `adapters.ts` factories
(`walletReadPort`/`withdrawalReadPort`/`complianceReadPort`) that call only public **read** methods —
the seam that lets operations consume without importing internals or reaching a mutation.

### 22.2 RBAC model (STEP 2 & 9)

`RBACService` resolves `Role → Permission` with **inheritance** (flattened + cached), **permission
groups** (`PermissionGroups`) and optional **scoped** permissions. Seven roles — Super Admin,
Operations Admin, Finance Admin, Support Admin, Compliance Admin, Read-Only Auditor, Support — each a
composition of granular feature permissions. **Deny-by-default**: an unknown/empty role grants
nothing. `assert()` is the enforcement primitive; `OperationsService.enforce()` wraps every call —
permission-check **before** work, and an audit record on **both** allow and deny.

### 22.3 Player management (STEP 3)

`PlayerService.overview(id)` aggregates a read-only snapshot: account status, wallet summary
(available/locked/vault), deposit summary (ledger `deposit` rows), withdrawal summary (pending/
completed), risk summary (compliance decisions + flags) and support-note count. `timeline(id)`
merges support notes + risk decisions + account changes (newest first). `SearchService` is a bounded
player directory with substring match + cursor pagination.

### 22.4 Account operations (STEP 4)

`AccountService` owns operational account state — suspend / unsuspend / temporary lock (with expiry)
/ unlock / responsible-gaming self-exclusion — each with reason + actor + timestamp. Expired
temporary locks/exclusions auto-clear via `effectiveStatus`. This is operations-owned state; it never
touches the wallet, ledger or gameplay (the player platform may *consult* it — a future wiring).

### 22.5 Support tools (STEP 5)

`SupportService` — internal/case notes + operator comments per player, with escalation tags,
attachment reference hooks (ids only, never inlined), full-text search and a note-derived timeline
slice.

### 22.6 Audit viewer (STEP 6)

`AuditViewerService` merges the three read-only streams — **financial** (withdrawal history),
**compliance** (decision audit) and **operations** (action audit) — into one `UnifiedAuditRecord`
view with filtering, search, cursor pagination, correlation-id lookup and export-ready rows.
Per-source RBAC: reading a source requires its `audit.view.*` permission (a finance-only auditor
cannot read the compliance stream).

### 22.7 Dashboards (STEP 7)

`DashboardService.overview()` aggregates player metrics (total/active/suspended/excluded), deposits,
withdrawals (incl. the live pending queue), a risk-decision breakdown (holds/rejects/manual-reviews)
and the sync system status.

### 22.8 Reporting APIs (STEP 10)

`ReportingService` emits export-ready `{ columns, rows }` reports — player, operational, finance,
risk and compliance summaries — with a static `toCsv` serializer (RFC-4180-ish quoting). Pure reads.

### 22.9 System health (STEP 8)

`HealthService` reports per-component health: **ledger** (healthy iff `reconcile().balanced`),
**treasury** (healthy iff its summary reconciles), **compliance**/**payments** reachability and a
**runtime** frozen marker, plus pluggable async `HealthProbe`s (payment gateways, queues, cache) —
the future-monitoring integration point. A failing probe degrades (or downs) the overall status.

### 22.10 Operational security (STEP 9)

RBAC enforcement on every call; per-source audit permissions; cryptographically-random secure ids
(users/notes/correlation); masked directory fields (email); an authorization boundary
(`enforce`) that audits allow **and** deny. **Not implemented (by design):** CRM, bonus engine,
affiliate portal, and any Finance/Admin portal **UI** (this is the back-office **backend/API** layer).

## 23. CRM, loyalty & marketing platform (Phase 6B)

An enterprise player-engagement layer: `Player → CRM → Marketing → Operations APIs →
Platform Services`. It **consumes** existing services read-only (via a `PlayerInsightPort` sourced
from the Operations layer) and **never owns or moves money** — the bonus "wallet" is a LOGICAL
construct. **Zero platform change**: nothing under runtime, games, wallet, ledger, treasury,
payments, compliance, operations or settlement is modified. Module: `src/lib/crm/`
(framework-agnostic TS).

### 23.1 CRM architecture (STEP 1)

`CRMService` is the RBAC-enforced facade owning player profiles, tags, preferences, lifecycle and
communication history, composing seven engagement engines. Every public call carries an Operations
`AuthContext`, is permission-checked **before** work, and is audited (allow AND deny). PII is masked
on write (`maskContact`) — raw email/phone is never stored.

### 23.2 Player segmentation (STEP 2)

`SegmentationEngine` — a runtime registry of configurable `SegmentDefinition` predicates over a
read-only `PlayerSnapshot`: VIP, High Value, New Player, Dormant, Active, At Risk, Self-Excluded,
Responsible Gaming. Every threshold is a parameter (`defaultSegments(config)`); segments toggle/
replace at runtime.

### 23.3 Loyalty engine (STEP 3)

`LoyaltyEngine` — logical points + XP + levels with earn, redeem, manual adjustment, point + level
history, a reward catalog, tier progress and expiration hooks. Points are a **logical engagement
currency**, never ledger money.

### 23.4 VIP program (STEP 4)

`VipService` — configurable levels + benefits with automatic upgrade/downgrade driven by lifetime
loyalty points, manual promotion/demotion, and full VIP history. Benefits are descriptive; any
monetary effect is applied elsewhere (Operations/Treasury), never here.

### 23.5 Bonus engine (STEP 5)

`BonusEngine` — a **logical** bonus wallet: welcome / deposit / cashback / free-spins / loss / manual
bonuses with wagering requirements (× multiple per type), a validated status lifecycle (Pending →
Active → Wagering → Completed, plus Cancelled/Expired/Forfeited), expiration sweep and a full audit
trail. **No ledger changes** — amounts are logical units, never posted to the wallet; converting a
completed bonus to cash is a deferred Operations/Treasury concern.

### 23.6 Promotion engine (STEP 6)

`PromotionEngine` — campaigns (segment + schedule gated), coupon/promo codes (max + per-player
redemption limits), seasonal events, challenges + daily missions (progress + reset), leaderboard
hooks and eligibility rules. Rewards are applied through the CRM's own engines, never via money.

### 23.7 Notification framework (STEP 7)

`NotificationService` — template-driven multi-channel messaging (email/SMS/push/in-app) behind an
`INotificationProvider` abstraction, with `{{var}}` interpolation, per-player channel preferences
(opt-out ⇒ suppressed), immediate + scheduled delivery, and a communication-history log. Only mock
providers ship (`MockNotificationProvider`) — no real credentials.

### 23.8 Referral program (STEP 8)

`ReferralProgram` — stable referral codes + links, invites, signup attribution (self-referral +
double-attribution guarded), a depth-bounded referral tree, configurable reward rules, status
lifecycle (Invited → Signed → Qualified → Rewarded) and history, with future affiliate hooks. Reward
amounts are logical and granted via loyalty/bonus — never money.

### 23.9 Player timeline (STEP 9)

`CRMService.getTimeline` merges a unified, newest-first stream: Operations-sourced deposits/
withdrawals/support-notes/compliance-decisions (via `ops.players.timeline`) + bonuses + VIP changes
+ campaign redemptions + notifications.

### 23.10 Security (STEP 10)

Integrates with the Operations RBAC by reusing its `Role` + `AuthContext` (imported read-only —
Operations is unmodified) and layering `CrmPermission`s on top. Deny-by-default; `enforce()` audits
allow **and** deny; cryptographically-random secure ids; masked PII. **Not implemented (by design):**
affiliate portal, BI dashboards.

## 24. Partner, affiliate & multi-tenant platform (Phase 6C)

An enterprise growth/distribution layer: `Partners → Partner Platform → Operations APIs → CRM APIs →
Platform Services`. It manages business relationships, commissions, white-label brands and partner
reporting. It **owns no gameplay and no money** — commission is **LOGICAL accounting only**, never a
ledger posting. **Zero platform change**: nothing under runtime, games, wallet, ledger, treasury,
payments, compliance, operations, CRM or settlement is modified — purely additive, consuming existing
data through a read-only `PlayerFinancialPort`. Module: `src/lib/partners/` (framework-agnostic TS).

### 24.1 Partner platform architecture (STEP 1)

`PartnerPlatform` is the RBAC + tenant-isolation facade composing the sub-services (`PartnerService`,
`AffiliateService`, `AgentHierarchy`, `CommissionEngine`, `WhiteLabelPlatform`, `PartnerReporting`,
`PartnerDashboard`). `PartnerService` owns partner profiles, status (validated transitions), lifecycle,
notes and settings, with `PartnerAudit` on every action. PII is masked; ids are cryptographically
random.

### 24.2 Affiliate platform (STEP 2)

`AffiliateService` — affiliate profiles, tracking codes + links, campaign tracking, a click →
register → qualify conversion funnel, and **attribution models** (first-click keeps the first;
last-click overwrites). It records marketing attribution only — it grants nothing and moves no money.

### 24.3 Agent hierarchy (STEP 3)

`AgentHierarchy` — a Master-Agent → Sub-Agent → Dealer tree with validated links, configurable
**depth limits**, and **cycle detection** (a parent may not be a descendant of the child;
self/double-parenting rejected). Exposes ancestors (roll-up), descendants (downline) and tree build.

### 24.4 Commission engine (STEP 4)

`CommissionEngine` — computes commissions across **CPA / Revenue-Share / Hybrid / Fixed / Percentage /
Tiered** models (basis-point math, ascending tiers), records entries with a validated status
lifecycle (Pending → Approved → Paid, plus Rejected/Adjusted), supports **manual adjustments**, and
keeps a per-partner **logical balance + history**. **Logical accounting ONLY — no ledger postings, no
money movement.** Payout of an approved balance is a deferred Treasury/Operations concern.

### 24.5 White-label platform (STEP 5)

`WhiteLabelPlatform` — multi-tenant brand management: tenant + brand + **theme** (logo/colors/assets),
**domain mapping** (unique host → tenant), **localization** + **currency** configuration, and
per-tenant **feature flags**, with `resolveByHost` as the multi-tenant entry point. Pure configuration.

### 24.6 Partner reporting (STEP 6)

`PartnerReporting` — read-only **acquisition** (clicks/registrations/qualified/rate), **revenue**
(NGR/LTV/retention over attributed players), **commission summary**, and a **network roll-up** across
the downline, with export-ready `{columns, rows}` + a CSV serializer. Financial figures come from the
read-only `PlayerFinancialPort` (logical NGR = deposits − withdrawals) — nothing moves money.

### 24.7 Partner RBAC (STEP 7)

`PartnerRBAC` — five roles (Partner Owner, Partner Admin, Affiliate, Agent, Read-Only), scoped
permissions, permission groups, deny-by-default. **Tenant isolation** (`assertTenant`) is enforced on
every partner-scoped call so a principal can only touch its own tenant's resources.

### 24.8 API platform & dashboard (STEP 8 & 10)

`PartnerPlatform` exposes the partner/affiliate/white-label/reporting/export APIs; every call carries
a `PartnerAuthContext`, is permission + tenant checked **before** work, and is audited (allow AND
deny). `PartnerDashboard.overview` returns partner profile + acquisition + revenue + commission +
sub-partner count. Read-only financial summaries only — no financial execution.

### 24.9 Security (STEP 9)

RBAC enforcement + tenant isolation + audit on every action; cryptographically-random secure ids;
masked PII. **Not implemented (by design):** BI dashboards.

## 25. Analytics, BI & observability platform (Phase 6D)

The enterprise intelligence layer: `Platform Services → Analytics → BI → Observability → Dashboards`.
It **measures, aggregates and visualizes** existing platform activity and is strictly **read-only** —
it owns no gameplay, no money, and changes no business logic. **Zero platform change**: nothing under
runtime, games, wallet, ledger, treasury, payments, compliance, operations, CRM, partner or settlement
is modified — purely additive, consuming the frozen services through read-only ports. Module:
`src/lib/analytics/` (framework-agnostic TS).

### 25.1 Analytics platform architecture (STEP 1)

`AnalyticsService` ingests `AnalyticsEvent`s the app emits, updating a `MetricsRegistry`
(counter/gauge/histogram) and a `TimeSeriesStore` (bucketed points + `DimensionModel`), with an
`AggregationEngine` (sum/count/avg/min/max/distinct). `AnalyticsPlatform` is the RBAC-enforced facade
composing every analytics/BI/observability/monitoring/warehouse service.

### 25.2 Executive KPI platform (STEP 2)

`KPIEngine.compute` derives the executive set from the event stream + financial port: **revenue, NGR,
DAU, MAU, new players, retention, churn, LTV, ARPU, ARPPU, conversion, growth** — deterministic,
tenant-scopable, point-in-time.

### 25.3 Financial BI (STEP 3)

`FinancialBI` — deposit/withdrawal analytics, **payment success rate**, treasury figures (from the
read-only snapshot port), commission, **net cashflow** and a daily **cashflow trend**, with CSV
export. Read-only — the ledger/treasury remain the source of truth; every figure is derived.

### 25.4 Player analytics (STEP 4)

`PlayerAnalytics` — session analytics (start/end pairing), game popularity ranking, behaviour
(bets/deposits per active player), **retention cohorts** (day-N), and **funnels** (ordered
distinct-player conversion).

### 25.5 Fraud & compliance analytics (STEP 5)

`FraudComplianceAnalyticsService` — over the compliance decision stream: **risk distribution**,
decision/**fraud trends**, **AML/KYC control metrics**, compliance workload (manual-review queue),
and top reason codes. Consumes a read-only port — Compliance is not modified.

### 25.6 Observability platform (STEP 6)

`Observability` — distributed **tracing** (spans + traces by correlation id), a **request timeline**,
structured **logs** (with error-rate), **latency** percentiles (p50/p95/p99), and a service
**dependency graph** derived from parent→child span services. Records what the app hands it — it
never instruments a frozen service.

### 25.7 Monitoring & alerting (STEP 7)

`MonitoringService` — a **health dashboard** over the read-only health port (+ error rate, latency
p95, queue depth, cache hit-rate gauges), a configurable **alert-rule engine** (metric / comparator /
threshold / severity) that fires `Alert`s, and **channels** (email/slack/webhook/pagerduty) for
delivery.

### 25.8 Data platform / warehouse (STEP 8)

`WarehouseService` — point-in-time **snapshots**, historical **KPI trend** read models, **scheduled
reports**, typed **ETL contracts**, and CSV **warehouse export**. Everything is a read model over the
analytics/BI outputs.

### 25.9 Security & APIs (STEP 9 & 10)

`AnalyticsRBAC` — six roles (Executive, Analyst, Finance Analyst, Compliance Analyst, SRE, Read-Only),
scoped permissions, deny-by-default, **tenant-aware** analytics (a tenant-scoped principal only sees
its tenant's data), PII masking (`maskPlayerId`), secure-export gating, and an audit record on every
query (allow AND deny). The facade exposes the analytics / dashboard / reporting / metrics / health /
observability / export APIs — all read-only.

---

## Enterprise platform — final state

Phases 5A → 6D layered a complete enterprise real-money-gaming platform on the **permanently frozen**
Runtime + Ledger, each phase strictly additive and read-only toward the layers beneath it:

| Phase | Layer | Module | Owns money? |
|---|---|---|---|
| 5A | Double-entry ledger + wallet | `lib/ledger` | ✅ source of truth |
| 5B | Payment platform + gateways | `lib/payments` | via ledger |
| 5C | Withdrawals + treasury | `lib/treasury` | via ledger |
| 5D | Risk & compliance | `lib/compliance` | ❌ decides only |
| 6A | Operations & administration | `lib/operations` | ❌ read-only |
| 6B | CRM, loyalty & marketing | `lib/crm` | ❌ logical bonuses |
| 6C | Partner, affiliate & multi-tenant | `lib/partners` | ❌ logical commission |
| 6D | Analytics, BI & observability | `lib/analytics` | ❌ read-only |

Every phase kept the Runtime, Game Engines, Registry, providers, Settlement, Event Bus and Session
Manager untouched; money movement stays exclusively double-entry through the ledger.
