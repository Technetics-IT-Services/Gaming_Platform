# Phase 2D.9 — Forensic Requirement Audit

Date: 2026-09-07 · Delivery deadline: 2026-09-10

This audit was performed **before** implementation, from the requirement IDs themselves rather than
from any previous headline number, exactly as the brief demanded.

---

## 1. The headline number in the matrix was wrong — twice

The brief quoted `GREEN 25 / AMBER 10 / RED 9 / BLOCKED 11` out of 54. Recounting from the actual
requirement rows in `FINAL_CLIENT_REQUIREMENT_MATRIX.md`:

| Section | IDs | Count |
|---|---|---|
| A. Player portal | P-01 … P-18 | 18 |
| B. Partner portal | PA-01 … PA-10 | 10 |
| C. Admin / super admin | AD-01 … AD-12 | 12 |
| D. Finance | F-01 … F-10 | 10 |
| E. Platform / cross-cutting | X-01 … X-08 | 8 |
| **TOTAL** | | **58** |

**Two errors were found and corrected:**

1. **Total was 54, actually 58.** The five sections enumerate 58 distinct IDs.
2. **GREEN was stated as 25, but the matrix's own GREEN list contains 28 IDs**
   (`P-01…P-12` = 12, `AD-01…AD-05` + `AD-09` + `AD-10` + `AD-11` = 8, `PA-01`/`PA-05`/`PA-09` = 3,
   `F-03`/`F-08` = 2, `X-01`/`X-06`/`X-07` = 3).

AMBER (10), RED (9) and BLOCKED (11) each matched their ID lists. `28 + 10 + 9 + 11 = 58` ✓ — the
corrected counts reconcile exactly with the enumeration, which the old numbers did not.

**Corrected pre-2D.9 baseline: TOTAL 58 · GREEN 28 · AMBER 10 · RED 9 · BLOCKED 11.**

Note: "KYC file upload" appears in the BLOCKED list but is a **sub-capability of P-12**, not a
requirement ID. It is counted inside P-12 (GREEN, with the upload sub-capability declared BLOCKED),
not as a 12th BLOCKED item.

---

## 2. Requirement source

Unchanged and re-verified this phase: **the client's own requirements document is not in this
repository.** The authoritative enumeration remains the transcription in `PHASE_2C16_AUDIT.md` §4,
which `PHASE_2C18_FULL_REQUIREMENT_AUDIT.md`, `PHASE_2C18_GAP_MATRIX.md` and the final matrix all
derive from. No requirement was invented, renamed, split or dropped in this phase.

---

## 3. Classification of every RED / AMBER / BLOCKED item

**A** = implement now · **B** = blocked on another local requirement · **C** = client business
decision required · **D** = external provider/credential required · **E** = dangerous without a
specification.

### 3.1 RED (9)

| ID | Requirement | Class | Dependency | Est. | Before 10 Sep? | Decision |
|---|---|---|---|---|---|---|
| **P-17** | Referral: link, attribution, qualifying deposit, reward, dashboard, earnings, history, leaderboard | **A** (split) | reward half is C | M | **Yes (partial)** | **IMPLEMENTED** — attribution, code, link, dashboard, history. Qualifying deposit / reward / earnings stay BLOCKED: no threshold, currency, window or reward amount is defined. Leaderboard **not** built — ranking by *what* is unspecified, and picking "by referral count" would be a silent reinterpretation. |
| **AD-08** | Promotions admin CRUD | **A** | — | M | **Yes** | **IMPLEMENTED** — full CRUD, validated status lifecycle, scheduling, redemption cap, player-visible active list. The requirement as written is CRUD; awarding is a separate, undefined concern and is declared blocked. |
| **X-02** | Analytics: DAU/MAU/retention/LTV/session/bounce | **A** (split) | LTV is C via F-02 | L | **Yes (partial)** | **IMPLEMENTED** — durable activity-event pipeline + DAU/MAU endpoint and console panel. Retention (no cohort definition = C), LTV (blocked by F-02), session time (no session events), bounce (no page views) remain declared unavailable. |
| **PA-07** | Partner reports | **A** (split) | financial half is C | S | **Yes (partial)** | **IMPLEMENTED** — the partner's own recorded activity report + CSV, ownership-isolated. Financial reports remain blocked on F-02. |
| **P-14** | Rewards: daily login, weekly, monthly, lucky spin, seasonal | **C** | reward amounts | M | No | Every one of these is a *reward amount* — the client has defined none. Building the scheduler without amounts produces a mechanism that can only award fabricated values. |
| **P-15** | VIP levels 1–5 + progression | **C** | tier thresholds | M | No | Thresholds are the requirement. Inventing "spend X to reach level 2" is inventing the client's commercial policy. |
| **P-16** | VIP periodic/birthday rewards, higher withdrawal limit | **C** | P-15 + amounts | M | No | Blocked twice over: needs P-15's thresholds and the reward amounts. |
| **P-18** | Referral wallet | **C** + **E** | P-17 rewards | S | No | A new wallet type touches the **frozen** wallet schema, and there is nothing to put in it until a reward amount exists. Not attempted. |
| **F-05** | Daily settlement / financial close | **C** | F-02 | L | No | A "close" requires knowing what is being closed. The factual daily aggregates (deposits, withdrawals, stakes, payouts, expenses per currency) already ship in 2D.7's reports; what is missing is the accounting semantics, which is a client decision. |

### 3.2 AMBER (10)

| ID | Missing part | Class | Decision this phase |
|---|---|---|---|
| P-13 | Gift-code redemption not exposed | A (small) | Not taken — out of the brief's named scope and P2; the reward services behind it are real. |
| PA-02 | Financial panels blocked | B → C | Unchanged; the portal now also carries the PA-07 report. |
| PA-08 | Profit notifications blocked | B → C | Unchanged. |
| AD-06 | The large-withdrawal threshold **value** | **C** | One number from the client. Cannot be invented — it is a compliance control. |
| AD-07 | Bonus administration surface | A | Not taken this phase (P2). `BonusWalletService` is real; only an admin surface is missing. |
| AD-12 | `admin_audit_logs` dormant by design | — | Settled in 2D.7 Part D; no further work is correct. |
| F-01 | No finance role/portal | A | Not taken (P1, but the *function* exists under admin). |
| F-06 | Cash-flow view | A | Derivable; 2D.7 reports cover it. |
| F-07 | Global transaction search | A | Not taken (P2). |
| X-08 | ~19k LOC orphaned frontend simulation | A | Not taken; deleting live-adjacent code days before delivery is the higher risk. Documented, not shipped. |

### 3.3 BLOCKED (11) — with what exactly is required

| ID | Blocked on | Kind |
|---|---|---|
| F-02 Revenue | **A definition of "revenue" for this platform** | Client decision |
| F-04 Profit | F-02 | Client decision |
| F-09 FX totals | An exchange-rate source | External provider |
| F-10 Bank settlement | Banking provider + credentials | External provider |
| X-03 Email delivery | SMTP credentials | External provider |
| X-04 SMS / push | Provider + credentials | External provider |
| X-05 Payment gateway | Provider + credentials | External provider |
| PA-03 Partner profit | F-02 | Client decision |
| PA-04 Partner balance | PA-03 | Client decision |
| PA-06 Partner withdrawal | PA-04 | Client decision |
| PA-10 Daily profit distribution | PA-03 + F-03 + F-05 | Client decision |

None of these was faked. No stub provider returns a success it did not receive.

---

## 4. What this phase implemented, in dependency order

The brief's own P0 → P1 → P2 rule with dependency ordering gives:

1. **X-02 event pipeline** — first, because DAU/MAU depends on it and nothing depends on DAU/MAU.
2. **P-17 referral attribution** (P1) — independent.
3. **AD-08 promotions CRUD** (P2 by the matrix, but unblocked and named in the brief).
4. **X-02 DAU/MAU surface** — after the pipeline exists.
5. **PA-07 partner report** — after PA-01 (already GREEN).

No P1 item was started ahead of an unfinished P0 dependency: the remaining P0 item (AD-06) is
blocked on a client-supplied number, not on engineering.

---

## 5. Frozen surfaces

Nothing frozen was modified. The one place where this needed care: the `GAME_PLAY` activity event is
emitted **in `game-money.controller.ts`, after the bridge returns** — never inside
`GameMoneyBridge`, the wallet engine, the ledger, settlement, a game engine, the runtime or the
registry. No `FROZEN_CHANGE_PROPOSAL` was required, because no frozen change was necessary.

No Prisma schema change was made in this phase either: referral uses the existing
`User.referralCode` + `ReferralHistory` (whose `referredId` is already UNIQUE), promotions use the
existing `Promotion` model, and the event pipeline writes the existing `UserActivity` table.
