'use client';

/**
 * Partner overview — the partner's own organisation.
 *
 * Every value comes from `GET /partner/dashboard`, which the server scopes to the authenticated
 * caller. No route takes a partner id, so one partner cannot address another (verified live).
 *
 * THE RULE THIS PAGE ENFORCES: profit, balance and withdrawals are **not** shown as ₹0. They render
 * the server's stated reason, because the blocker is a missing business definition — not a zero.
 */
import { useQuery } from '@tanstack/react-query';

import { partnerApi, type PartnerStatus } from '@/lib/partner-api';

const PANEL: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #ccd2e0', borderRadius: 14, padding: 14,
};

const STATUS_COLOR: Record<PartnerStatus, string> = {
  PENDING: '#8a5300', ACTIVE: '#0f7a4a', SUSPENDED: '#be185d', TERMINATED: '#515970',
};

const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');

export default function PartnerOverviewPage() {
  const dash = useQuery({ queryKey: ['partner', 'dashboard'], queryFn: partnerApi.dashboard });
  // PA-07: the partner's own recorded history. Ownership-isolated by the server — this call
  // sends no partner id, because there is no route that would accept one.
  const report = useQuery({ queryKey: ['partner', 'report'], queryFn: () => partnerApi.report({ limit: 100 }) });
  // The caller's own colleagues. Usernames only — the server returns no user ids.
  const members = useQuery({ queryKey: ['partner', 'members'], queryFn: partnerApi.members });
  const d = dash.data;

  return (
    <div
      data-testid="partner-overview"
      style={{
        color: '#1b1f37', width: '100%', maxWidth: 900, minWidth: 0,
        margin: '0 auto', padding: '4px 0 28px', boxSizing: 'border-box',
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 2px 4px' }}>Partner overview</h1>
      <p style={{ fontSize: 12, color: '#515970', margin: '0 2px 16px', lineHeight: 1.5 }}>
        Your organisation as recorded by the platform. Figures we cannot yet calculate are named
        below rather than shown as zero.
      </p>

      {dash.isLoading ? (
        <div data-testid="partner-loading" style={{ ...PANEL, height: 120 }} />
      ) : dash.isError ? (
        <div data-testid="partner-error" role="alert" style={{ ...PANEL, borderColor: '#f0b4b0', color: '#b42318' }}>
          Could not load your partner details. Please retry — this does not mean your organisation is
          inactive.
        </div>
      ) : d ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {/* ------------------------------------------------------- identity */}
          <section data-testid="partner-identity" style={{ ...PANEL, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              {/* A long organisation name must wrap, never widen the page. */}
              <strong data-testid="partner-name" style={{ fontSize: 17, overflowWrap: 'anywhere', minWidth: 0 }}>
                {d.partner.name}
              </strong>
              <span
                data-testid="partner-status"
                style={{ fontSize: 12, fontWeight: 700, color: STATUS_COLOR[d.partner.status], whiteSpace: 'nowrap' }}
              >
                {label(d.partner.status)}
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#515970', marginTop: 6, overflowWrap: 'anywhere' }}>
              {d.partner.code} · joined {new Date(d.partner.createdAt).toLocaleDateString()}
            </div>
          </section>

          {/* --------------------------------------------------------- facts */}
          <section
            style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', minWidth: 0 }}
          >
            <Fact
              testId="partner-share"
              label="Revenue share"
              /* Rendered exactly as the server sent it. No parsing, no arithmetic, no currency —
                 this is a SHARE, not an amount. */
              value={`${d.partner.revenueSharePercent}%`}
              hint="Your agreed share of distributable net profit."
            />
            <Fact testId="partner-members" label="Team members" value={String(d.partner.memberCount)} />
            <Fact testId="partner-code" label="Partner code" value={d.partner.code} />
          </section>

          {/* ------------------------------------------------ members (PA-07) */}
          <section data-testid="partner-members-panel" style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 14, fontWeight: 800, margin: '0 2px 8px' }}>Your team</h2>
            {members.isLoading ? (
              <div data-testid="partner-members-loading" style={{ ...PANEL, height: 60 }} />
            ) : members.isError ? (
              <div data-testid="partner-members-error" role="alert" style={{ ...PANEL, borderColor: '#f0b4b0', color: '#b42318', fontSize: 12 }}>
                Could not load your team.
              </div>
            ) : members.data && members.data.length === 0 ? (
              <div data-testid="partner-members-empty" style={{ ...PANEL, fontSize: 12, color: '#515970' }}>
                No other members yet.
              </div>
            ) : members.data ? (
              <ul data-testid="partner-members-list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {members.data.map((m) => (
                  <li key={m.username} style={{ ...PANEL, minWidth: 0, display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 13, overflowWrap: 'anywhere', minWidth: 0 }}>{m.username}</strong>
                    <span style={{ fontSize: 11, color: '#515970', whiteSpace: 'nowrap' }}>
                      {m.isPrimary ? 'primary · ' : ''}since {new Date(m.joinedAt).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {/* ------------------------------------------- activity report (PA-07) */}
          <section data-testid="partner-report" style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 14, fontWeight: 800, margin: '0 2px 4px' }}>Activity report</h2>
            <p style={{ fontSize: 11, color: '#515970', margin: '0 2px 10px', lineHeight: 1.5 }}>
              Recorded changes to your organisation. This is not a financial report — see below for
              what the platform cannot yet produce.
            </p>

            {report.isLoading ? (
              <div data-testid="partner-report-loading" style={{ ...PANEL, height: 80 }} />
            ) : report.isError ? (
              <div data-testid="partner-report-error" role="alert" style={{ ...PANEL, borderColor: '#f0b4b0', color: '#b42318', fontSize: 12 }}>
                Could not load your activity report.
              </div>
            ) : report.data && report.data.events.length === 0 ? (
              <div data-testid="partner-report-empty" style={{ ...PANEL, fontSize: 12, color: '#515970' }}>
                No recorded changes in this period.
              </div>
            ) : report.data ? (
              <>
                <ul data-testid="partner-report-list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {report.data.events.map((e) => (
                    <li key={`${e.at}-${e.action}`} style={{ ...PANEL, minWidth: 0 }}>
                      <div style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{e.summary}</div>
                      <div style={{ fontSize: 10, color: '#626a7e', marginTop: 4 }}>
                        {new Date(e.at).toLocaleString()} · {e.action.toLowerCase()}
                      </div>
                    </li>
                  ))}
                </ul>
                {report.data.truncated ? (
                  <p data-testid="partner-report-truncated" style={{ fontSize: 11, color: '#8a5300', margin: '8px 2px 0' }}>
                    More changes exist than are shown here. Narrow the period to see the rest.
                  </p>
                ) : null}
              </>
            ) : null}
          </section>

          {/* ------------------------------------------------- honest gaps */}
          {d.unavailable.length > 0 ? (
            <section data-testid="partner-unavailable" style={{ ...PANEL, borderColor: '#fff7e6', minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#8a5300', marginBottom: 6 }}>
                Not available yet
              </div>
              <p style={{ fontSize: 11, color: '#515970', margin: '0 0 10px', lineHeight: 1.5 }}>
                These are deliberately not shown as zero. Each names exactly what is missing.
              </p>
              <dl style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>
                {d.unavailable.map((u) => (
                  <div key={u.metric} style={{ marginBottom: 8, minWidth: 0 }}>
                    <dt style={{ fontWeight: 700, opacity: 0.9 }}>{u.metric}</dt>
                    <dd style={{ margin: '0 0 0 10px', color: '#515970', overflowWrap: 'anywhere' }}>{u.reason}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Fact({ label: l, value, hint, testId }: { label: string; value: string; hint?: string; testId: string }) {
  return (
    <div data-testid={testId} style={{ ...PANEL, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: '#515970' }}>{l}</div>
      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4, overflowWrap: 'anywhere' }}>{value}</div>
      {hint ? <div style={{ fontSize: 10, color: '#626a7e', marginTop: 4, lineHeight: 1.5 }}>{hint}</div> : null}
    </div>
  );
}
