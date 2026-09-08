# Phase 2C.15 — Security Audit (Steps 11, 12, 17, 18)

The two NO-GO-capable gates — **admin outcome-manipulation** and **provably-fair integrity** — were audited
by tracing the actual execution path, not by absence of suspicious names. Result: **no manipulation
capability exists; provably-fair contract is intact.** No frozen change was required.

---

## Step 11 — Admin / outcome-manipulation audit — **PASS (no capability exists)**

**Question:** can any admin (or client) force Player A → WIN or Player A → LOSS on an individual round?

### 11.1 Name sweep (necessary, not sufficient)
Repo-wide search for `forceWin|forceLoss|rig|RTPOverride|outcomeOverride|playerWeight|targetPlayer|
setResult|fixOutcome|predetermine|houseWin|makeWin|makeLose` → **only benign matches** (`trigger`,
`freeTriggers` in bonus-round config). No manipulation hooks by name.

### 11.2 Execution-path trace (the real test)
Every admin controller touching a game/RNG/seed/payout/RTP/settlement surface was enumerated and its route
handlers traced to the code that computes a round:

| Admin surface | Capability | Can it set a round's outcome/payout/seed? |
|---|---|---|
| `admin-{dice,crash,roulette,card}` | Variant **CRUD / enable-disable / statistics / replay** (`GAMES_WRITE`) | **No.** Configures **rulesets/limits uniformly** for a variant; never a specific round, player, or result. Replay is read-only reproduction. |
| `admin-game-money` `/admin/games/rounds/:id` | Round **investigation** (`WALLETS_READ`) | **No.** Read-only. |
| `admin-wallet` credit/debit/freeze/unfreeze/rollback | **Ledgered** balance adjustment (`WALLETS_ADJUST`) | **No.** Double-entry accounting adjustment — cannot alter a game's RNG/result/payout; every move is a ledger row. |
| `admin-cashier` | Deposit/withdrawal **state transitions** (`WALLETS_ADJUST`) | **No.** Cashier lifecycle only. |
| `admin-catalog/games/sports/tournament/ai` | Catalog/analytics | **No.** Out of the money-settlement path / read-only. |

**No endpoint injects a per-round outcome, payout, seed, or per-player weighting.** Admin power is limited to
(a) uniform variant configuration, (b) ledgered wallet adjustments, (c) read-only investigation.

### 11.3 Client cannot inject an outcome either
- Money **play DTOs** (`gaming-money/dto/play-*.dto.ts`) accept **only player choices** (e.g. crash
  `autoCashout`, limbo/instant `target`, bet amount, variant, clientSeed). Their doc-contracts explicitly
  state they never accept "hands, winner, payout, balance, walletId, userId or serverSeed", enforced by
  `whitelist + forbidNonWhitelisted` → unknown fields → **400**.
- The `serverSeed!` DTO fields exist **only** in `dice/crash/card` module **verify** DTOs
  (`VerifyRollDto`/`VerifyCrashDto`/`VerifyShuffleDto`/`VerifyFairnessDto`), consumed by
  `verifyRoll`/`verifyCrash`/`verifyShuffle`/`verifyFairness` — **provably-fair reproduction endpoints with
  no wallet effect**, not the play path.

### 11.4 Payout is always engine-derived
The only `gameRound.update` writing `payout`+`result` outside standard engine settlement is the **lottery
draw settlement** (`game-money-bridge.service.ts:646`): `prize = money(stake × prizeTiers[countMatches(picks,
winningNumbers)])` — computed from the **server draw** and the player's **stored picks**, never from a
request body. All other payouts flow `engine → commitReservation` (server-computed win/multiplier).

**Verdict: PASS — no admin or client can force an individual player's win or loss.** Not a release blocker.

---

## Step 12 — Provably-fair certification (Dice/Plinko/Mines/Instant/Card) — **PASS**

- **Server controls the outcome.** `ProvablyFairService.createCommit()`:
  `serverSeed = randomBytes(32).toString('hex')` — cryptographically random, **server-generated, never
  accepted from a request**. Returned to the caller is only `serverSeedHash` (SHA-256 commitment) + `nonce`.
- **Deterministic replay.** `deriveSeed = HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`)` — same
  (serverSeed, clientSeed, nonce) always reproduces the same draw; the `verify*` endpoints expose this so a
  player can independently reproduce a settled round.
- **Client cannot submit an outcome/payout.** Confirmed in 11.3 — play DTOs whitelist-reject
  outcome/payout/serverSeed.
- **Secrets not exposed prematurely.** Only `serverSeedHash` is published while a round is live; the raw
  `serverSeed` is revealed only for verification of already-settled rounds. Server seeds are never logged,
  screenshotted, or committed.
- **No admin/player manipulation** of the seed or result (Step 11).

**Verdict: PASS — outcomes are server-authoritative, provably fair, and independently verifiable.**

---

## Step 17 — Secret / credential audit — **CLEAN**
- No `.env`/`.env.production.local` with real secrets is tracked; env files are gitignored.
- No hardcoded AWS keys / PEM blocks / inline JWT secrets in `apps/*/src` (only `process.env.*` references
  and example placeholders).
- No passwords, JWTs, refresh tokens, server seeds, DB creds, or API keys were written into any doc or
  screenshot in this phase.

## Step 18 — Frozen-surface re-verification — **PASS**
`git diff` shows **no modification** to WalletEngine, wallet-core, ledger, treasury, settlement,
GameMoneyBridge, ProvablyFairService, engine packages, runtime, registry, or the Prisma financial schema.
The one dirty wallet-engine file is the read-only transaction-history projection (no money movement). The
only standing product change is the retained 2C.13 `cookieSecure` fix.

## Additional security posture (regression-confirmed, unchanged)
Server-derived identity (`@CurrentUser('id')`); DTO whitelist rejects client
payout/balance/result/walletId/ledgerId/status (→400); ownership isolation (Player B → 403 on A's
round/operator/reconcile; history JWT-scoped); RBAC-gated admin; refresh token httpOnly + rotation + reuse
detection (old token → 401); access token memory-only; logout revokes.
