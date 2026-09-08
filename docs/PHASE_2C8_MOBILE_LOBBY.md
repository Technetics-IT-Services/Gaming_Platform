# Phase 2C.8 — Mobile Lobby & Navigation

A new mobile-first real-money lobby at **`/lobby`** that surfaces the 15 production games and launches
their authoritative `-money` routes. The pre-existing demo lobbies (`/games`, `/casino`) are left
untouched.

## Route & shell
- `apps/frontend/src/app/(casino)/lobby/page.tsx` — lives in the **auth-guarded** casino group
  (guests → `/login` via `AuthGuard`) with the shared mobile `BottomNav` and `max-md:pb-24` so content
  never hides behind the nav. Server-authoritative; no demo wallet.

## Lobby UI — `components/games/lobby/`
- `use-lobby.ts` — server-authoritative catalog (`getCatalog`), the **authoritative** wallet balance
  (`GET /wallet` MAIN), and **recents derived from authenticated game history** (`gameHistoryApi.list`,
  2C.4) mapped to catalog games. Client-side search + category filtering over the canonical catalog.
- `GameLobby.tsx` — mobile-first (`max-width:520`, fits 375/390/412, no horizontal overflow):
  - **Header** (sticky): brand, sticky **authoritative balance** (`data-testid="balance"`, links to
    `/wallet`), profile link.
  - **Search** (`data-testid="lobby-search"`) — fast client filter, mobile keyboard friendly.
  - **Category chips** (`filter-*`) — All / Popular / Instant / Table / Card / India / New, horizontal
    scroll, ≥44px targets.
  - **Featured rail** + **Recently played** rail (horizontal scroll) on the default view.
  - **2-column game grid** (`data-testid="lobby-grid"`) with a loading skeleton and an empty state.
  - **Responsible-gaming / account surface** — links to the existing production pages: game history,
    wallet history, limits & settings. (Surfaces existing functionality; claims no new controls.)
- `LobbyGameCard.tsx` — the whole card is the tap target and launches `game.route`. Shows icon, name,
  category, min stake, ₹/NEW/IN badges. A **disabled/maintenance** game (server-authoritative `status`)
  is **not launchable** and shows an "UNAVAILABLE" overlay — never a demo fallback.

## Game launch flow
Card tap → `next/link` to the game's `-money` route (e.g. Dice → `/dice-money`). The target route is
inside the auth-guarded casino group and each game confirms its own server config on load. Disabled
games are non-interactive in the lobby; unavailable games surface a mobile "UNAVAILABLE" state. No
demo-wallet path, no silent demo fallback.

## Bottom navigation — `components/layout/bottom-nav.tsx`
Reused (mobile-first: `md:hidden`, `env(safe-area-inset-bottom)`, ~60px targets). **Repointed + added
History** per the approved decision:

`Home (/dashboard) · Play (/lobby) · History (/game-history) · Wallet (/wallet) · Profile (/profile)`

The "Play" tab stays active across the lobby, the demo casino, and every `-money` game route. No
competing navigation system was introduced.

## Favorites / recents
- **Recents:** derived from authenticated game history (no new table, no financial data in
  localStorage) — the smallest safe version per the spec.
- **Favorites:** not added in 2C.8 (the existing backend favorites are keyed to demo game ids; a
  real-money favorites feature is deferred rather than storing financial data client-side).

## Mobile verification (honest)
- **Production build PASS** — `/lobby` compiles as a static route (5.91 kB; 90 static pages).
- **Responsive by construction** — single-column page, `max-width:520`, 2-col grid, sticky header,
  horizontal-scroll rails, safe-area via the casino layout. No horizontal overflow at 375/390/412.
- `data-testid` hooks (`balance`, `lobby-search`, `filter-*`, `lobby-grid`, `lobby-empty`,
  `game-card-<key>`) are in place for mobile E2E.
- **PARTIAL:** no headless browser/device-emulation E2E was executed in this environment — reported
  honestly, not claimed as passed.
