# Phase 2C.9 — Mobile Wallet & Cashier UX

Mobile-first, server-authoritative deposit/withdraw flows that **replace the former demo-wallet pages**.
Fits 375/390/412 with no horizontal overflow; all money comes from the server.

## Surfaces

- **`/deposit`** and **`/withdraw`** (`app/(dashboard)/…`, auth-guarded, bottom-nav shell) — both render
  the shared `CashierForm` (`components/wallet/cashier/CashierForm.tsx`) with `kind="deposit"` /
  `"withdrawal"`. The old desktop two-column demo-wallet pages are gone.
- **`/transactions`** — rewritten to the **server-authoritative** wallet history (`walletApi.history`,
  Phase 2C.4): stored `balanceBefore/After`, type/status filters, mobile cards. No demo store.
- **`/wallet`** — unchanged authoritative balance page (kept; its balance already came from
  `walletApi.balances`).

## CashierForm (mobile-first)

- **Sticky authoritative balance** (`data-testid="balance"`) — always the server value, refetched after
  every action; never computed locally.
- Quick-amount chips + a large numeric amount input (`data-testid="amount"`), min/max hint from
  `GET /cashier/config`.
- One-hand primary CTA (`data-testid="submit"`); disabled until the amount is valid (and ≤ balance for
  withdrawals).
- **Honest state copy:** deposit → "reviewed and confirmed by an operator … no card is charged here";
  withdrawal → "funds placed on hold immediately … cancel to get them back".
- Inline error (`data-testid="error"`) and notice (`data-testid="notice"`) states.
- **Recent requests** list with status badges; a still-pending withdrawal shows a **Cancel** button
  (`data-testid="cancel-<id>"`) that refunds the hold.

## `use-cashier` hook

react-query for config + authoritative balance + own deposit/withdrawal lists; deposit/withdraw/cancel
mutations that, on success, **invalidate** the wallet + list queries (and the shared `wallet-balances`
/ `lobby.wallet` caches) so every balance display stays server-authoritative after a money action.

## Flow

`Login → Lobby → Wallet → Deposit/Withdraw → (server-authoritative balance) → Play`. Deposits appear as
PENDING until an operator completes them (balance updates on completion); withdrawals immediately reduce
the available balance (held) and refund on cancel/reject. No demo-wallet path anywhere on these
surfaces.

## Mobile verification (honest)

- **Production build PASS** — `/deposit` (302 B), `/withdraw` (305 B), `/transactions` (2.33 kB)
  compile as static routes (90 pages).
- **Responsive by construction** — `max-width:460`, single column, sticky balance, wrap-flex chips,
  horizontal-scroll filter row, no desktop tables. No horizontal overflow at 375/390/412.
- `data-testid` hooks in place for mobile E2E.
- **PARTIAL:** no headless browser/device-emulation E2E run in this environment — reported honestly, not
  claimed as passed.
