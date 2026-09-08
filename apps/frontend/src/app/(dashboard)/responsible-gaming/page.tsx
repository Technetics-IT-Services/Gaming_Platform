'use client';

/**
 * Responsible Gaming — REAL, server-enforced controls.
 *
 * Phase 2C.10 shipped this page as honest self-monitoring only, because no server-side enforcement
 * existed: it said so plainly rather than faking compliance. That gap is now closed. Deposit, wager
 * and loss limits, cooling-off and self-exclusion are persisted server-side and enforced by a guard
 * that runs BEFORE any money or game action, ahead of the frozen money core.
 *
 * Nothing on this page is a client-side check. The self-monitoring tools below remain, because
 * seeing your own history is still part of playing responsibly.
 */
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Activity, BookOpen, Clock, History, LifeBuoy, ShieldOff, Wallet } from 'lucide-react';

import { AccountRow } from '@/components/account/AccountRow';
import { ResponsibleGamingControls } from '@/components/account/responsible-gaming-controls';
import { getCashierConfig } from '@/lib/cashier-api';

export default function ResponsibleGamingPage() {
  const cfg = useQuery({ queryKey: ['rg', 'cashier-config'], queryFn: getCashierConfig, staleTime: 300_000 });

  return (
    <div style={{ color: '#1b1f37', maxWidth: 480, margin: '0 auto', padding: '12px 12px 28px', boxSizing: 'border-box' }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 2px 6px' }}>Responsible gaming</h1>
      <p style={{ fontSize: 13, color: '#515970', margin: '0 2px 14px', lineHeight: 1.5 }}>
        Play for entertainment, set your own budget, and take breaks. Your limits are enforced by our
        servers before any deposit or bet — not by this page.
      </p>

      <ResponsibleGamingControls />

      <div style={{ height: 18 }} />

      <Group title="Self-monitoring (available now)">
        <AccountRow icon={History} label="Game history" sublabel="Review every real-money round" href="/game-history" testId="rg-game-history" />
        <AccountRow icon={Activity} label="Transactions" sublabel="Deposits, withdrawals, bets & wins" href="/transactions" testId="rg-transactions" />
        <AccountRow icon={Wallet} label="Wallet" sublabel="Your authoritative balance" href="/wallet" testId="rg-wallet" />
      </Group>

      <Group title="Cashier limits (platform)">
        <div data-testid="rg-limits" style={{ padding: '14px', borderRadius: 12, background: '#ffffff', border: '1px solid #ccd2e0', fontSize: 13 }}>
          {cfg.data ? (
            <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.8, opacity: 0.85 }}>
              <li>Deposit: ₹{cfg.data.minDeposit} – ₹{cfg.data.maxDeposit} per request</li>
              <li>Withdrawal: ₹{cfg.data.minWithdrawal} – ₹{cfg.data.maxWithdrawal} per request</li>
            </ul>
          ) : (
            <span style={{ color: '#515970' }}>Loading limits…</span>
          )}
          <p style={{ fontSize: 12, color: '#626a7e', marginTop: 8, marginBottom: 0 }}>These are platform limits enforced by the server on every request.</p>
        </div>
      </Group>

      <Group title="Not currently available">
        <div data-testid="rg-unavailable" style={{ padding: '14px', borderRadius: 12, background: '#ebeef5', border: '1px dashed #b9c1d4', fontSize: 13, opacity: 0.8, lineHeight: 1.6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><ShieldOff size={16} color="#515970" /> <b>Session-time limits</b></div>
          A time-based session limit is not offered, because session duration is not measured
          accurately enough to enforce one honestly. Deposit, wager and loss limits, cooling-off and
          self-exclusion ARE enforced — they are above. We still will not display a control the
          server cannot enforce.
        </div>
      </Group>

      <Group title="Get help">
        <AccountRow icon={LifeBuoy} label="Contact support" href="/support" testId="rg-support" />
        <AccountRow icon={BookOpen} label="Playing responsibly" sublabel="Tips for staying in control" onClick={() => undefined} right={<Clock size={16} color="#515970" />} testId="rg-tips" />
      </Group>

      <p style={{ fontSize: 11, color: '#626a7e', textAlign: 'center', marginTop: 10 }}>
        If gambling stops being fun, take a break. <Link href="/support" style={{ color: '#1d4ed8' }}>Reach out to support</Link>.
      </p>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: '#626a7e', margin: '0 4px 8px' }}>{title}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </section>
  );
}
