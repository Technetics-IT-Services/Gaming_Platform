/**
 * Withdrawal approval state machine (Phase 5C, STEP 4).
 *
 * A configurable, validated transition table. Every service action asserts the
 * transition is legal before moving money, so an out-of-order approval/settlement
 * can never occur. Terminal states (Rejected/Cancelled/Reversed) have no exits.
 */
import { WithdrawalStatus } from './types';

export const WITHDRAWAL_TRANSITIONS: Record<WithdrawalStatus, WithdrawalStatus[]> = {
  [WithdrawalStatus.Draft]: [WithdrawalStatus.Requested, WithdrawalStatus.Cancelled],
  [WithdrawalStatus.Requested]: [WithdrawalStatus.PendingReview, WithdrawalStatus.Cancelled],
  [WithdrawalStatus.PendingReview]: [WithdrawalStatus.Approved, WithdrawalStatus.Rejected, WithdrawalStatus.Cancelled],
  [WithdrawalStatus.Approved]: [WithdrawalStatus.Processing, WithdrawalStatus.Cancelled],
  [WithdrawalStatus.Processing]: [WithdrawalStatus.Completed, WithdrawalStatus.Failed],
  [WithdrawalStatus.Failed]: [WithdrawalStatus.Processing, WithdrawalStatus.Cancelled],
  [WithdrawalStatus.Completed]: [WithdrawalStatus.Reversed],
  [WithdrawalStatus.Rejected]: [],
  [WithdrawalStatus.Cancelled]: [],
  [WithdrawalStatus.Reversed]: [],
};

export function canTransition(from: WithdrawalStatus, to: WithdrawalStatus): boolean {
  return WITHDRAWAL_TRANSITIONS[from]?.includes(to) ?? false;
}

export class TransitionError extends Error {
  constructor(
    readonly from: WithdrawalStatus,
    readonly to: WithdrawalStatus,
  ) {
    super(`Illegal withdrawal transition ${from} → ${to}`);
    this.name = 'TransitionError';
  }
}

export function assertTransition(from: WithdrawalStatus, to: WithdrawalStatus): void {
  if (!canTransition(from, to)) throw new TransitionError(from, to);
}
