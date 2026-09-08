# Client Decision Questionnaire

**One page. Only questions we cannot answer for you.** Please tick an option or write your own.
Every "recommended default" below is **a suggestion only — we will not implement it unless you say
so.**

Return by **Monday 8 September** for the September 10 delivery. Later answers are still welcome;
they simply land after delivery.

---

## FINANCE

### Q1 — What counts as REVENUE for this platform? ⭐ **Highest impact: unblocks 6 requirements**

- ☐ **A.** Gross Gaming Revenue = player stakes − player winnings
- ☐ **B.** Net Gaming Revenue = GGR − bonuses and promotional costs
- ☐ **C.** Net Gaming Revenue after tax/levies = B − gaming duty
- ☐ **D.** Cash basis = completed deposits − completed withdrawals
- ☐ **E.** Other: ______________________________________________

*Recommended default (a recommendation, not a decision): **B** — it is the most common operator
definition and the one your partner-share arrangement most likely assumes.*

- **Affects:** F-02 Revenue, F-04 Profit, PA-03 Partner profit, PA-04 Partner balance,
  PA-06 Partner withdrawals, PA-10 Daily profit distribution
- **After you answer:** ~1 day of engineering; those six requirements become deliverable.
- **If unanswered:** the finance and partner-money screens continue to show *"not available — no
  revenue definition"* instead of a number. Nothing breaks; those figures simply never appear.

### Q2 — What is the daily financial CLOSE?

- ☐ **A.** A read-only end-of-day snapshot, no lock
- ☐ **B.** A snapshot that locks the period so figures cannot change afterwards
- ☐ **C.** B, plus a named person must sign off before the period closes
- ☐ **D.** Not required for launch
- ☐ **E.** Other: ______________________________________________

*Recommended default: **D** for launch — the daily figures already exist in Reports; formal closing
can follow.*

- **Affects:** F-05 · **After you answer:** ~2–3 days (A/B), ~3+ days (C) · **If unanswered:** daily
  numbers are still available in Reports; there is simply no locked "closed period".

---

## WITHDRAWALS

### Q3 — Above what amount must a withdrawal need SUPER-ADMIN approval?

- ☐ **A.** ₹ ____________ (per single withdrawal)
- ☐ **B.** No escalation tier — any admin may approve any amount
- ☐ **C.** Other rule: ______________________________________________

*Recommended default: none offered. **This is a compliance control and we will not choose a number
for you.***

- **Affects:** AD-06 · **After you answer:** under 1 hour — the mechanism is already built and
  tested; it only needs the number.
- **If unanswered:** ⚠️ **the escalation control stays switched off and any admin can approve any
  withdrawal of any size.** This is the single cheapest decision with the largest safety impact.

---

## VIP

### Q4 — What are the VIP tiers, and what qualifies a player for each?

| Level | Name | Qualifies at | Measured by |
|---|---|---|---|
| 1 | ____________ | ____________ | ☐ total deposited ☐ total staked ☐ rounds played ☐ other |
| 2 | ____________ | ____________ | ☐ total deposited ☐ total staked ☐ rounds played ☐ other |
| 3 | ____________ | ____________ | ☐ total deposited ☐ total staked ☐ rounds played ☐ other |
| 4 | ____________ | ____________ | ☐ total deposited ☐ total staked ☐ rounds played ☐ other |
| 5 | ____________ | ____________ | ☐ total deposited ☐ total staked ☐ rounds played ☐ other |

☐ VIP not required for launch

*Recommended default: none. Tier thresholds are your commercial policy.*

- **Affects:** P-15, P-16 · **After you answer:** ~1 day for tiers and progression; rewards need Q6
  as well.
- **If unanswered:** the VIP page stays a static informational page with no progression.

### Q5 — What does each VIP level receive?

Per level: ☐ higher withdrawal limit (₹ ______) ☐ cashback ____% ☐ birthday reward ₹ ______
☐ periodic reward ₹ ______ ☐ nothing monetary ☐ other: ______________

- **Affects:** P-16 · **If unanswered:** no VIP benefit is granted. We will not invent amounts.

---

## REFERRALS

### Q6 — When does a referral QUALIFY, and what is the reward?

**Qualifies when the referred player:**
- ☐ **A.** makes any first deposit
- ☐ **B.** deposits at least ₹ ____________
- ☐ **C.** deposits at least ₹ ____________ within ______ days of signing up
- ☐ **D.** stakes at least ₹ ____________
- ☐ **E.** Other: ______________________________________________

**Reward to the referrer:** ☐ ₹ ____________ fixed ☐ ______% of the qualifying deposit
☐ ______% of the referred player's losses ☐ nothing for launch ☐ other: ____________

**Paid into:** ☐ main wallet ☐ bonus wallet (wagering requirement: ______×) ☐ separate referral wallet

*Recommended default: none. This is a marketing spend decision.*

- **Affects:** P-17 (reward half), P-18 · **After you answer:** ~half a day.
- **If unanswered:** referrals are **already recorded and working** — who referred whom, and the
  history. Only the payout is absent, and the page says so plainly instead of showing ₹0.

### Q7 — What should the referral LEADERBOARD rank by?

- ☐ **A.** Number of people referred
- ☐ **B.** Number of *qualified* referrals (needs Q6)
- ☐ **C.** Total reward earned (needs Q6)
- ☐ **D.** No leaderboard

*Recommended default: **A** — it is the only option that works without Q6 and shows real data today.*

- **Affects:** P-17 · **After you answer:** ~2 hours for option A.

---

## PROMOTIONS

### Q8 — What does a promotion actually GIVE a player?

- ☐ **A.** Nothing automatic — staff grant a bonus manually (**this already works today**)
- ☐ **B.** A fixed amount ₹ ______ credited on a trigger: ______________
- ☐ **C.** A percentage ______% of the player's deposit, capped at ₹ ______
- ☐ **D.** Free spins: ______ spins on game ______________
- ☐ **E.** Other: ______________________________________________

**Wagering requirement before it can be withdrawn:** ______× the bonus (or ☐ none)

*Recommended default: **A** for launch — creating, scheduling and publishing promotions already
works, and staff can already grant bonuses with full audit.*

- **Affects:** AD-08 (award half), P-14, AD-07 auto-award · **After you answer:** ~1–2 days.
- **If unanswered:** promotions are published and visible to players; the credit is granted by staff
  rather than automatically.

### Q9 — What does a gift code / coupon give, and where does it go?

☐ fixed amount ₹ ______ ☐ ______% of ____________ · into ☐ main wallet ☐ bonus wallet

- **Affects:** P-13 · **If unanswered:** gift-code redemption stays unexposed.

---

## RESPONSIBLE GAMING

### Q10 — Are the current responsible-gaming controls sufficient for launch?

Already live and enforced **before** any money moves: player-set deposit / wager / loss limits,
self-exclusion, cooling-off. Limit *increases* are delayed; decreases apply immediately.

- ☐ **A.** Yes, sufficient for launch
- ☐ **B.** We also need mandatory platform-wide limits: ______________________
- ☐ **C.** We need a specific regulator's ruleset: ______________________

*Recommended default: **A**.* · **Affects:** P-10 · **If unanswered:** we proceed as built.

---

## ANALYTICS

### Q11 — How do you define player RETENTION?

- ☐ **A.** Day-1 / Day-7 / Day-30 — % of players active again on exactly that day after signup
- ☐ **B.** Rolling — % active at least once within 1 / 7 / 30 days of signup
- ☐ **C.** Other: ______________________________________________
- ☐ **D.** Not required for launch

*Recommended default: **B** — the more common commercial reading, and less noisy than A.*

- **Affects:** X-02 · **After you answer:** ~half a day.
- **Please note:** activity has only been recorded **since 7 September 2026**. There is no history
  before that date and we will not invent one. Retention figures will be meaningful after roughly a
  month of live traffic.

---

## PAYMENTS

### Q12 — Which payment gateway will you use?

- ☐ Razorpay ☐ PayU ☐ Cashfree ☐ Stripe ☐ Other: ____________ ☐ Manual bank transfer only, for now

**We need:** merchant account, API key + secret, webhook signing secret, sandbox credentials first.

*Recommended default: none — this is your commercial relationship.*

- **Affects:** X-05 · **After credentials arrive:** ~3–5 days including webhook reconciliation.
- **If unanswered:** ⚠️ deposits work, but a staff member must confirm each one manually. Players
  cannot self-serve a deposit. **This is the largest day-one operational constraint.**

---

## MESSAGING

### Q13 — Email (SMTP)

Provide: host, port, username, password, "from" address, and whether TLS is required.

- **Affects:** X-03 · **After credentials arrive:** under 1 hour — the mail system is built and
  currently logs instead of sending.
- **If unanswered:** ⚠️ no email leaves the platform — **including password-reset and
  email-verification messages.**

### Q14 — SMS / push notifications

- ☐ SMS provider: ____________ ☐ Push provider: ____________ ☐ Not required for launch

*Recommended default: **not required for launch** — in-app notifications are complete and durable.*

- **Affects:** X-04 · **After you answer:** ~1–2 days per channel.

---

## KYC / STORAGE

### Q15 — Where should identity documents be stored?

- ☐ AWS S3 ☐ Google Cloud Storage ☐ Azure Blob ☐ Self-hosted MinIO ☐ Other: ____________

**We need:** bucket name, region, access key, secret, and your retention period: ______ months.

- **Affects:** P-12 file upload · **After credentials arrive:** ~1 day.
- **If unanswered:** ⚠️ KYC review works end to end, but **the document images cannot be stored** —
  reviewers must inspect documents outside the platform.

---

## BANKING

### Q16 — Bank settlement / payout file

- ☐ Bank + format: ____________ ☐ Manual payouts for launch

*Recommended default: **manual payouts for launch**.* · **Affects:** F-10 · **After you answer:**
3+ days, and it depends on your bank's file specification.

---

## FX

### Q17 — Will you operate in more than one currency at launch?

- ☐ **A.** No — INR only *(currently the only currency with any activity)*
- ☐ **B.** Yes: ____________________ — and rates should come from: ____________

*Recommended default: **A**.*

- **Affects:** F-09 · **If A:** nothing further is needed. **If B:** we need a rate source; until
  then, totals are reported per currency and never combined.

---

## Summary of what your answers unlock

| Answer | Unlocks | Engineering after |
|---|---|---|
| **Q1** Revenue | 6 requirements | ~1 day |
| **Q3** Threshold | AD-06 compliance control | <1 hour |
| **Q13** SMTP | Password reset, verification emails | <1 hour |
| **Q12** Gateway | Self-service deposits | 3–5 days |
| **Q15** Storage | KYC document upload | ~1 day |
| **Q6** Referral reward | P-17, P-18 | ~half a day |
| **Q8** Promotion award | AD-08, P-14 | 1–2 days |
| **Q4/Q5** VIP | P-15, P-16 | ~1 day + rewards |
| **Q11** Retention | X-02 | ~half a day |

**If you can answer only three, answer Q3, Q13 and Q1** — a compliance control, working email, and
six unblocked requirements, for very little engineering.
