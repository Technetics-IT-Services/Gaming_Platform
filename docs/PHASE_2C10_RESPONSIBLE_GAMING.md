# Phase 2C.10 — Responsible Gaming (Honest Scope)

## The truth about enforcement

**The platform has no server-side responsible-gaming enforcement.** The audit found **no** models,
services, or endpoints for player-set deposit/loss/wager/session limits, self-exclusion, or cooling-off
(only an unrelated AI risk service and the catalog's `responsibleGamingEligible` presentation flag).

Per the phase's STOP rule — *"A frontend checkbox is NOT compliance"* — this phase therefore **does not
implement or display any control the server cannot enforce.** No client-only limits, no fake
self-exclusion, no compliance claim.

## What `/responsible-gaming` actually provides (all real)

1. **Self-monitoring tools (available now, server-authoritative):**
   - **Game history** (`/game-history`) — every real-money round.
   - **Transactions** (`/transactions`) — deposits, withdrawals, bets, wins with balances.
   - **Wallet** (`/wallet`) — the authoritative balance.
2. **Real platform cashier limits** — read from `GET /cashier/config` (min/max deposit & withdrawal per
   request). These are **enforced by the server** on every cashier request (Phase 2C.9), so they are
   truthfully labelled as enforced.
3. **An explicit "Not currently available" section** — states plainly that player-configurable limits,
   self-exclusion and cooling-off are not yet available, and that the platform will not show a control
   it cannot enforce.
4. **Get help** — link to `/support`.

## Why not more

Implementing genuine limit enforcement (e.g. a deposit limit checked before deposit completion, a wager
limit before stake reservation, a loss limit from authoritative history) would require **new models +
enforcement wired into the cashier and/or the frozen `GameMoneyBridge`/stake path**. That is out of
scope for this phase and would touch frozen financial surfaces. Per the STOP rule, this dependency is
**reported, not bypassed**, and is left as a candidate for a future phase.

## Classification

- Self-monitoring surfacing: **DONE / VERIFIED** (real history + cashier limits).
- Player-set limits / self-exclusion / cooling-off enforcement: **NOT IMPLEMENTED (no backend
  enforcement; would require frozen-surface work) — honestly disclosed in-app.**
