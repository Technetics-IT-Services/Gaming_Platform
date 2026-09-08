# Phase 2C.6 — Mobile UX (Crash · Plinko · Mines)

All three real-money surfaces are **mobile-first**, targeting `375×812`, `390×844`, and `412×915`.
The routes live under `app/(casino)/…` and inherit the casino layout (sticky bottom-nav compatible).

## Shared mobile principles

- **No horizontal overflow at 375 px.** Every board is `max-width: 460px; margin: 0 auto` with
  `box-sizing: border-box`. Wide content uses fluid CSS grid, not fixed widths:
  - Plinko slot row: `grid-template-columns: repeat(${table.length}, 1fr)` (font shrinks at >13 slots).
  - Mines grid: `repeat(${cols}, 1fr)` with `aspect-ratio: 1` tiles.
- **Sticky authoritative balance.** A `position: sticky; top: 0` header shows the live balance
  (`data-testid="balance"`), always the server value — never `prev − stake + payout`.
- **Large touch targets.** Primary actions (Drop / Start / Cash Out) are full-width, ~16–18 px
  padding; chips are ≥44 px; Mines tiles are square and finger-sized.
- **One-handed primary action.** The main CTA is a single full-width button at the bottom of the flow.
- **Actionable errors.** `normalizeError` maps 401/404/409/timeout/insufficient to short, human
  messages surfaced in an inline `data-testid="error"` row.
- **Safe-area / bottom-nav.** Bottom padding (`padding-bottom: 24px`) keeps the CTA clear of the nav;
  the scroll container is the page (`h-full overflow-auto`), the balance header stays pinned.

## Per-game

### Plinko (`/plinko-money`)
Sticky balance → result panel (big multiplier + winning bin, replay flag) → config-driven slot row
(highlights the landing bin) → rows selector → risk selector → stake chips + numeric input → large
**Drop** button. A fresh idempotency key per drop prevents duplicate submission on double-tap.

### Mines (`/mines-money`)
Sticky balance + potential cashout → (pre-round) mines-count selector + stake chips + **Start**;
(active) 5×5 tap grid with disabled/already-revealed states, current multiplier + potential payout,
prominent **Cash Out** (disabled until ≥1 reveal, guarded against double-tap); (settled) revealed
board with 💎/💣 + win/loss banner + **New Round**.

### Crash (`/crash-money`, from 2C.2)
Sticky balance → live display-only multiplier → **Bet / Cash Out** with optional auto-cashout. Balance
is synced from the authoritative settle response.

## Verification

- Production build (`next build`) compiles all three routes: `/plinko-money` (5.76 kB),
  `/mines-money` (6.1 kB), `/crash-money` — exit 0.
- `data-testid` hooks (`balance`, `drop`, `start`, `cashout`, `multiplier`, `tile-N`, `rows-N`,
  `risk-*`, `mines-N`, `new-round`, `error`) are in place for mobile E2E targeting.
- No demo-wallet import on any money path (asserted by the `*-money-api.test.ts` regression tests).
