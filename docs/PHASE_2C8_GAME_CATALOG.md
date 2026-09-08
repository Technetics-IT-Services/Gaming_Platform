# Phase 2C.8 — Canonical Game Catalog

An additive, server-authoritative catalog of the **15 production real-money games**, plus a client
presentation layer. It is **discovery metadata only** — it never decides whether money moves (the
per-game `config`/`play` endpoints remain the authority) and contains **no payout/RTP mathematics**.

## Server catalog (authoritative) — `GET /catalog`

- `apps/backend/src/modules/gaming-money/catalog.service.ts` + `catalog.controller.ts` (registered in
  `gaming-money.module.ts`). A **distinct `/catalog` path** (not `/games/*`) so it never collides with
  the money `games/<game>/*` routes or the generic `games/:slug` catalog.
- Authenticated (inherits the app JWT guard — `401` when unauthenticated, verified live).
- Returns per game: `key, name, shortDescription, category, tags, route, realMoney, multiplayer,
  engineKey, bridgeType, currencies, popularity, isNew, featured, responsibleGamingEligible, sortOrder,
  enabled, maintenance, limits{min,max}`. Plus `{ categories, currencies }`.
- **Server-authoritative availability:** `enabled`/`maintenance` are server-controlled via
  `CATALOG_DISABLED_GAMES` (comma list). The client cannot flip them; a disabled game is reported
  `enabled:false, maintenance:true` and the lobby refuses to launch it. Play-time validation is the
  ultimate guard regardless. (Verified live: booting with `CATALOG_DISABLED_GAMES=wheel` → wheel
  disabled, dice enabled.)
- **Live limits:** resolved from the same variant services the config endpoints use
  (`DiceVariantService`, `CrashVariantService`, `RouletteVariantService`, `CardVariantService`,
  `LotteryDrawService.config.ticketPrice`), with a safe constant fallback; instant/plinko/mines use the
  bridge constant `{1,10000}`. (Verified live: e.g. blackjack/dragon-tiger `1–100000` from card
  presets, lottery `10–10` = ticket price, dice/plinko `1–10000`.)
- **Safe metadata only:** no seeds, secrets, wallet ids, ledger internals, or private operator config
  (asserted in unit test + verified live — zero secret strings in the payload).

## Client catalog (presentation) — `apps/frontend/src/lib/games/`

- `catalog.ts` — the strongly-typed `GameDefinition` (key, slug, name, shortDescription, category,
  subcategory, icon, route, status, realMoney, multiplayer, popularity, difficulty, mobileOptimized,
  minStake, maxStake, supportedCurrencies, tags, featured, isNew, responsibleGamingEligible, engineKey,
  bridgeType, sortOrder). `getCatalog()` fetches the server catalog and merges client presentation
  (icons, difficulty); on error it falls back to the static `CANONICAL_GAMES` (15 games) so the lobby
  still renders. `toDefinition()` maps a server row → definition (enabled→`live`, limits→min/maxStake).
- `filter.ts` — pure, testable filtering: `LOBBY_FILTERS` (All/Popular/Instant/Table/Card/India/New),
  `matchesFilter`, `matchesSearch`, `filterGames`, `featuredGames`.

## The 15 games (all real-money, all route to a `-money` page)

| Game | key | route | category | bridge |
|------|-----|-------|----------|--------|
| Dice | dice | /dice-money | dice | dice |
| Crash | crash | /crash-money | crash | crash |
| Roulette | roulette | /roulette-money | table | roulette |
| Sic Bo | sic-bo | /sic-bo-money | dice | dice |
| Number Lottery | lottery | /lottery-money | instant | lottery |
| Baccarat | baccarat | /baccarat-money | card | card |
| Blackjack | blackjack | /blackjack-money | card | card |
| Plinko | plinko | /plinko-money | instant | plinko |
| Mines | mines | /mines-money | instant | mines |
| Limbo | limbo | /limbo-money | instant | instant |
| Coin Flip | coin-flip | /coin-flip-money | instant | instant |
| Wheel | wheel | /wheel-money | instant | instant |
| Dragon Tiger | dragon-tiger | /dragon-tiger-money | card (india) | card |
| Andar Bahar | andar-bahar | /andar-bahar-money | card (india) | card |
| Teen Patti | teen-patti | /teen-patti-money | card (india) | card |

Demo/fictional games (`demo-games.ts`, `prototype-games.ts`) are **excluded** — the catalog never
advertises a demo game as real-money.

## Tests
- Backend `catalog.service.spec.ts` (6): exactly 15 games, no dup keys/routes, all real-money + `-money`
  routes, server-disable honored, safe-metadata (no secrets), findByKey.
- Frontend `catalog.test.ts` (14): canonical integrity, no dups, `-money` routes, india tags, no demo
  titles, `toDefinition` mapping, `getCatalog` server-authority + fallback, filtering primitives, and
  **no demo-wallet dependency**.
- Live HTTP: 15 games, server-disable, live limits, no secrets, `/catalog/:key` + 404.
