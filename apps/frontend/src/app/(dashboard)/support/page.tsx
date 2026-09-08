'use client';

/**
 * Help & Support.
 *
 * Phase 2C.10 shipped this as a static page that honestly said it could not file tickets, because no
 * ticket backend existed. That gap is now closed: real, persisted tickets live at
 * `/support/tickets`, and this page links to them alongside the FAQ and any configured direct
 * contact channel. Mobile-first.
 */
import Link from 'next/link';
import { Mail, MessageCircleQuestion, Phone } from 'lucide-react';
import { settingsApi } from '@/lib/settings-api';
import { useQuery } from '@tanstack/react-query';

/**
 * Contact channels now come from SERVER settings (AD-09), not build-time env vars, so an operator
 * can change them without a redeploy. The env values remain a fallback for a deployment that has
 * not set them yet.
 */
const ENV_SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim();
const ENV_SUPPORT_PHONE = process.env.NEXT_PUBLIC_SUPPORT_PHONE?.trim();

const FAQ: { q: string; a: string; href?: string; hrefLabel?: string }[] = [
  { q: 'How do I add funds?', a: 'Open Wallet → Deposit, choose an amount, and submit. Deposits are reviewed and confirmed by an operator; your balance updates once the deposit is completed.', href: '/deposit', hrefLabel: 'Go to Deposit' },
  { q: 'How do withdrawals work?', a: 'Open Wallet → Withdraw and submit an amount. The funds are placed on hold immediately and released after review. You can cancel a pending withdrawal to get the funds back.', href: '/withdraw', hrefLabel: 'Go to Withdraw' },
  { q: 'Where can I see my activity?', a: 'Transactions shows every deposit, withdrawal, bet and win with balances; Game history shows every real-money round.', href: '/transactions', hrefLabel: 'View transactions' },
  { q: 'Is my balance real-time?', a: 'Yes. Your balance is always the server-authoritative value; it updates after every deposit, withdrawal and game round.' },
  { q: 'How do I secure my account?', a: 'Open Security to change your password, enable two-factor authentication, and review or end active sessions.', href: '/settings/security', hrefLabel: 'Open Security' },
  { q: 'How do I play responsibly?', a: 'Use Game history and Transactions to monitor your play, and set a personal budget. See the Responsible gaming page.', href: '/responsible-gaming', hrefLabel: 'Responsible gaming' },
];

export default function SupportPage() {
  const settings = useQuery({
    queryKey: ['settings', 'public'],
    queryFn: settingsApi.publicSettings,
    staleTime: 300_000,
  });
  const SUPPORT_EMAIL = String(settings.data?.['platform.support_email'] ?? '').trim() || ENV_SUPPORT_EMAIL;
  const SUPPORT_PHONE = String(settings.data?.['platform.support_phone'] ?? '').trim() || ENV_SUPPORT_PHONE;
  const maintenanceOn = settings.data?.['platform.maintenance_banner_enabled'] === true;
  const maintenanceMsg = String(settings.data?.['platform.maintenance_banner_message'] ?? '').trim();

  return (
    <div style={{ color: '#1b1f37', maxWidth: 480, margin: '0 auto', padding: '12px 12px 28px', boxSizing: 'border-box' }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 2px 12px' }}>Help &amp; support</h1>

      {maintenanceOn && maintenanceMsg ? (
        <div
          data-testid="maintenance-banner"
          role="status"
          style={{ padding: '12px 14px', borderRadius: 12, border: '1px solid #fff7e6',
                   background: '#fff7e6', color: '#8a5300', fontSize: 13, lineHeight: 1.5,
                   marginBottom: 14, overflowWrap: 'anywhere' }}
        >
          {maintenanceMsg}
        </div>
      ) : null}

      {/* Real, persisted tickets — the primary support channel. */}
      <section style={{ marginBottom: 18 }}>
        <Link
          data-testid="support-tickets-link"
          href="/support/tickets"
          style={{
            display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: '12px 14px',
            borderRadius: 12, border: '1px solid #86c9a6', background: '#e6f6ee',
            color: '#1b1f37', textDecoration: 'none', fontWeight: 700,
          }}
        >
          <MessageCircleQuestion size={18} />
          <span>My support tickets</span>
        </Link>
        <p style={{ fontSize: 11, color: '#515970', margin: '8px 4px 0', lineHeight: 1.5 }}>
          Open a ticket and our team replies in the app. Only you and our agents can see it.
        </p>
      </section>

      {/* contact */}
      <section style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: '#626a7e', margin: '0 4px 8px' }}>Contact</h2>
        {SUPPORT_EMAIL || SUPPORT_PHONE ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {SUPPORT_EMAIL && (
              <a data-testid="support-email" href={`mailto:${SUPPORT_EMAIL}`} style={contactRow}><Mail size={17} color="#1d4ed8" /><span style={{ fontWeight: 700 }}>{SUPPORT_EMAIL}</span></a>
            )}
            {SUPPORT_PHONE && (
              <a data-testid="support-phone" href={`tel:${SUPPORT_PHONE}`} style={contactRow}><Phone size={17} color="#1d4ed8" /><span style={{ fontWeight: 700 }}>{SUPPORT_PHONE}</span></a>
            )}
          </div>
        ) : (
          <div data-testid="support-none" style={{ padding: '14px', borderRadius: 12, background: '#ebeef5', border: '1px dashed #b9c1d4', fontSize: 13, opacity: 0.8 }}>
            Direct contact options are not configured for this environment yet. Please use the FAQ below, or check back soon.
          </div>
        )}
      </section>

      {/* FAQ */}
      <section>
        <h2 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: '#626a7e', margin: '0 4px 8px' }}>FAQ</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {FAQ.map((f, i) => (
            <details key={i} data-testid={`faq-${i}`} style={{ background: '#ffffff', border: '1px solid #ccd2e0', borderRadius: 12, padding: '12px 14px' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 14, listStyle: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
                <MessageCircleQuestion size={16} color="#1d4ed8" /> {f.q}
              </summary>
              <p style={{ fontSize: 13, opacity: 0.8, lineHeight: 1.55, margin: '10px 0 0' }}>{f.a}</p>
              {f.href && <Link href={f.href} style={{ display: 'inline-block', marginTop: 8, color: '#1d4ed8', fontSize: 13, fontWeight: 700 }}>{f.hrefLabel} →</Link>}
            </details>
          ))}
        </div>
      </section>

      <p style={{ fontSize: 11, color: '#626a7e', textAlign: 'center', marginTop: 16 }}>We’re here to help you play safely.</p>
    </div>
  );
}

const contactRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '14px', borderRadius: 12, background: '#ffffff', border: '1px solid #ccd2e0', color: '#1b1f37', textDecoration: 'none' };
