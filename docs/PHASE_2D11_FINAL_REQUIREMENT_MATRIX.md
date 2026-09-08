# Phase 2D.11 — Final Requirement Matrix

**Recomputed from the requirement IDs on 2026-09-07, after the security fix.**

## Count reconciliation

| Section | IDs | Count |
|---|---|---|
| A. Player portal | P-01 … P-18 | 18 |
| B. Partner portal | PA-01 … PA-10 | 10 |
| C. Admin / super admin | AD-01 … AD-12 | 12 |
| D. Finance | F-01 … F-10 | 10 |
| E. Platform / cross-cutting | X-01 … X-08 | 8 |
| **TOTAL** | | **58** |

| Status | Count |
|---|---|
| **GREEN** | **38** |
| **AMBER** | **4** |
| **RED** | **0** |
| **BLOCKED** | **16** |
| **TOTAL** | **58** ✓ |

`38 + 4 + 0 + 16 = 58` ✓

**No requirement changed status in this phase.** 2D.11 was a security and hardening sprint: it fixed
two defects, removed demo leakage and re-certified everything. That is the honest result — the fix
made the existing 38 GREEN requirements *safe to operate*, which they were not before.

X-06 (security) was GREEN before this phase and remains GREEN, but its meaning has changed
materially: it now covers a platform with no known unauthorised money-creation path.

---

## Every non-GREEN requirement

### AMBER (4) — implemented, one named part outstanding

| ID | Requirement | Exact blocker | Engineering can proceed? | Client decision | External dep | Effort | Critical path? |
|---|---|---|---|---|---|---|---|
| **P-13** | Rewards (cashback, achievements, missions) | Gift-code redemption is not exposed: the **destination wallet** (main vs bonus) and the **percentage base** are undefined | **No** | **D-08** | — | S | No |
| **P-17** | Referral | Leaderboard **ranking criterion** unspecified; qualification and reward undefined. Attribution, code, link, dashboard and history are live and DB-verified | **Partly** — the leaderboard becomes ~2h work once the criterion is chosen | **D-04**, **Q7** | — | S | No |
| **AD-06** | Large-withdrawal escalation | The **threshold value**. Mechanism is built, tested and *disabled while unset* | **No** — a number cannot be invented for a compliance control | **D-02** | — | XS | **Yes — safety** |
| **X-02** | DAU/MAU/retention/LTV/session/bounce | DAU/MAU live and SQL-verified. Retention needs a cohort definition; LTV needs F-02; session/bounce need page-view instrumentation **and** their own definitions | **Partly** — instrumentation is ~1 day of unblocked engineering, but it feeds nothing until D-06 defines the metrics | **D-06** | — | M | No |

### BLOCKED (16) — cannot proceed without client input or a vendor

| ID | Requirement | Blocker type | Exact requirement to unblock | Effort after | Critical path? |
|---|---|---|---|---|---|
| **F-02** | Revenue | MISSING FINANCIAL DEFINITION | Client picks one of GGR / NGR / NGR-after-duty / cash-basis / other | S | **Yes — unblocks 6** |
| **F-04** | Profit | MISSING FINANCIAL DEFINITION | F-02 | S | No |
| **PA-03** | Partner profit | MISSING FINANCIAL DEFINITION | F-02 | M | No |
| **PA-04** | Partner balance | MISSING FINANCIAL DEFINITION | PA-03 | M | No |
| **PA-06** | Partner withdrawal | MISSING FINANCIAL DEFINITION | PA-04 | M | No |
| **PA-10** | Daily profit distribution | MISSING FINANCIAL DEFINITION | PA-03 + F-05 | L | No |
| **F-05** | Daily settlement / financial close | MISSING BUSINESS RULE | What a closed period asserts, who signs off, whether it locks | L | No |
| **P-14** | Periodic rewards (daily/weekly/monthly/seasonal, lucky spin) | MISSING BUSINESS RULE | Every item is a **reward amount**; none defined | M | No |
| **P-15** | VIP levels 1–5 + progression | MISSING BUSINESS RULE | Tier thresholds **and** the metric they are measured by | M | No |
| **P-16** | VIP rewards + higher withdrawal limit | MISSING BUSINESS RULE | P-15 thresholds + reward amounts | M | No |
| **P-18** | Referral wallet | MISSING BUSINESS RULE | Nothing to hold until D-04; would also touch the **frozen** wallet schema | S | No |
| **X-03** | Email delivery | MISSING CREDENTIAL | SMTP host, port, user, password, from-address. **Code is complete** (nodemailer, log-only until configured) | XS | **Yes — no password-reset email** |
| **X-04** | SMS / push | MISSING PROVIDER | A provider must be chosen; no abstraction exists yet | M | No |
| **X-05** | Payment gateway | MISSING PROVIDER | Merchant account, API key/secret, webhook secret | L | **Yes — operationally** |
| **F-09** | FX-consolidated totals | MISSING SOURCE DATA | A rate feed. `exchange_rates` has 0 rows; only INR is in use, so impact is low today | S | No |
| **F-10** | Bank settlement | MISSING PROVIDER | Banking partner + file format | XL | No |

*Plus one BLOCKED sub-capability inside a GREEN requirement:* **P-12 KYC document file bytes** —
MISSING STORAGE (bucket + credentials). The review lifecycle is complete and working.

---

## Dependency graph

```
D-01 REVENUE DEFINITION ─┬─> F-02 ─┬─> F-04
                         │         └─> PA-03 ─> PA-04 ─> PA-06
                         │                 └─────────────> PA-10
                         └─> F-05 ────────────────────────> PA-10
D-02 WITHDRAWAL THRESHOLD ──> AD-06                    (< 1 hour after answer)
D-03 VIP TIERS ──> P-15 ──> P-16 <── D-05 REWARD AMOUNTS ──> P-14
D-04 REFERRAL REWARD ──> P-17 (reward half) ──> P-18
D-06 RETENTION COHORT ──> X-02 (retention)
     PROMOTION AWARD ──> AD-08 award half, P-14
D-08 GIFT-CODE DESTINATION ──> P-13

SMTP CREDENTIALS ──> X-03                              (< 1 hour after supply)
PAYMENT GATEWAY ──> X-05
OBJECT STORAGE ──> P-12 file upload
SMS/PUSH PROVIDER ──> X-04
FX FEED ──> F-09
BANKING PARTNER ──> F-10

ENGINEERING ONLY (no client input needed):
  page-view/session instrumentation ──> X-02 (session, bounce) [feeds nothing until D-06]
  admin UI for expenses ──────────────> F-03 usability (backend already GREEN)
```

**One answer — D-01 — unblocks six requirements. Two answers costing under an hour of engineering
each — D-02 and SMTP — close a compliance gap and restore password-reset email.**

---

## Classification of every requirement (Phase B of the brief)

| Class | Count | IDs |
|---|---|---|
| **E. ALREADY COMPLETE** | 38 | P-01…P-12, PA-01, PA-02, PA-05, PA-07, PA-08, PA-09, AD-01…AD-05, AD-07…AD-12, F-01, F-03, F-06, F-07, F-08, X-01, X-06, X-07, X-08 |
| **A. IMPLEMENT NOW** | 0 | — (the last such items were completed in 2D.10/2D.11) |
| **B. CLIENT DECISION REQUIRED** | 12 | P-13, P-14, P-15, P-16, P-17*, P-18, PA-03, PA-04, PA-06, PA-10, AD-06, F-02, F-04, F-05, X-02* |
| **C. EXTERNAL PROVIDER REQUIRED** | 5 | X-03, X-04, X-05, F-09, F-10 |
| **D. MISSING SOURCE DATA** | 1 | F-09 (also C — no feed exists to write it) |
| **F. SECURITY BLOCKER** | **0** | *(was 1 — `grant-bonus`, closed this phase)* |

\* P-17 and X-02 are AMBER, counted once under their blocking decision.

**There is no longer any requirement that engineering could complete without client input**, with the
two documented exceptions noted in the dependency graph, neither of which delivers user-visible value
until a definition arrives.
