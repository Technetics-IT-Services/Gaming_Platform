'use client';

/**
 * Operator analytics dashboard (Phase 2D.6) — 100% server-backed, mobile-first.
 *
 * This page was a 24-line placeholder ("Charts render here once the Analytics module aggregates
 * platform data"). Every number below now comes from `GET /analytics/*`, which derives it from
 * authoritative tables. There is no demo data, no hardcoded figure, no random value, and no
 * client-side calculation.
 *
 * THE RULE THIS PAGE ENFORCES: a metric the platform cannot truthfully produce renders
 * **"Not available"** with the reason — never a fabricated `0`. Those metrics arrive from the server
 * in `meta.unavailable`.
 *
 * Financial figures are shown PER CURRENCY and are never summed together: there is no FX source.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useRealSession } from '@/hooks/use-real-session';
import {
  analyticsApi,
  type AnalyticsFilters,
  type CurrencyBucket,
  type UnavailableMetric,
} from '@/lib/analytics-api';

const PANEL: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #ccd2e0', borderRadius: 14, padding: 14,
};

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function AdminAnalyticsPage() {
  const realSession = useRealSession();
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const filters: AnalyticsFilters = { from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z` };

  const summary = useQuery({
    queryKey: ['analytics', 'summary', filters.from, filters.to],
    queryFn: () => analyticsApi.summary(filters),
    enabled: realSession,
  });
  const daily = useQuery({
    queryKey: ['analytics', 'daily', filters.from, filters.to],
    queryFn: () => analyticsApi.daily(filters),
    enabled: realSession,
  });
  const engagement = useQuery({
    queryKey: ['analytics', 'engagement', filters.from, filters.to],
    queryFn: () => analyticsApi.engagement(filters),
    enabled: realSession,
  });

  const d = summary.data;
  // The engagement endpoint carries its own reasons (retention, LTV, session, bounce, coverage);
  // they belong in the same honest list rather than in a second, easily-missed place.
  const unavailable: UnavailableMetric[] = [
    ...(d?.meta.unavailable ?? []),
    ...(engagement.data?.unavailable ?? []),
  ].filter((u, i, all) => all.findIndex((x) => x.metric === u.metric) === i);

  return (
    <div
      data-testid="admin-analytics"
      // `minWidth: 0` matters: this sits inside the admin flex shell, and a flex item defaults to
      // `min-width: auto`, so without it a wide table would push the whole PAGE sideways instead of
      // scrolling inside its own container. Measured at 594px vs a 390px viewport before this.
      style={{ color: '#1b1f37', width: '100%', maxWidth: 1100, minWidth: 0, margin: '0 auto', padding: '4px 0 28px', boxSizing: 'border-box' }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 2px 4px' }}>Analytics</h1>
      <p style={{ fontSize: 12, color: '#515970', margin: '0 2px 14px' }}>
        Derived from platform data. All times UTC. Amounts are shown per currency and are never combined.
      </p>

      {/* filters — stack on a phone, inline from tablet up */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 150px' }}>
          <span style={{ fontSize: 11, color: '#515970' }}>From (UTC)</span>
          <input
            data-testid="analytics-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            style={{ minHeight: 44, padding: '0 10px', borderRadius: 10, border: '1px solid #b9c1d4', background: '#ebeef5', color: '#1b1f37', fontSize: 14 }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 150px' }}>
          <span style={{ fontSize: 11, color: '#515970' }}>To (UTC)</span>
          <input
            data-testid="analytics-to" type="date" value={to} onChange={(e) => setTo(e.target.value)}
            style={{ minHeight: 44, padding: '0 10px', borderRadius: 10, border: '1px solid #b9c1d4', background: '#ebeef5', color: '#1b1f37', fontSize: 14 }}
          />
        </label>
      </div>

      {!realSession ? (
        <div style={PANEL}>Analytics require a real signed-in operator account.</div>
      ) : summary.isLoading ? (
        <div data-testid="analytics-loading" style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
          {Array.from({ length: 8 }, (_, i) => <div key={i} style={{ ...PANEL, height: 78 }} />)}
        </div>
      ) : summary.isError ? (
        <div data-testid="analytics-error" role="alert" style={{ ...PANEL, borderColor: '#f0b4b0', color: '#b42318' }}>
          Could not load analytics. The range may be invalid or too large (maximum 366 days).
        </div>
      ) : d ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          <Section title="Users">
            <Stat label="Registered" value={d.users.registered} />
            <Stat label="Email verified" value={d.users.emailVerified} />
            <Stat label="Played (in range)" value={d.users.playedInRange} />
            <Stat label="Deposited (in range)" value={d.users.depositedInRange} />
            <Stat label="Withdrew (in range)" value={d.users.withdrewInRange} />
            <Stat label="Logged in (in range)" value={d.users.loggedInInRange} hint="Login events — not DAU" />
            <Stat
              label="Deposit conversion"
              value={d.users.depositConversionRate === null ? null : `${(d.users.depositConversionRate * 100).toFixed(2)}%`}
              hint="Depositors ÷ registered. Not marketing conversion."
            />
          </Section>

          <Section title="Gaming">
            <Stat label="Rounds" value={d.gaming.roundsTotal} />
            <Stat label="Settled rounds" value={d.gaming.settledRounds} hint="SETTLED + RECOVERED + RESOLVED" />
            <Stat label="Wins" value={d.gaming.outcomes.wins} />
            <Stat label="Losses" value={d.gaming.outcomes.losses} />
            <Stat label="Ties" value={d.gaming.outcomes.ties} />
          </Section>

          <CurrencySection title="Stake volume (game-level)" buckets={d.gaming.stakeByCurrency} />
          <CurrencySection title="Payout volume (game-level)" buckets={d.gaming.payoutByCurrency} />
          <CurrencySection title="Average stake" buckets={d.gaming.averageStakeByCurrency} />

          <Section title="Payout / stake ratio">
            {d.gaming.payoutToStakeRatio.length === 0 ? (
              <Stat label="—" value={null} hint="No settled rounds in range" />
            ) : (
              d.gaming.payoutToStakeRatio.map((r) => (
                <Stat key={r.currency} label={r.currency} value={r.ratio === null ? null : r.ratio.toFixed(4)} hint={r.ratio === null ? 'No stake in range' : undefined} />
              ))
            )}
          </Section>

          <Section title="Top games">
            {d.gaming.topGames.length === 0 ? <Stat label="—" value={null} /> : d.gaming.topGames.slice(0, 8).map((g) => (
              <Stat key={g.gameKey} label={g.gameKey} value={g.rounds} />
            ))}
          </Section>

          <TableSection
            title="Money movement by type (ledger-level)"
            note="From wallet transactions. A single interactive round can produce several movements, so these totals are NOT the same measure as game-level stake/payout."
            head={['Type', 'Currency', 'Count', 'Total']}
            rows={d.financial.transactionsByType.map((t) => [t.type, t.currency, String(t.count), t.total])}
          />
          <TableSection
            title="Deposits by status"
            head={['Status', 'Currency', 'Count', 'Total']}
            rows={d.financial.depositsByStatus.map((r) => [r.status, r.currency, String(r.count), r.total])}
          />
          <TableSection
            title="Withdrawals by status"
            head={['Status', 'Currency', 'Count', 'Total']}
            rows={d.financial.withdrawalsByStatus.map((r) => [r.status, r.currency, String(r.count), r.total])}
          />

          <Section title="Operations">
            <Stat label="Pending deposits" value={d.financial.pendingCashier.deposits} />
            <Stat label="Pending withdrawals" value={d.financial.pendingCashier.withdrawals} />
            <Stat label="Pending settlements" value={d.operations.pendingSettlements} />
            <Stat label="Recovery failed" value={d.operations.recoveryFailed} />
            <Stat label="Audit records" value={d.operations.auditRecords} />
            <Stat label="Security events" value={d.operations.securityEvents} />
            <Stat label="Notifications" value={d.operations.notifications} />
            <Stat label="Unread notifications" value={d.operations.notificationsUnread} />
          </Section>

          <TableSection
            title="Daily rounds (UTC)"
            note="Days with no rows are absent, not zero-filled."
            head={['Date', 'Currency', 'Rounds', 'Stake', 'Payout']}
            rows={(daily.data?.rounds ?? []).map((r) => [r.date, r.currency, String(r.rounds), r.stake, r.payout])}
            loading={daily.isLoading}
          />
          <TableSection
            title="Daily cashier (UTC)"
            head={['Date', 'Currency', 'Deposits', 'Deposit total', 'Withdrawals', 'Withdrawal total']}
            rows={(daily.data?.cashier ?? []).map((r) => [r.date, r.currency, String(r.deposits), r.depositTotal, String(r.withdrawals), r.withdrawalTotal])}
            loading={daily.isLoading}
          />

          {/* Engagement (Phase 2D.9, X-02) — real events, with the coverage caveat stated. */}
          <section data-testid="analytics-engagement" style={{ ...PANEL, minWidth: 0 }}>
            <h2 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 4px' }}>Engagement</h2>
            {engagement.isLoading ? (
              <div data-testid="engagement-loading" style={{ height: 60, opacity: 0.4 }} />
            ) : engagement.isError ? (
              <p data-testid="engagement-error" role="alert" style={{ fontSize: 12, color: '#b42318', margin: 0 }}>
                Could not load engagement.
              </p>
            ) : engagement.data ? (
              <>
                <p style={{ fontSize: 11, color: '#515970', margin: '0 0 10px', lineHeight: 1.55 }}>
                  {engagement.data.definitions.dau}
                </p>
                <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', minWidth: 0 }}>
                  <Stat
                    label="Active users (window)"
                    value={engagement.data.activeUsersInWindow === null ? 'Not available' : String(engagement.data.activeUsersInWindow)}
                  />
                  <Stat
                    label="MAU (rolling 30d)"
                    value={engagement.data.mauRolling30 === null ? 'Not available' : String(engagement.data.mauRolling30)}
                  />
                  <Stat label="Events recorded" value={String(engagement.data.eventsInWindow)} />
                </div>

                {/* The no-backfill caveat is never hidden: a partial window is stated, not smoothed. */}
                {!engagement.data.windowFullyCovered ? (
                  <p data-testid="engagement-coverage" style={{ fontSize: 11, color: '#8a5300', margin: '10px 0 0', lineHeight: 1.55 }}>
                    {engagement.data.dataAvailableFrom
                      ? `Event recording began ${new Date(engagement.data.dataAvailableFrom).toLocaleString()}. Anything before that reflects absent instrumentation, not absent activity.`
                      : 'No events have been recorded yet, so no active-user figure is shown. A zero here would mean "nobody was active", which is not what the data says.'}
                  </p>
                ) : null}

                {engagement.data.dailyActiveUsers.length > 0 ? (
                  <div style={{ marginTop: 12, overflowX: 'auto', maxWidth: '100%', minWidth: 0 }}>
                    <table data-testid="engagement-daily" style={{ borderCollapse: 'collapse', width: '100%', minWidth: 320, fontSize: 12 }}>
                      <thead>
                        <tr>
                          {['Date (UTC)', 'Active users'].map((h) => (
                            <th key={h} style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #ccd2e0', whiteSpace: 'nowrap', color: '#515970' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {engagement.data.dailyActiveUsers.map((r) => (
                          <tr key={r.date}>
                            <td style={{ padding: '8px 10px', borderBottom: '1px solid #ffffff', whiteSpace: 'nowrap' }}>{r.date}</td>
                            <td style={{ padding: '8px 10px', borderBottom: '1px solid #ffffff' }}>{r.activeUsers}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </>
            ) : null}
          </section>

          {/* Honest unavailability — the whole point of this page's integrity. */}
          <section data-testid="analytics-unavailable" style={{ ...PANEL, borderColor: '#fff7e6' }}>
            <h2 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 4px' }}>Not available</h2>
            <p style={{ fontSize: 12, color: '#515970', margin: '0 0 10px' }}>
              These metrics are not shown because the platform does not hold the data to produce them
              truthfully. They are deliberately not displayed as zero.
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {unavailable.map((u) => (
                <li key={u.metric} style={{ fontSize: 12, lineHeight: 1.5 }}>
                  <b style={{ color: '#8a5300' }}>{u.metric}</b>
                  <span style={{ color: '#515970' }}> — {u.reason}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ minWidth: 0 }}>
      <h2 style={{ fontSize: 15, fontWeight: 800, margin: '0 2px 8px' }}>{title}</h2>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', minWidth: 0 }}>
        {children}
      </div>
    </section>
  );
}

function CurrencySection({ title, buckets }: { title: string; buckets: CurrencyBucket[] }) {
  return (
    <Section title={title}>
      {buckets.length === 0 ? (
        <Stat label="—" value={null} hint="No rows in range" />
      ) : (
        buckets.map((b) => <Stat key={b.currency} label={b.currency} value={b.total} hint={`${b.count} rows`} />)
      )}
    </Section>
  );
}

/** `null` renders "Not available" — never a fabricated 0. */
function Stat({ label, value, hint }: { label: string; value: string | number | null; hint?: string }) {
  return (
    <div style={PANEL}>
      <div style={{ fontSize: 11, color: '#515970', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: value === null ? 13 : 20, fontWeight: 800, marginTop: 4, color: value === null ? '#515970' : '#1b1f37', overflowWrap: 'anywhere' }}>
        {value === null ? 'Not available' : value}
      </div>
      {hint ? <div style={{ fontSize: 10, color: '#626a7e', marginTop: 3, lineHeight: 1.4 }}>{hint}</div> : null}
    </div>
  );
}

/** Tables scroll inside their own container so the page never scrolls horizontally on a phone. */
function TableSection({
  title, head, rows, note, loading,
}: { title: string; head: string[]; rows: string[][]; note?: string; loading?: boolean }) {
  return (
    <section style={{ minWidth: 0 }}>
      <h2 style={{ fontSize: 15, fontWeight: 800, margin: '0 2px 4px' }}>{title}</h2>
      {note ? <p style={{ fontSize: 11, color: '#626a7e', margin: '0 2px 8px', lineHeight: 1.5 }}>{note}</p> : null}
      <div style={{ ...PANEL, padding: 0, overflowX: 'auto', maxWidth: '100%', minWidth: 0 }}>
        {loading ? (
          <div style={{ padding: 14, fontSize: 13, color: '#515970' }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 14, fontSize: 13, color: '#515970' }}>No rows in range.</div>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 420, fontSize: 12 }}>
            <thead>
              <tr>
                {head.map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #ccd2e0', whiteSpace: 'nowrap', color: '#515970', fontWeight: 700 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {r.map((cell, j) => (
                    <td key={j} style={{ padding: '10px 12px', borderBottom: '1px solid #ffffff', whiteSpace: 'nowrap' }}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
