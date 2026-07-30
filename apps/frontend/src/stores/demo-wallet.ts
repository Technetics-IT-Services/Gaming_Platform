import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { recordLedger, resetWalletLedger } from './wallet-ledger';

/**
 * Client-side demo wallet ecosystem (Phase 1.2 → 1.3). One source of truth for
 * the demo balance, the vault, and the transaction + bet ledgers — all persisted
 * to localStorage so everything survives a reload. Never touches the backend
 * (real wallets still come from the API in production). New sessions start at ₹0.
 *
 * Every wallet movement auto-records a transaction; games record bets via
 * `recordBet`. Timestamps are captured at action time (client-only, never during
 * SSR), so there is no hydration risk.
 */

/** Amount granted by the legacy demo "reload" convenience (cosmetics store). */
export const DEMO_RELOAD = 100_000;

export type TxnType =
  | 'deposit'
  | 'withdraw'
  | 'vault_in'
  | 'vault_out'
  | 'bet'
  | 'win'
  | 'refund'
  | 'bonus';

export interface Transaction {
  id: string;
  /** Human reference, e.g. TXN-000001. */
  ref: string;
  type: TxnType;
  /** Signed change to the wallet balance (+ credit, − debit). */
  amount: number;
  /** Wallet balance immediately after this transaction. */
  balanceAfter: number;
  ts: number;
  status: 'completed';
  label: string;
  /** Optional origin of the movement (e.g. 'daily', 'blackjack') — bonus/refund. */
  note?: string;
}

export interface BetRecord {
  id: string;
  roundId: string;
  game: string;
  stake: number;
  win: boolean;
  /** Net profit/loss (win: payout − stake, loss: −stake). */
  net: number;
  multiplier: number;
  ts: number;
  status: 'won' | 'lost';
}

const MAX_LEDGER = 500;

const TXN_LABEL: Record<TxnType, string> = {
  deposit: 'Deposit',
  withdraw: 'Withdrawal',
  vault_in: 'Transfer to Vault',
  vault_out: 'Transfer from Vault',
  bet: 'Bet',
  win: 'Win',
  refund: 'Refund',
  bonus: 'Bonus',
};

interface DemoWalletState {
  balance: number;
  vault: number;
  transactions: Transaction[];
  bets: BetRecord[];
  txnSeq: number;
  betSeq: number;

  /** Add funds (demo deposit). */
  deposit: (amount: number) => void;
  /** Remove funds; returns false if invalid or exceeds balance. */
  withdraw: (amount: number) => boolean;
  /** Wallet → Vault; returns false if invalid or exceeds wallet balance. */
  transferToVault: (amount: number) => boolean;
  /** Vault → Wallet; returns false if invalid or exceeds vault balance. */
  transferFromVault: (amount: number) => boolean;
  /** Bet stake (never below 0) — records a `bet` transaction. */
  spend: (amount: number) => void;
  /** Winnings / credit — records a `win` transaction. */
  credit: (amount: number) => void;
  /** Promotional credit (daily reward, welcome, wheel…) — records a `bonus` txn. */
  bonus: (amount: number, opts?: { label?: string; source?: string }) => void;
  /** Return funds for a cancelled/invalid round — records a `refund` txn. */
  refund: (amount: number, opts?: { label?: string; source?: string }) => void;
  /** Record a bet in the bet-history ledger (called by game settle logic). */
  recordBet: (bet: {
    game: string;
    stake: number;
    win: boolean;
    net: number;
    multiplier?: number;
  }) => void;
  /** Legacy demo top-up used by the cosmetics store. */
  reload: () => void;
  /** Reset all demo wallet data (e.g. on logout). */
  reset: () => void;
}

export const useDemoWallet = create<DemoWalletState>()(
  persist(
    (set) => {
      /** Append a transaction, computing the reference + balanceAfter. */
      const withTxn = (
        s: DemoWalletState,
        type: TxnType,
        amount: number,
        balanceAfter: number,
        opts?: { label?: string; note?: string },
      ): Pick<DemoWalletState, 'txnSeq' | 'transactions'> => {
        const seq = s.txnSeq + 1;
        const txn: Transaction = {
          id: `txn-${seq}`,
          ref: `TXN-${String(seq).padStart(6, '0')}`,
          type,
          amount,
          balanceAfter,
          ts: Date.now(),
          status: 'completed',
          label: opts?.label ?? TXN_LABEL[type],
          ...(opts?.note ? { note: opts.note } : {}),
        };
        return { txnSeq: seq, transactions: [txn, ...s.transactions].slice(0, MAX_LEDGER) };
      };

      return {
        balance: 0,
        vault: 0,
        transactions: [],
        bets: [],
        txnSeq: 0,
        betSeq: 0,

        deposit: (amount) =>
          set((s) => {
            const amt = Math.max(0, Math.floor(amount));
            if (amt <= 0) return s;
            const balance = s.balance + amt;
            recordLedger('deposit', amt, { preBalance: s.balance, preVault: s.vault });
            return { balance, ...withTxn(s, 'deposit', amt, balance) };
          }),

        withdraw: (amount) => {
          const amt = Math.max(0, Math.floor(amount));
          let ok = false;
          set((s) => {
            if (amt <= 0 || amt > s.balance) return s;
            ok = true;
            const balance = s.balance - amt;
            recordLedger('withdraw', amt, { preBalance: s.balance, preVault: s.vault });
            return { balance, ...withTxn(s, 'withdraw', -amt, balance) };
          });
          return ok;
        },

        transferToVault: (amount) => {
          const amt = Math.max(0, Math.floor(amount));
          let ok = false;
          set((s) => {
            if (amt <= 0 || amt > s.balance) return s;
            ok = true;
            const balance = s.balance - amt;
            recordLedger('vault_in', amt, { preBalance: s.balance, preVault: s.vault });
            return { balance, vault: s.vault + amt, ...withTxn(s, 'vault_in', -amt, balance) };
          });
          return ok;
        },

        transferFromVault: (amount) => {
          const amt = Math.max(0, Math.floor(amount));
          let ok = false;
          set((s) => {
            if (amt <= 0 || amt > s.vault) return s;
            ok = true;
            const balance = s.balance + amt;
            recordLedger('vault_out', amt, { preBalance: s.balance, preVault: s.vault });
            return { balance, vault: s.vault - amt, ...withTxn(s, 'vault_out', amt, balance) };
          });
          return ok;
        },

        spend: (amount) =>
          set((s) => {
            const amt = Math.max(0, Math.floor(amount));
            if (amt <= 0) return s;
            const balance = Math.max(0, s.balance - amt);
            recordLedger('bet', amt, { preBalance: s.balance, preVault: s.vault });
            return { balance, ...withTxn(s, 'bet', -amt, balance) };
          }),

        credit: (amount) =>
          set((s) => {
            const amt = Math.max(0, Math.floor(amount));
            if (amt <= 0) return s;
            const balance = s.balance + amt;
            recordLedger('win', amt, { preBalance: s.balance, preVault: s.vault });
            return { balance, ...withTxn(s, 'win', amt, balance) };
          }),

        bonus: (amount, opts) =>
          set((s) => {
            const amt = Math.max(0, Math.floor(amount));
            if (amt <= 0) return s;
            const balance = s.balance + amt;
            recordLedger('bonus', amt, { preBalance: s.balance, preVault: s.vault, reason: opts?.source });
            return {
              balance,
              ...withTxn(s, 'bonus', amt, balance, { label: opts?.label, note: opts?.source }),
            };
          }),

        refund: (amount, opts) =>
          set((s) => {
            const amt = Math.max(0, Math.floor(amount));
            if (amt <= 0) return s;
            const balance = s.balance + amt;
            recordLedger('refund', amt, { preBalance: s.balance, preVault: s.vault, reason: opts?.source });
            return {
              balance,
              ...withTxn(s, 'refund', amt, balance, { label: opts?.label, note: opts?.source }),
            };
          }),

        recordBet: (bet) =>
          set((s) => {
            const stake = Math.max(0, Math.round(bet.stake));
            if (stake <= 0) return s; // skill games / no-stake rounds aren't bets
            const seq = s.betSeq + 1;
            const record: BetRecord = {
              id: `bet-${seq}`,
              roundId: `RND-${String(seq).padStart(6, '0')}`,
              game: bet.game,
              stake,
              win: bet.win,
              net: Math.round(bet.net),
              multiplier: Number(bet.multiplier ?? 0),
              ts: Date.now(),
              status: bet.win ? 'won' : 'lost',
            };
            return { betSeq: seq, bets: [record, ...s.bets].slice(0, MAX_LEDGER) };
          }),

        reload: () =>
          set((s) => {
            // Top up to the demo baseline, recording it as a Bonus so every
            // balance change still flows through the ledger (never a bare set).
            const top = Math.max(0, DEMO_RELOAD - s.balance);
            if (top <= 0) return s;
            const balance = s.balance + top;
            recordLedger('bonus', top, { preBalance: s.balance, preVault: s.vault, reason: 'reload' });
            return {
              balance,
              ...withTxn(s, 'bonus', top, balance, { label: 'Demo Reload', note: 'reload' }),
            };
          }),

        reset: () => {
          resetWalletLedger();
          set({ balance: 0, vault: 0, transactions: [], bets: [], txnSeq: 0, betSeq: 0 });
        },
      };
    },
    {
      name: 'gp-wallet',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        balance: s.balance,
        vault: s.vault,
        transactions: s.transactions,
        bets: s.bets,
        txnSeq: s.txnSeq,
        betSeq: s.betSeq,
      }),
    },
  ),
);
