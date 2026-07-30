/**
 * Production ledger + wallet (Phase 5A). The financial source of truth behind the
 * demo wallet — double-entry, idempotent, auditable, framework-agnostic.
 */
export * from './types';
export { Ledger, LedgerError, type LedgerSnapshot } from './ledger';
export { WalletService, type MoneyOptions } from './wallet-service';
