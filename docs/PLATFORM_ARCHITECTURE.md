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
