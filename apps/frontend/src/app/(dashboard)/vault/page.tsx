'use client';

import { Button, Input, cn } from '@gaming-platform/ui';
import { ArrowRightLeft, Coins, Info, Lightbulb, Lock, ShieldCheck, Zap } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { AnimatedNumber } from '@/components/marketing/animated-number';
import { WalletInfoCard } from '@/components/wallet/wallet-info-card';
import { useDemoWallet } from '@/stores/demo-wallet';

const QUICK = [100, 500, 1000, 5000, 10000];
type Dir = 'toVault' | 'toWallet';

/**
 * Vault page (Phase 1.3). Move demo funds between the wallet and the vault
 * instantly. Same premium layout + design system as Deposit/Withdraw.
 */
export default function VaultPage() {
  const balance = useDemoWallet((s) => s.balance);
  const vault = useDemoWallet((s) => s.vault);
  const transferToVault = useDemoWallet((s) => s.transferToVault);
  const transferFromVault = useDemoWallet((s) => s.transferFromVault);

  const [dir, setDir] = useState<Dir>('toVault');
  const [amount, setAmount] = useState('');

  const source = dir === 'toVault' ? balance : vault;
  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0;
  const exceeds = valid && value > source;
  const canSubmit = valid && !exceeds;

  const submit = () => {
    if (!valid) {
      toast.error('Enter a valid amount to transfer.');
      return;
    }
    const ok = dir === 'toVault' ? transferToVault(value) : transferFromVault(value);
    if (!ok) {
      toast.error(`You cannot transfer more than your ${dir === 'toVault' ? 'wallet' : 'vault'} balance.`);
      return;
    }
    toast.success(
      `Transferred ₹${Math.floor(value).toLocaleString('en-US')} ${dir === 'toVault' ? 'to your vault' : 'to your wallet'}.`,
    );
    setAmount('');
  };

  return (
    <section className="mx-auto w-full max-w-[1180px] space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet/10 text-violet">
          <Lock className="h-6 w-6" />
        </span>
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">Vault</h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            Set funds aside — move money between your wallet and vault instantly.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.7fr_1fr] lg:gap-8">
        {/* LEFT — balances + transfer form */}
        <div className="space-y-6">
          {/* Balances */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="card-premium flex flex-col gap-1 p-6 sm:p-7">
              <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Coins className="h-4 w-4 text-gold" /> DEMO BALANCE
              </span>
              <span className="font-mono text-4xl font-extrabold tabular-nums text-foreground">
                ₹<AnimatedNumber value={balance} />
              </span>
              <span className="text-xs text-muted-foreground">Play-money for testing only</span>
            </div>
            <div className="card-premium flex flex-col gap-1 p-6 sm:p-7">
              <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Lock className="h-4 w-4 text-violet" /> DEMO VAULT
              </span>
              <span className="font-mono text-4xl font-extrabold tabular-nums text-foreground">
                ₹<AnimatedNumber value={vault} />
              </span>
              <span className="text-xs text-muted-foreground">Play-money for testing only</span>
            </div>
          </div>

          {/* Transfer form */}
          <div className="card-premium space-y-7 p-6 sm:p-8">
            {/* Direction toggle */}
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-black/[0.04] p-1">
              {(
                [
                  { key: 'toVault', label: 'Wallet → Vault' },
                  { key: 'toWallet', label: 'Vault → Wallet' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => {
                    setDir(opt.key);
                    setAmount('');
                  }}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold transition-all',
                    dir === opt.key
                      ? 'bg-white text-foreground shadow-soft'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <ArrowRightLeft className="h-4 w-4" /> {opt.label}
                </button>
              ))}
            </div>

            {/* Quick amounts */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Quick amount
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {QUICK.map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={q > source}
                    onClick={() => setAmount(String(q))}
                    className={cn(
                      'rounded-xl border px-3 py-4 text-base font-bold tabular-nums transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-40',
                      Number(amount) === q
                        ? 'border-violet bg-violet/10 text-violet shadow-glow-sm'
                        : 'border-black/10 bg-white/60 text-foreground hover:border-violet/40 hover:-translate-y-0.5',
                    )}
                  >
                    ₹{q.toLocaleString('en-US')}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom amount */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Amount
                </p>
                <button
                  type="button"
                  onClick={() => setAmount(String(source))}
                  disabled={source <= 0}
                  className="text-xs font-semibold text-violet hover:underline disabled:opacity-40"
                >
                  Max
                </button>
              </div>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-mono text-base font-bold text-muted-foreground">
                  ₹
                </span>
                <Input
                  inputMode="numeric"
                  placeholder="Enter amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
                  className="h-14 pl-9 font-mono text-lg"
                />
              </div>
              {exceeds ? (
                <p className="text-sm text-destructive">
                  Amount exceeds your {dir === 'toVault' ? 'wallet' : 'vault'} balance of ₹
                  {source.toLocaleString('en-US')}.
                </p>
              ) : null}
            </div>

            <Button
              variant="gradient"
              size="xl"
              className="sheen h-14 w-full text-base"
              disabled={!canSubmit}
              onClick={submit}
            >
              <ArrowRightLeft className="h-5 w-5" /> Transfer{' '}
              {canSubmit ? `₹${Math.floor(value).toLocaleString('en-US')}` : ''}{' '}
              {dir === 'toVault' ? 'to Vault' : 'to Wallet'}
            </Button>
          </div>
        </div>

        {/* RIGHT — info cards */}
        <aside className="space-y-4">
          <WalletInfoCard
            icon={ShieldCheck}
            tone="text-violet"
            title="Set funds aside"
            desc="The vault keeps money separate from your playable wallet balance."
          />
          <WalletInfoCard
            icon={Zap}
            tone="text-primary"
            title="Instant transfers"
            desc="Moves apply immediately and sync across the whole platform."
          />
          <WalletInfoCard
            icon={Info}
            tone="text-accent"
            title="Demo mode"
            desc="DEMO FUNDS. Play-money for testing only — stored in this browser, never on the server, and never withdrawable."
          />
          <WalletInfoCard icon={Lightbulb} tone="text-gold" title="Vault tips">
            <ul className="mt-1 space-y-1.5 text-sm text-muted-foreground">
              <li>• Only wallet funds can be bet — vault funds are safe.</li>
              <li>• Move money back to your wallet any time to play.</li>
              <li>• This is play-money. It is not real currency and cannot be withdrawn.</li>
            </ul>
          </WalletInfoCard>
        </aside>
      </div>
    </section>
  );
}
