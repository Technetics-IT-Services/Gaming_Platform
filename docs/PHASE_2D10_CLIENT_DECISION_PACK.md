# Client Decision Pack

**Prepared 7 September 2026 · Delivery date 10 September 2026**
Written for a non-technical reader. Every number here comes from a test we ran, not an estimate.

---

## 1. Executive summary

Your gaming platform is **built and working**. Players can register, sign in, deposit, play fifteen
real-money games, view their history and withdraw. Your staff can manage users, games, KYC, support
tickets, promotions, bonuses, partners, settings and finances. Money is tracked to the last decimal
place, and we can prove it balances exactly.

**Of 58 requirements: 38 are complete and verified. 4 are working with one named part missing.
16 are waiting on something only you or an outside company can provide.** Nothing is waiting on us
writing more code, with one small exception noted in §5.

**There is one serious problem you must know about before launch.** During this final audit we found
a security hole that lets any signed-in player give themselves unlimited money. We reproduced it: a
brand-new ordinary player account created ₹1,000,000 of withdrawable balance in two steps. **The
platform must not go live until this is fixed.** The fix is small and ready — see §6.

---

## 2. What is already complete

**For your players**
- Sign-up, sign-in, password reset flow, two-factor authentication support
- Deposits and withdrawals with a proper review process
- **Fifteen real-money games** — dice, crash, roulette, blackjack, baccarat, sic bo, lottery,
  poker, plinko, mines, limbo, coin flip, wheel, dragon tiger, andar bahar, teen patti
- Wallet, transaction history and game history
- Responsible gambling: players can set their own deposit, wager and loss limits, or self-exclude —
  **and the platform enforces them before any money moves**
- Identity verification (KYC) submission and status tracking
- Support tickets with replies
- In-app notifications
- Referral codes and tracking of who introduced whom
- A page showing the offers you have published

**For your staff**
- User management, game management, role assignment
- Deposit and withdrawal review
- KYC review queue with approve/reject
- Support ticket queue
- Promotions: create, schedule, publish, pause, end
- **Bonuses: grant to a named player, review, expire** — every grant recorded against the staff
  member who made it
- **Finance console: cash flow, transaction search across all players, failure investigation**
- Analytics dashboard and six exportable reports
- Platform settings
- Partner management with configurable ownership percentages

**For your partners**
- Their own private login and dashboard
- Their ownership percentage, team members and a full history of changes to their organisation,
  downloadable as a spreadsheet
- **A partner can never see another partner's data** — we tested this repeatedly from several angles

---

## 3. What has been security-tested

**171 live security checks were run against the real running system. All passed.**

| We tried to… | Result |
|---|---|
| Read another player's data by changing an ID in the address | Refused |
| Read another partner's organisation | Refused |
| Give ourselves an admin role | Refused |
| Send a hidden extra field to set our own balance or status | Rejected outright |
| Submit the same payment twice to be paid twice | Recorded once |
| Run two conflicting changes at the same moment | Only one succeeded |
| Reach an admin screen as an ordinary player | Refused by the screen **and** by the server |
| Find a password, token or secret stored in the logs | None found |

Administrator accounts must use two-factor authentication before any admin action. Every
administrator action is now recorded with who did it, when, and from where.

---

## 4. What has been financially validated

Checked directly against the live database at the end of this audit:

| Check | Result |
|---|---|
| Does every rupee balance? (total money in = total money out) | **Exactly zero difference** across 56,828 ledger entries |
| Any account with negative money? | **None** |
| Any payment recorded twice? | **None** |
| Any individual account book out of balance? | **None** |
| Did any of the new screens move money by accident? | **No — verified before and after** |

The accounting foundation is sound. *(The security hole in §6 is not an accounting error — the
fraudulent money is recorded perfectly correctly, which is exactly why the accounting checks did not
catch it. It is a permissions problem.)*

---

## 5. What remains

**Almost nothing is waiting on us.** Of the 20 requirements not fully complete:

- **16** need a decision from you or an account with an outside company
- **4** are working with one named part missing, and that part also needs a decision from you

**The only genuine engineering work left that needs no input from you** is page-view tracking, used
for two minor statistics (how long a session lasts, and bounce rate). Everything else on that list
depends on an answer.

We have deliberately **not invented** anything: no made-up revenue figure, no invented VIP levels,
no guessed referral reward, no fake payment confirmations. Where a number cannot be known, the
screen says *"not available"* and explains why, rather than showing ₹0 — because a zero would look
like a real calculated answer.

---

## 6. ⚠️ The one thing that must be fixed before launch

**What it is:** one web address on the platform was left without a security check. Any signed-in
player can call it directly and give themselves any amount of bonus money, then convert it into a
withdrawable balance.

**How bad:** we proved it works. A brand-new ordinary account created ₹1,000,000 and could have
withdrawn it.

**Why nothing caught it:** the money is recorded *correctly* in the books, so the accounting checks
balanced perfectly. It is a permissions gap, not a bookkeeping error. No screen in your platform
uses this address, which is why no ordinary testing found it.

**Has it been used?** No. The only occurrence in your database is our own test, which we reversed
immediately through the proper audited channel. Your books balance exactly.

**The fix:** delete that one address. Nothing uses it. Your staff already have a proper, secure way
to grant bonuses, which we built and tested this week.

**Why we have not already done it:** you asked us to freeze the financial core and to bring any
change to you for approval rather than touching it. We are following that instruction. **The change
is written, reviewed and waiting — it needs one word from you.** Estimated time to apply and
re-verify: under two hours.

---

## 7. External services you need to arrange

| Service | What it is for | Without it |
|---|---|---|
| **Payment gateway** | Players funding accounts themselves | Staff confirm every deposit by hand |
| **Email (SMTP)** | Password resets, verification | **No email leaves the platform at all** |
| **Document storage** | Storing ID photos for KYC | Reviewers must see documents another way |
| **SMS / push** | Text and phone notifications | In-app notifications only (these work fully) |
| **Bank settlement** | Automated payout files | Payouts made manually |
| **Exchange rates** | Multi-currency totals | Only needed if you use more than one currency |

**We have built no fake versions of any of these.** The email system is fully written and will start
sending the moment you provide a mail server; the others need a provider account first.

---

## 8. Consequences of delaying each decision

| Decision | If it is late |
|---|---|
| **Revenue definition** | Six requirements stay unavailable — profit, partner profit, partner balances, partner payouts. Screens say "not available" rather than showing a wrong number. Nothing breaks. |
| **Large-withdrawal threshold** | ⚠️ **Any admin can approve a withdrawal of any size.** The control exists but stays switched off. This is the cheapest and most valuable decision on the list. |
| **Email server** | ⚠️ **Password resets and verification emails cannot be sent.** Players who forget a password need staff help. |
| **Payment gateway** | ⚠️ Deposits require manual staff confirmation, one by one. Workable at low volume, painful at scale. |
| **Document storage** | KYC approval works, but document images live outside the platform. |
| **VIP tiers / referral reward / promotion award** | Those features stay visible but non-paying. Referrals are still tracked; promotions are still published. |
| **Retention definition** | One analytics chart stays unavailable. Note that meaningful retention data needs about a month of live traffic regardless. |
| **Financial close** | Daily figures are already available in Reports; only a formal "locked period" is missing. |

---

## 9. Recommended decision deadline

| Date | What we need |
|---|---|
| **Mon 8 Sept, morning** | Approval to fix the security hole (§6) — one word |
| **Mon 8 Sept** | Large-withdrawal threshold · SMTP credentials · revenue definition |
| **Mon 8 Sept** | Confirmation of which optional features are in scope for launch day |
| **Anytime after** | Payment gateway, storage, VIP, referral and promotion rules — these can follow launch without breaking anything |

Only the first item genuinely gates the 10 September delivery.

---

## 10. Implementation estimates once decisions arrive

| Decision received | Work | Ready |
|---|---|---|
| Security fix approved | Remove route, re-run full verification | **Same day** |
| Large-withdrawal threshold | Set the value | **Under 1 hour** |
| SMTP credentials | Configure and test a real send | **Under 1 hour** |
| Revenue definition | Profit, partner profit, balances, payouts | **~1 day** |
| Referral reward rule | Qualification + payout | **~half a day** |
| Retention definition | Cohort calculation | **~half a day** |
| Promotion award rule | Automatic crediting | **1–2 days** |
| VIP tiers and benefits | Tier engine and progression | **~1 day** + rewards |
| Document storage credentials | File upload and retrieval | **~1 day** |
| Payment gateway credentials | Full integration and reconciliation | **3–5 days** |
| Financial close rules | Period close and locking | **2–3 days** |

---

## 11. Our honest recommendation

**Do not launch until the security hole is closed.** It is a two-hour job once you approve it, and
everything else about the platform is in good shape.

After that, you can launch on 10 September with:
- all fifteen games and the full money system
- player self-service, responsible gambling controls, KYC and support
- full staff administration including bonuses, promotions, partners and finance

with two known day-one operational constraints: **deposits confirmed manually** (until a payment
gateway is connected) and **no outbound email** (until a mail server is provided). Both are
arrangements you can make this week.

Every remaining item is genuinely waiting on a decision or an account — not on more development.
