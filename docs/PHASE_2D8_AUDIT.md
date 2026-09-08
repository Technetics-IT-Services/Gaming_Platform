# Phase 2D.8 — Audit (before code)

> **Naming note.** This brief asked for `PHASE_2D4_*` documents, but those already exist and hold the
> genuine Phase 2D.4 partner-principal evidence. Overwriting them would destroy that record, so this
> phase's documents use the next free number, `2D8`.

## 0. A correction to my own matrix

The RED row read **"8"** while listing **10** IDs (P-14, P-15, P-16, P-17, P-18, PA-07, AD-08, AD-09,
F-05, X-02). **Corrected to 10.** The true baseline is therefore:

**GREEN 24 · AMBER 10 · RED 10 · BLOCKED 11.**

## 1. Classification of every RED requirement

| ID | Requirement | BE | FE | DB | Real source data | Class | Recommend now? |
|---|---|---|---|---|---|---|---|
| **AD-09** | Settings CRUD | ✗ | ✗ | `SystemSetting` exists, **0 usages, 0 rows** | n/a | **A — IMPLEMENT NOW** | **YES** |
| **P-17** | Referral (8 sub-parts) | ✗ | ✗ | `User.referralCode` live; `ReferralHistory` exists, 0 usages | code exists | **A (attribution) / C (reward)** | **YES — attribution only** |
| **AD-08** | Promotions admin | ✗ | ✗ | `Promotion`/`Coupon` exist, 0 usages | n/a | **A (CRUD) / C (awarding)** | If budget remains |
| **P-18** | Referral wallet | ✗ | ✗ | no `REFERRAL` wallet type | — | **B** — after P-17 reward, itself blocked | No |
| **P-14** | Reward sub-features (daily/spin/seasonal) | ✗ | demo | partial | — | **C** — reward values undefined | No |
| **P-15/P-16** | VIP tiers + tier rewards | ✗ | static | `LoyaltyTier` unused | — | **C** — tier thresholds and reward values undefined | No |
| **PA-07** | Partner reports | ✗ | ✗ | — | — | **B** — depends on partner financials (BLOCKED) | No |
| **F-05** | Daily settlement | ✗ | ✗ | — | — | **C** — "settlement" of *what* requires the revenue definition | No |
| **X-02** | DAU/MAU event pipeline | ✗ | ✗ | `page_views` etc. exist, **never written** | — | **A**, but L-effort | No — too large for the remaining window |

### 1.1 Why P-14/P-15/P-16 are C, not A

Implementing them requires inventing: VIP tier thresholds, per-tier reward values, daily-login reward
amounts, spin prize tables. Every one of those is a **client business decision**. Building the
mechanism with invented numbers would put fabricated money-adjacent values in front of players.

### 1.2 Why F-05 is C

"Daily settlement" settles a figure. That figure is net profit, which needs revenue. Settling
*nothing* would be a scheduler with no subject.

## 2. AD-09 — the safety design

`ApplicationSetting` is confirmed in use by **money-affecting** scopes: `card-variant`,
`crash-variant`, `dice-variant`, `roulette-variant`, plus `alert-rule`, `mission`, `season`,
`tournament`. **It is not exposed by this phase, at all.**

Settings are built over **`SystemSetting`** (0 usages, 0 rows) behind a **hard-coded whitelist
registry**. A key absent from the registry cannot be read or written through the API — the registry
is the allow-list, not a filter applied afterwards.

**Explicitly prohibited from the registry**, each for a stated reason:

| Excluded | Reason |
|---|---|
| wallet / payout / financial limits | money-affecting |
| game odds, variant configuration, engine config | money-affecting; lives in `ApplicationSetting` |
| settlement logic | money-affecting |
| `RG_LIMIT_INCREASE_DELAY_HOURS` | **responsible-gaming enforcement** — a compliance control |
| `SESSION_IDLE_TIMEOUT_MINUTES` | **security control** |
| `CASHIER_LARGE_WITHDRAWAL_THRESHOLD` | money-affecting **and** an unanswered client decision (AD-06) |

## 3. P-17 — the honest split

| Sub-part | Status |
|---|---|
| referral code generation | **already exists** (`User.referralCode` at signup) |
| referral identity / relationship / attribution | **IMPLEMENTABLE** |
| duplicate prevention, self-referral prevention, ownership isolation | **IMPLEMENTABLE** |
| player visibility (my referrals) · admin visibility | **IMPLEMENTABLE** |
| **qualification** ("qualifying deposit") | **BLOCKED** — no threshold amount, currency or window is defined anywhere |
| **reward** (amount, currency, wallet crediting) | **BLOCKED** — no amount defined; crediting would fabricate money |

## 4. Frozen surfaces

Nothing in scope requires touching `WalletEngine`, wallet-core, ledger, settlement,
`GameMoneyBridge`, game engines, provably-fair or runtime. Settings write to `SystemSetting`;
referral attribution writes a relationship row. **No `FROZEN_CHANGE_PROPOSAL` needed.**

## 5. This phase will implement

1. **AD-09 settings** — whitelisted registry, admin CRUD, public read, real consumer (support page), audited.
2. **P-17 referral attribution** — relationship, isolation, duplicate/self-referral prevention, player + admin visibility. Qualification/reward stay BLOCKED and are labelled.

Deliberately not started: AD-08 (if budget runs out it would be a partial slice), X-02 (too large),
and everything in class C.
