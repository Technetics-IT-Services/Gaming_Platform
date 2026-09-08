# Phase 2C.10 — Mobile Player Account UX

Mobile-first account center and supporting screens, in the auth-guarded `(dashboard)` shell (bottom nav
+ safe-area). Fits 375/390/412 with no horizontal overflow. All data is server-authoritative; no demo.

## Screens

- **`/profile`** (account center, replaces the demo page):
  - Identity header (initial avatar, display name, email, status dot) from `authApi.me` (auth store).
  - Authoritative **wallet snapshot** (`getMainWallet`) + Deposit / Withdraw / Transactions quick actions.
  - Grouped compact rows (≥56px touch targets): Personal details · Verification · Security ·
    Game history · Wallet history · Responsible gaming · Help & support · Notifications · **Log out** ·
    **Log out all devices**.
  - `data-testid`: `account-name`, `balance`, `row-verification`, `row-security`, `row-rg`,
    `row-support`, `row-logout`, `row-logout-all`.
- **`/verification`** — email / phone / identity cards with honest badges (Verified / Pending /
  Not verified / Unavailable). `data-testid`: `ver-email`, `ver-phone`, `ver-identity`.
- **`/responsible-gaming`** — self-monitoring links + real cashier limits + honest "not available"
  section. `data-testid`: `rg-limits`, `rg-unavailable`.
- **`/support`** — FAQ (`<details>` accordions) + configured contact (or a truthful "not configured"
  note). `data-testid`: `faq-N`, `support-email`/`support-phone`/`support-none`.
- **Security & sessions** reuse the existing production `/settings/security` (change password, 2FA,
  sessions, devices) — linked from the account center.

## Navigation

The bottom-nav **Profile** tab (`Home · Play · History · Wallet · Profile`) opens the new account
center; from there every account/security/RG/support/verification/wallet/history surface is one tap
away. No new/competing navigation.

## Session restoration (Phase 2C.5 preserved)

Direct navigation to `/profile`, `/verification`, `/responsible-gaming`, `/support` is guarded by the
existing `AuthGuard` + single-flight refresh; an authenticated reload restores the session without a
login flash. Logout uses the existing `logoutSession` teardown; logout-all calls `authApi.logoutAll`
then tears down locally and redirects to `/login`.

## Mobile verification (honest)

- **Production build PASS** — `/profile` (6.16 kB), `/verification` (3.2 kB), `/responsible-gaming`
  (4.2 kB), `/support` (2.58 kB) compile as static routes (93 pages).
- **Responsive by construction** — `max-width:480`, single column, compact rows, `<details>` FAQ, no
  desktop tables, no horizontal overflow at 375/390/412; safe-area via the dashboard shell.
- `data-testid` hooks present for mobile E2E.
- **PARTIAL:** no headless browser/device-emulation E2E run in this environment — reported honestly.
