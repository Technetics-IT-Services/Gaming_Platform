'use client';

/**
 * Referral (P-17) — attribution, honestly scoped.
 *
 * Everything here is real server state: the player's own code, who they referred, and who referred
 * them. There is **no earnings figure anywhere**, because reward qualification and amounts are
 * undefined business rules — the page shows the server's stated reason rather than ₹0, which would
 * imply a reward had been calculated and found to be nothing.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { referralApi, type ReferralStatus } from '@/lib/referral-api';

const PANEL: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #ccd2e0', borderRadius: 14, padding: 14,
};
const FIELD: React.CSSProperties = {
  minHeight: 44, padding: '10px', borderRadius: 10, border: '1px solid #b9c1d4',
  background: '#ebeef5', color: '#1b1f37', fontSize: 14, width: '100%', boxSizing: 'border-box',
};

const STATUS_COLOR: Record<ReferralStatus, string> = {
  PENDING: '#8a5300', QUALIFIED: '#1d4ed8', REWARDED: '#0f7a4a',
  EXPIRED: '#515970', CANCELLED: '#515970',
};

const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');

export default function ReferralPage() {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const me = useQuery({ queryKey: ['referral', 'me'], queryFn: referralApi.me });

  const claim = useMutation({
    mutationFn: () => referralApi.claim(code.trim()),
    onSuccess: (r) => {
      setCode('');
      setNotice(r.alreadyClaimed
        ? `You were already referred by ${r.referredBy}.`
        : `Recorded — you were referred by ${r.referredBy}.`);
      qc.invalidateQueries({ queryKey: ['referral', 'me'] });
    },
    onError: () => setNotice(null),
  });

  const d = me.data;
  const shareLink = d?.code && typeof window !== 'undefined'
    ? `${window.location.origin}/register?ref=${encodeURIComponent(d.code)}`
    : null;

  return (
    <div
      data-testid="referral-page"
      style={{
        color: '#1b1f37', width: '100%', maxWidth: 480, minWidth: 0,
        margin: '0 auto', padding: '12px 12px 28px', boxSizing: 'border-box',
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 2px 6px' }}>Refer a friend</h1>
      <p style={{ fontSize: 12, color: '#515970', margin: '0 2px 14px', lineHeight: 1.5 }}>
        Share your code so we can record who introduced whom.
      </p>

      {me.isLoading ? (
        <div data-testid="referral-loading" style={{ ...PANEL, height: 110 }} />
      ) : me.isError ? (
        <div data-testid="referral-error" role="alert" style={{ ...PANEL, borderColor: '#f0b4b0', color: '#b42318' }}>
          Could not load your referral details. Please try again.
        </div>
      ) : d ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {/* --------------------------------------------------- my code */}
          <section data-testid="referral-code-panel" style={{ ...PANEL, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: '#515970' }}>Your referral code</div>
            <div
              data-testid="referral-code"
              style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1, marginTop: 4, overflowWrap: 'anywhere' }}
            >
              {d.code ?? '—'}
            </div>
            {shareLink ? (
              <div data-testid="referral-link" style={{ fontSize: 11, color: '#515970', marginTop: 8, overflowWrap: 'anywhere' }}>
                {shareLink}
              </div>
            ) : null}
          </section>

          {/* ----------------------------------------------- claim a code */}
          {!d.referredBy ? (
            <section data-testid="referral-claim" style={{ ...PANEL, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>Were you referred?</div>
              <p style={{ fontSize: 11, color: '#515970', margin: '0 0 10px', lineHeight: 1.5 }}>
                Enter their code once. It cannot be changed afterwards.
              </p>
              <input
                data-testid="referral-code-input"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="FRIEND CODE"
                style={FIELD}
              />
              <button
                data-testid="referral-claim-submit"
                onClick={() => claim.mutate()}
                disabled={code.trim().length < 4 || claim.isPending}
                style={{ ...FIELD, marginTop: 10, fontWeight: 700, cursor: 'pointer',
                         border: '1px solid #86c9a6', background: '#e6f6ee',
                         opacity: code.trim().length < 4 ? 0.6 : 1 }}
              >
                {claim.isPending ? 'Saving…' : 'Apply code'}
              </button>
              {claim.isError ? (
                <p data-testid="referral-claim-error" role="alert" style={{ fontSize: 12, color: '#b42318', margin: '8px 0 0' }}>
                  That code could not be applied. Nothing was saved.
                </p>
              ) : null}
            </section>
          ) : (
            <section data-testid="referral-referred-by" style={{ ...PANEL, minWidth: 0 }}>
              <div style={{ fontSize: 13 }}>
                You were referred by <strong style={{ overflowWrap: 'anywhere' }}>{d.referredBy.username}</strong>
              </div>
              <div style={{ fontSize: 11, color: '#515970', marginTop: 4 }}>
                since {new Date(d.referredBy.since).toLocaleDateString()}
              </div>
            </section>
          )}

          {notice ? (
            <span data-testid="referral-notice" role="status" style={{ fontSize: 12, color: '#0f7a4a' }}>{notice}</span>
          ) : null}

          {/* --------------------------------------------- my referrals */}
          <section style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 14, fontWeight: 800, margin: '0 2px 8px' }}>
              People you referred ({d.totalReferred})
            </h2>
            {d.referrals.length === 0 ? (
              <div data-testid="referral-empty" style={{ ...PANEL, fontSize: 13, color: '#515970' }}>
                Nobody has used your code yet.
              </div>
            ) : (
              <ul data-testid="referral-list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {d.referrals.map((r) => (
                  <li key={r.id} style={{ ...PANEL, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 13, overflowWrap: 'anywhere', minWidth: 0 }}>{r.referredUsername}</strong>
                      <span style={{ fontSize: 11, color: STATUS_COLOR[r.status], whiteSpace: 'nowrap' }}>
                        {label(r.status)}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#626a7e', marginTop: 4 }}>
                      joined {new Date(r.createdAt).toLocaleDateString()}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ------------------------------------------------ honest gaps */}
          {d.unavailable.length > 0 ? (
            <section data-testid="referral-unavailable" style={{ ...PANEL, borderColor: '#fff7e6', minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#8a5300', marginBottom: 6 }}>
                Rewards are not available yet
              </div>
              <p style={{ fontSize: 11, color: '#515970', margin: '0 0 8px', lineHeight: 1.5 }}>
                We record who referred whom. We deliberately do not show an earnings figure, because no
                reward has been calculated — a zero would be misleading.
              </p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, lineHeight: 1.6, color: '#515970' }}>
                {d.unavailable.map((u) => (
                  <li key={u.metric} style={{ overflowWrap: 'anywhere' }}>{u.reason}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
