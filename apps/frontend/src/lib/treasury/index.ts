/**
 * Treasury & withdrawal layer (Phase 5C) — public surface.
 *
 * Production cash-out infrastructure above the Phase 5A ledger + 5B payments:
 * withdrawal lifecycle, treasury double-entry engine, approval state machine,
 * financial limits, reconciliation, manual operations and reporting. The Runtime
 * never imports this — money leaves the platform only through here.
 */
export * from './types';
export { WITHDRAWAL_TRANSITIONS, canTransition, assertTransition, TransitionError } from './state-machine';
export { TreasuryEngine, type TreasuryOpts } from './treasury-engine';
export { WithdrawalService, WithdrawalError, type WithdrawalServiceOptions } from './withdrawal-service';
