'use client';

/**
 * Verification (Phase 2C.10) — REAL state only from `GET /users/me/verification` (email/phone flags +
 * latest KYC record). Where identity verification has not been submitted, it says so truthfully. No
 * fake verified state, no compliance claim. Mobile-first.
 */
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, Mail, Phone, ShieldQuestion, XCircle } from 'lucide-react';

import { RealAccountRequired } from '@/components/auth/real-money-guard';
import { useRealSession } from '@/hooks/use-real-session';
import { getVerification } from '@/lib/account-api';
import { KycSubmission } from '@/components/account/kyc-submission';

function Badge({ state }: { state: 'verified' | 'pending' | 'unverified' | 'unavailable' }) {
  const map = {
    verified: { c: '#0f7a4a', t: 'Verified', I: CheckCircle2 },
    pending: { c: '#8a5300', t: 'Pending', I: Clock },
    unverified: { c: '#b42318', t: 'Not verified', I: XCircle },
    unavailable: { c: '#515970', t: 'Unavailable', I: ShieldQuestion },
  }[state];
  const I = map.I;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 800, color: map.c }}><I size={15} /> {map.t}</span>;
}

export default function VerificationPage() {
  // Verification is user-scoped (`GET /users/me/verification`): a demo session has no real account.
  const realSession = useRealSession();
  const q = useQuery({ queryKey: ['account', 'verification'], queryFn: getVerification, enabled: realSession });
  const v = q.data;

  if (!realSession) return <RealAccountRequired />;

  return (
    <div style={{ color: '#1b1f37', maxWidth: 480, margin: '0 auto', padding: '12px 12px 28px', boxSizing: 'border-box' }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 2px 12px' }}>Verification</h1>

      {q.isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{Array.from({ length: 3 }, (_, i) => <div key={i} style={{ height: 62, borderRadius: 12, background: '#ffffff', border: '1px solid #ccd2e0' }} />)}</div>
      ) : q.isError ? (
        <div data-testid="error" style={{ color: '#b42318', fontSize: 14 }}>Could not load verification status.</div>
      ) : v ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Item icon={Mail} title="Email" sub="Used for login & security alerts" badge={<Badge state={v.email.verified ? 'verified' : 'unverified'} />} testId="ver-email" />
          <Item icon={Phone} title="Phone" sub={v.phone.hasPhone ? 'On file' : 'No phone number added'} badge={<Badge state={!v.phone.hasPhone ? 'unavailable' : v.phone.verified ? 'verified' : 'unverified'} />} testId="ver-phone" />
          <Item
            icon={ShieldQuestion}
            title="Identity"
            sub={v.identity.available ? `Level ${v.identity.level ?? '—'}` : 'Identity verification is not currently available.'}
            badge={<Badge state={!v.identity.available ? 'unavailable' : v.identity.status === 'APPROVED' || v.identity.status === 'VERIFIED' ? 'verified' : v.identity.status === 'REJECTED' ? 'unverified' : 'pending'} />}
            testId="ver-identity"
          />

        </div>
      ) : null}

      {/* The real, server-decided KYC submission and review flow. */}
      <div style={{ marginTop: 18 }}>
        <KycSubmission />
      </div>

      <p style={{ fontSize: 12, color: '#626a7e', marginTop: 16, lineHeight: 1.5 }}>
        Verification status reflects your real account state. Identity (KYC) submissions are reviewed by
        our compliance team — this screen never marks you verified on its own.
      </p>
    </div>
  );
}

function Item({ icon: Icon, title, sub, badge, testId }: { icon: typeof Mail; title: string; sub: string; badge: React.ReactNode; testId: string }) {
  return (
    <div data-testid={testId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px', borderRadius: 12, background: '#ffffff', border: '1px solid #ccd2e0' }}>
      <span style={{ display: 'inline-flex', width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 9, background: '#ebeef5', border: '1px solid #ccd2e0' }}><Icon size={17} color="#1d4ed8" /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 12, color: '#626a7e' }}>{sub}</div>
      </div>
      {badge}
    </div>
  );
}
