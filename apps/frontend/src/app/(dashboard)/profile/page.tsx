'use client';

/**
 * Player account center (Phase 2C.10) — mobile-first, server-authoritative. Replaces the former
 * demo-wallet/demo-profile page. Identity comes from the authenticated session (`authApi.me` via the
 * auth store); the balance is the authoritative MAIN wallet. Sections link to the existing production
 * surfaces (wallet, cashier, history, security) plus verification, responsible gaming and support.
 * No demo wallet, no demo auth. Fits 375/390/412.
 */
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  BadgeCheck, CreditCard, HeartHandshake, History, IdCard, LifeBuoy, LogOut, Shield, ShieldOff, User, Wallet,
} from 'lucide-react';

import { AccountRow } from '@/components/account/AccountRow';
import { RealAccountRequired } from '@/components/auth/real-money-guard';
import { useRealSession } from '@/hooks/use-real-session';
import { getMainWallet } from '@/lib/account-api';
import { authApi } from '@/lib/auth-api';
import { logoutSession } from '@/lib/auth-session';
import { useAuthStore } from '@/stores/auth-store';

function statusDot(status?: string): string {
  if (status === 'ACTIVE') return '#0f7a4a';
  if (status === 'SUSPENDED' || status === 'BANNED' || status === 'CLOSED') return '#b42318';
  return '#8a5300';
}

export default function ProfilePage() {
  const router = useRouter();
  const storeUser = useAuthStore((s) => s.user);
  // Identity + balance are user-scoped: a demo session has no backend account to read.
  const realSession = useRealSession();
  const meQ = useQuery({ queryKey: ['account', 'me'], queryFn: authApi.me, initialData: storeUser ?? undefined, staleTime: 30_000, enabled: realSession });
  const walletQ = useQuery({ queryKey: ['account', 'wallet'], queryFn: getMainWallet, enabled: realSession });
  const user = meQ.data;

  const logout = async () => { await logoutSession(); router.replace('/login'); };
  const logoutAll = async () => { try { await authApi.logoutAll(); } finally { await logoutSession(); router.replace('/login'); } };

  const initial = (user?.displayName || user?.username || user?.email || '?').charAt(0).toUpperCase();

  if (!realSession) return <RealAccountRequired />;

  return (
    <div style={{ color: '#1b1f37', maxWidth: 480, margin: '0 auto', padding: '12px 12px 28px', boxSizing: 'border-box' }}>
      {/* identity header */}
      <section style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '4px 2px 14px' }}>
        <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'linear-gradient(140deg,#7c3aed,#0369a1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, fontWeight: 900, color: 'white' }}>{initial}</div>
        <div style={{ minWidth: 0 }}>
          <div data-testid="account-name" style={{ fontSize: 19, fontWeight: 800 }}>{user?.displayName || user?.username || '—'}</div>
          <div style={{ fontSize: 13, color: '#515970', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email ?? ''}</div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusDot(user?.status) }} />
            <span style={{ opacity: 0.8 }}>{user?.status ?? '—'}</span>
          </div>
        </div>
      </section>

      {/* wallet snapshot */}
      <section style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px', borderRadius: 14, background: 'linear-gradient(150deg,#e8efff,#ebeef5)', border: '1px solid #ccd2e0' }}>
          <div>
            <div style={{ fontSize: 12, color: '#515970' }}>Balance</div>
            <b data-testid="balance" style={{ fontSize: 24, color: '#0f7a4a', fontWeight: 900 }}>{walletQ.data ? `₹${walletQ.data.available}` : '—'}</b>
          </div>
          <a href="/wallet" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderRadius: 999, background: '#7c3aed', color: 'white', fontWeight: 800, fontSize: 14, textDecoration: 'none' }}><Wallet size={15} /> Wallet</a>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <a href="/deposit" style={quick('#0369a1')}>Deposit</a>
          <a href="/withdraw" style={quick('#ebeef5', '#1b1f37')}>Withdraw</a>
          <a href="/transactions" style={quick('#ebeef5', '#1b1f37')}>Transactions</a>
        </div>
      </section>

      <Group title="Account">
        <AccountRow icon={User} label="Personal details" sublabel={user ? `@${user.username}` : undefined} href="/wallet" testId="row-personal" />
        <AccountRow icon={IdCard} label="Verification" sublabel="Email · phone · identity" href="/verification" testId="row-verification" />
        <AccountRow icon={Shield} label="Security" sublabel="Password · 2FA · sessions" href="/settings/security" testId="row-security" />
        <AccountRow icon={History} label="Game history" href="/game-history" testId="row-history" />
        <AccountRow icon={CreditCard} label="Wallet history" href="/wallet/history" testId="row-wallet-history" />
      </Group>

      <Group title="Responsible gaming">
        <AccountRow icon={HeartHandshake} label="Responsible gaming" sublabel="Play safe · self-monitoring" href="/responsible-gaming" testId="row-rg" />
      </Group>

      <Group title="Help">
        <AccountRow icon={LifeBuoy} label="Help & support" sublabel="FAQ · contact" href="/support" testId="row-support" />
        <AccountRow icon={BadgeCheck} label="Notifications" href="/notifications" testId="row-notifications" />
      </Group>

      <Group title="Session">
        <AccountRow icon={LogOut} label="Log out" tone="danger" onClick={() => void logout()} testId="row-logout" />
        <AccountRow icon={ShieldOff} label="Log out all devices" sublabel="Ends every active session" tone="danger" onClick={() => void logoutAll()} testId="row-logout-all" />
      </Group>

      <p style={{ fontSize: 11, color: '#626a7e', textAlign: 'center', marginTop: 12 }}>
        Member since {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'} · account data is server-authoritative.
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

/**
 * A quick action. `fg` is explicit rather than always white: a secondary action sits on a light
 * surface, where white text would be invisible (this shipped at 1.80:1 before Phase 2D.14).
 */
function quick(bg: string, fg = 'white'): React.CSSProperties {
  return { flex: 1, textAlign: 'center', padding: '11px', borderRadius: 12, background: bg, color: fg, fontWeight: 700, fontSize: 13, textDecoration: 'none' };
}
