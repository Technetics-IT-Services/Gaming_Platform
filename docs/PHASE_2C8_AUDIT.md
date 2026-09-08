# Phase 2C.8 — Pre-Implementation Audit (Game Catalog + Mobile Lobby + Discovery)

**Step 0 deliverable — audit only. No implementation code written.** This audit maps the existing
catalog/lobby/navigation/discovery surfaces against the Phase 2C.8 requirements, distinguishes
demo-only from production-wired, and produces a precise additive plan. It does **not** duplicate
existing functionality or touch frozen surfaces.

---

## 0. Headline finding (the gap 2C.8 must close)

The platform has **15 production real-money games** (each with its own server-authoritative
`GET /games/<game>/config` + `POST …/play` and a `*-money` route), **but no lobby surfaces them**:

- The existing lobbies (`/games`, `/casino`) render a **fictional demo catalog** (`lib/demo-games.ts`
  — "Neon Rush", "Golden Pharaoh", "Teen Patti Gold", …) that maps to demo routes
  `/games/[slug]` → `/play/[slug]`, **not** to the real-money `-money` routes.
- The **15 `*-money` routes are orphaned** — nothing in any lobby or nav links to them.
- The backend generic catalog (`GamesService`) top-level methods **throw
  `NotImplementedException('Game catalog is pending the platform data model')`**; the richer
  `controllers/games.controller.ts` (CatalogService/repository) is a **generic provider/RTP catalog**
  not populated with the real-money games.

**Conclusion:** no existing catalog satisfies the requirement. The STOP condition "existing production
catalog already fully satisfies" does **NOT** apply. 2C.8 must add a **canonical real-money catalog +
mobile lobby that routes to the `-money` pages**, additively.

---

## 1. Real-money games (production-wired — the source of truth)

Server-authoritative money endpoints in `apps/backend/.../gaming-money/game-money.controller.ts`, each
with a `*-money` frontend route:

| # | Game | Config endpoint | Play route(s) | Frontend route | Bridge |
|---|------|-----------------|---------------|----------------|--------|
| 1 | Dice | `GET games/dice/config` | `POST games/dice/play` | `/dice-money` | dice |
| 2 | Crash | `games/crash/config,state` | `crash/play,cashout` | `/crash-money` | crash (interactive) |
| 3 | Roulette | `games/roulette/config` | `roulette/play` | `/roulette-money` | roulette |
| 4 | Sic Bo | `games/sic-bo/config` | `sic-bo/play` | `/sic-bo-money` | dice(var) |
| 5 | Number Lottery | `games/lottery/config,draw,tickets` | `lottery/buy` | `/lottery-money` | lottery |
| 6 | Baccarat | `games/baccarat/config` | `baccarat/play` | `/baccarat-money` | card |
| 7 | Blackjack | `games/blackjack/config` | `blackjack/start,:id/action` | `/blackjack-money` | card (interactive) |
| 8 | Plinko | `games/plinko/config` | `plinko/play` | `/plinko-money` | plinko |
| 9 | Mines | `games/mines/config` | `mines/start,:id/reveal,:id/cashout` | `/mines-money` | mines (interactive) |
| 10 | Limbo | `games/limbo/config` | `limbo/play` | `/limbo-money` | instant |
| 11 | Coin Flip | `games/coin-flip/config` | `coin-flip/play` | `/coin-flip-money` | instant |
| 12 | Wheel | `games/wheel/config` | `wheel/play` | `/wheel-money` | instant |
| 13 | Dragon Tiger | `games/dragon-tiger/config` | `dragon-tiger/play` | `/dragon-tiger-money` | card |
| 14 | Andar Bahar | `games/andar-bahar/config` | `andar-bahar/play` | `/andar-bahar-money` | card |
| 15 | Teen Patti | `games/teen-patti/config` | `teen-patti/play` | `/teen-patti-money` | card |

Each `config` endpoint is **server-authoritative** (limits, enabled, payouts). These are the availability
signals to reuse — **no new availability model is required**.

---

## 2. Existing surfaces (what exists · reusable · demo-only · production)

| Surface | File(s) | State | Verdict |
|---------|---------|-------|---------|
| **Bottom nav** | `components/layout/bottom-nav.tsx` | Mobile-first (`md:hidden`, `env(safe-area-inset-bottom)`, ~60px targets), items Home/Casino/Games/Sports/Wallet/Profile | **REUSE** (extend "Casino" → real-money lobby; consider History) |
| Mobile nav | `components/layout/mobile-nav.tsx`, `mobile-drawer.tsx` | drawer/top nav | REUSE (no change) |
| **Demo lobby `/games`** | `app/(dashboard)/games/page.tsx` + `games-discovery.tsx`, `library-rows.tsx` | Reads `gamesApi.list()` (backend stub / demo mode) — **fictional games** | **DEMO-ONLY** — do not advertise as real-money |
| **Demo lobby `/casino`** | `app/(casino)/casino/page.tsx` + `game-shelf.tsx` | Reads `demo-games.ts`, "no backend dependency", launches `/play/[slug]` | **DEMO-ONLY** |
| Catalog client | `lib/games-api.ts` | Calls `/games`, `/games/featured|trending|popular|recommended`, `/games/:slug`, favorites | Backed by generic module; **not real-money aware** |
| Backend catalog | `modules/games/*` (CatalogService, repository, admin CRUD, FavoritesService, recently-played) | Generic provider/RTP catalog; top-level `games.service.ts` throws `NotImplemented` | **NOT real-money aware**; do not couple |
| Game cards | `game-card.tsx`, `game-cover.tsx`, `game-grid.tsx`, `featured-carousel.tsx`, `game-card-skeleton.tsx` | Built for demo `GameSummary` shape | Partially reusable (styling patterns) |
| Favorites | `hooks/use-favorites.ts` → `gamesApi.favoriteIds/toggleFavorite`; `/favorites` route | Backend-backed but keyed to demo game ids | Not directly usable for `-money` keys |
| Recently played | `modules/games/services/recently-played.service.ts` | Backend service exists (demo catalog) | Prefer **game-history-derived recents** for real money |
| Game history | `app/(dashboard)/game-history`, `wallet/history`; `game-history-api.ts` (2C.4) | Production, authoritative | **REUSE** (recents + responsible-gaming surface) |
| Wallet balance | `wallet-api.ts`, `auth-store` | Authoritative | **REUSE** (sticky balance) |
| Feature flags | `runtime/feature-flags.ts`, `lib/tenancy/feature-flags.ts`, `control-plane/feature-flag-service.ts` | Present (Phase 3.1/3.2 tenancy) | **COMPAT** — gate visibility, not a hard dependency |
| Compliance | `lib/compliance/policy-engine.ts`, `types.ts` | Client policy engine; backend enforcement unverified | Surface access only; **do not claim enforcement** |
| Demo mode | `lib/config.ts` `clientConfig.demoMode` | `true` in dev / `NEXT_PUBLIC_DEMO_MODE`; off in prod build | Real-money lobby must be **demo-independent** |
| Types | `packages/types/src/game.ts` (`GameSummary`, `GameDetail`, …) | Demo/provider-shaped | Do **not** overload; define an additive `GameDefinition` |

---

## 3. Requirement-by-requirement status

| 2C.8 step | Exists? | Verdict |
|-----------|---------|---------|
| Canonical real-money catalog | ❌ (only demo `demo-games.ts`) | **BUILD** (additive frontend `lib/games/catalog.ts`) |
| Accurate real-money vs demo flags | ❌ | **BUILD** (15 games, realMoney=true, routed to `-money`) |
| Server-authoritative availability | ⚠ per-game `config` endpoints exist; no unified catalog | **REUSE per-game config**; optional thin additive `GET /catalog` (no DB) |
| Mobile lobby routing to `-money` | ❌ (lobbies are demo) | **BUILD** (new real-money lobby; reuse card/grid styling) |
| Bottom nav | ✅ mobile-first | **REUSE** (+ optional History; point a tab at the lobby) |
| Game launch flow → correct `-money` route | ❌ | **BUILD** (catalog.route + availability guard) |
| Search / filter | ⚠ demo discovery exists | **BUILD** thin client filter over canonical catalog |
| Favorites / recent | ⚠ demo favorites; game-history exists | **REUSE game-history for recents**; local-only favorites (presentation) |
| Responsible gaming | ⚠ surfaces (history/settings/logout) exist; enforcement unverified | **SURFACE existing**; do not claim new controls |
| Feature flags / tenancy | ✅ platforms exist | **COMPAT** (soft gate), not hard dependency |

---

## 4. Frozen surfaces (must NOT touch)

GameRuntime, runtime contracts, registry, session manager, event bus, wallet-core,
`WalletEngineService`, ledger, treasury, settlement, payment/compliance core, existing game engines,
recovery core, auth backend, financial Prisma models, `ProvablyFairService`, `game-money-bridge`
financial semantics. The catalog is **presentation/discovery metadata only** — it never decides whether
money moves (the server `config`/`play` endpoints remain authoritative).

---

## 5. Recommended implementation plan (additive, mobile-first)

1. **Canonical catalog** — `apps/frontend/src/lib/games/catalog.ts`: strongly-typed `GameDefinition`
   (key, slug, name, shortDescription, category, subcategory, icon, route, status, realMoney,
   multiplayer, popularity, difficulty, mobileOptimized, tags, featured, new,
   responsibleGamingEligible, engineKey, bridgeType, sortOrder). 15 real-money entries → `-money`
   routes. **No payout/RTP math** in the catalog. Availability = presentation default; the server
   `config` endpoint remains the authority.
2. **Server availability (thin, additive, no DB)** — a new `@Controller('catalog')` → `GET /catalog`
   composing the 15 games' safe metadata + `enabled` + `limits` from the existing per-game config
   (server-authoritative, no seeds/secrets). Distinct path avoids the `games/:slug` collision. *(If the
   team prefers zero new endpoints, the lobby can call the per-game `config` endpoints directly — both
   are server-authoritative; decision flagged for approval.)*
3. **Mobile lobby** — a new real-money lobby (proposed route `/games` upgraded, or a new `/lobby`):
   header (brand + sticky authoritative balance + profile), search, category chips (All/Popular/Instant/
   Table/Card/India/New), featured rail, 2-col game grid → each card launches its `-money` route.
   Demo-independent; reuse existing card/grid/skeleton styling.
4. **Launch guard** — before navigating: authenticated (existing auth-guard), game `enabled` + currency
   supported (from `config`); else a mobile "Currently unavailable" state. Never fall back to demo.
5. **Bottom nav** — reuse; point a tab (Casino→"Play"/Games) at the real-money lobby; optionally add
   History. No competing nav system.
6. **Search/filter/recents** — client-side filter over the canonical catalog; recents derived from
   authenticated **game-history** (2C.4); favorites local-only (presentation preference), never storing
   financial data.
7. **Tests** — catalog integrity (15 present, no dup keys/routes, realMoney flags correct, demo not
   marked production, each route resolves), availability (disabled/unknown rejected, safe metadata),
   filtering, no-demo-wallet, mobile layout (375/390/412), auth redirect.
8. **Verification** — reuse the disposable `gp_phase1` DB; live HTTP for availability + a few launches;
   production build; frozen/secret/demo-wallet audits; honest mobile verification (build + layout +
   `data-testid`, no browser E2E claim).

**Rough scope:** ~1 canonical catalog module + 1 thin controller + 1 lobby route/components + nav tweak
+ tests + 3 docs. All additive; zero frozen changes; no schema change.

---

## 6. Open decisions for approval (before implementation)

1. **Lobby route:** upgrade the existing `/games` (replaces the demo library shown there) **or** add a
   new `/lobby` and leave the demo pages untouched? (Recommend: new canonical lobby, leave demo pages
   as-is to avoid disturbing demo-mode marketing.)
2. **Server availability:** add the thin additive `GET /catalog` endpoint, **or** have the lobby read
   the existing per-game `config` endpoints directly (both server-authoritative; the endpoint is just a
   convenience aggregate)?
3. **Bottom nav:** repoint an existing tab to the real-money lobby, or add a dedicated tab (and/or a
   History tab)?

---

## 7. STOP — awaiting approval

Per Step 0, this is the audit only. **No implementation has begun.** The existing catalog does **not**
satisfy the requirement (it is demo/fictional; real-money games are orphaned), so work should proceed —
but the three decisions above change the shape of the build. Awaiting approval before writing code.
