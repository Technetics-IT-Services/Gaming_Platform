'use client';

/**
 * Finance operations console (Phase 2D.10) — F-01 queues, F-06 cash flow, F-07 search + failures.
 *
 * READ-ONLY by construction: this page has no mutation call. Deposit and withdrawal decisions stay
 * on the operator cashier surface, which enforces its own authorization and audit.
 *
 * Every amount is shown inside its own currency row. There is no total line, no "revenue" and no
 * "profit" — the server states why, and this page prints that statement rather than a zero.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { financeOpsApi, type TransactionFilters } from '@/lib/finance-ops-api';

const PANEL: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #ccd2e0', borderRadius: 14, padding: 14,
};
const FIELD: React.CSSProperties = {
  minHeight: 44, padding: '10px', borderRadius: 10, border: '1px solid #b9c1d4',
  background: '#ebeef5', color: '#1b1f37', fontSize: 14, width: '100%', boxSizing: 'border-box',
};
const TH: React.CSSProperties = {
  textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #ccd2e0',
  whiteSpace: 'nowrap', color: '#515970',
};
const TD: React.CSSProperties = {
  padding: '10px 12px', borderBottom: '1px solid #ffffff', whiteSpace: 'nowrap',
};

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

export default function AdminFinancePage() {
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [search, setSearch] = useState<TransactionFilters>({});
  const [draft, setDraft] = useState<{ username: string; typeCode: string; reference: string }>({
    username: '', typeCode: '', reference: '',
  });

  const window_ = { from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z` };

  const queues = useQuery({ queryKey: ['finance', 'queues'], queryFn: financeOpsApi.queues });
  const cash = useQuery({
    queryKey: ['finance', 'cash-flow', window_.from, window_.to],
    queryFn: () => financeOpsApi.cashFlow(window_),
  });
  const failures = useQuery({
    queryKey: ['finance', 'failures', window_.from, window_.to],
    queryFn: () => financeOpsApi.failures({ ...window_, limit: 50 }),
  });
  const txns = useQuery({
    queryKey: ['finance', 'transactions', window_.from, window_.to, JSON.stringify(search)],
    queryFn: () => financeOpsApi.transactions({ ...window_, ...search, limit: 25 }),
  });

  return (
    <div
      data-testid="admin-finance"
      style={{
        color: '#1b1f37', width: '100%', maxWidth: 1200, minWidth: 0,
        margin: '0 auto', padding: '4px 0 28px', boxSizing: 'border-box',
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 2px 4px' }}>Finance</h1>
      <p style={{ fontSize: 12, color: '#515970', margin: '0 2px 14px', lineHeight: 1.5 }}>
        Read-only. Deposit and withdrawal decisions are taken on the cashier screens.
      </p>

      {/* ----------------------------------------------------------- window */}
      <div style={{ ...PANEL, display: 'flex', gap: 10, flexWrap: 'wrap', minWidth: 0, marginBottom: 14 }}>
        <label style={{ flex: '1 1 150px', minWidth: 0 }}>
          <span style={{ fontSize: 11, color: '#515970' }}>From</span>
          <input data-testid="finance-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={FIELD} />
        </label>
        <label style={{ flex: '1 1 150px', minWidth: 0 }}>
          <span style={{ fontSize: 11, color: '#515970' }}>To</span>
          <input data-testid="finance-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={FIELD} />
        </label>
      </div>

      {/* ------------------------------------------------ F-01 review queues */}
      <section data-testid="finance-queues" style={{ ...PANEL, minWidth: 0, marginBottom: 14 }}>
        <h2 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 10px' }}>Awaiting review</h2>
        {queues.isLoading ? (
          <div data-testid="queues-loading" style={{ height: 60, opacity: 0.4 }} />
        ) : queues.isError ? (
          <p data-testid="queues-error" role="alert" style={{ fontSize: 12, color: '#b42318', margin: 0 }}>
            Could not load the review queues.
          </p>
        ) : queues.data ? (
          <>
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', minWidth: 0 }}>
              <Stat label="Deposits pending" value={queues.data.pendingDeposits} />
              <Stat label="Withdrawals pending" value={queues.data.pendingWithdrawals} />
              <Stat label="Withdrawals under review" value={queues.data.withdrawalsUnderReview} />
              <Stat label="Approved, awaiting payment" value={queues.data.withdrawalsApprovedAwaitingPayment} />
            </div>
            <p style={{ fontSize: 11, color: '#626a7e', margin: '10px 0 0', lineHeight: 1.5 }}>{queues.data.note}</p>
          </>
        ) : null}
      </section>

      {/* ----------------------------------------------------- F-06 cash flow */}
      <section data-testid="finance-cashflow" style={{ ...PANEL, minWidth: 0, marginBottom: 14 }}>
        <h2 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 4px' }}>Cash flow</h2>
        {cash.isLoading ? (
          <div data-testid="cashflow-loading" style={{ height: 60, opacity: 0.4 }} />
        ) : cash.isError ? (
          <p data-testid="cashflow-error" role="alert" style={{ fontSize: 12, color: '#b42318', margin: 0 }}>
            Could not load cash flow.
          </p>
        ) : cash.data ? (
          <>
            {/* The server's own definition, printed verbatim so it cannot be read as revenue. */}
            <p style={{ fontSize: 11, color: '#515970', margin: '0 0 10px', lineHeight: 1.55 }}>{cash.data.definition}</p>
            {cash.data.byCurrency.length === 0 ? (
              <div data-testid="cashflow-empty" style={{ fontSize: 13, color: '#515970' }}>
                No completed deposits or withdrawals in this period.
              </div>
            ) : (
              <div style={{ overflowX: 'auto', maxWidth: '100%', minWidth: 0 }}>
                <table data-testid="cashflow-table" style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560, fontSize: 12 }}>
                  <thead>
                    <tr>{['Currency', 'Money in', 'Money out', 'Net movement', 'Deposits', 'Withdrawals'].map((h) => (
                      <th key={h} style={TH}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {cash.data.byCurrency.map((c) => (
                      <tr key={c.currency} data-testid={`cashflow-${c.currency}`}>
                        <td style={TD}>{c.currency}</td>
                        <td style={TD}>{c.moneyIn}</td>
                        <td style={TD}>{c.moneyOut}</td>
                        <td style={TD}>{c.netMovement}</td>
                        <td style={TD}>{c.depositCount}</td>
                        <td style={TD}>{c.withdrawalCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <section data-testid="cashflow-unavailable" style={{ marginTop: 12, borderTop: '1px solid #ccd2e0', paddingTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#8a5300', marginBottom: 6 }}>Not available</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, lineHeight: 1.6, color: '#515970' }}>
                {cash.data.unavailable.map((u) => (
                  <li key={u.metric} style={{ overflowWrap: 'anywhere' }}>
                    <b style={{ color: '#8a5300' }}>{u.metric}</b> — {u.reason}
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : null}
      </section>

      {/* ------------------------------------------- F-07 transaction search */}
      <section data-testid="finance-search" style={{ ...PANEL, minWidth: 0, marginBottom: 14 }}>
        <h2 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 10px' }}>Transaction search</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
          <label style={{ flex: '1 1 150px', minWidth: 0 }}>
            <span style={{ fontSize: 11, color: '#515970' }}>Type</span>
            <select
              data-testid="search-type"
              value={draft.typeCode}
              onChange={(e) => setDraft({ ...draft, typeCode: e.target.value })}
              style={FIELD}
            >
              <option value="">Any type</option>
              {['DEPOSIT', 'WITHDRAWAL', 'GAME_BET', 'GAME_WIN', 'BONUS_CREDIT', 'ADMIN_ADJUSTMENT', 'REFUND', 'PENALTY', 'RESERVE'].map((t) => (
                <option key={t} value={t}>{t.toLowerCase().replace(/_/g, ' ')}</option>
              ))}
            </select>
          </label>
          <label style={{ flex: '1 1 180px', minWidth: 0 }}>
            <span style={{ fontSize: 11, color: '#515970' }}>Reference contains</span>
            <input
              data-testid="search-reference"
              value={draft.reference}
              onChange={(e) => setDraft({ ...draft, reference: e.target.value })}
              placeholder="reference"
              style={FIELD}
            />
          </label>
        </div>
        <button
          data-testid="search-submit"
          onClick={() => setSearch({
            typeCode: draft.typeCode || undefined,
            reference: draft.reference.trim() || undefined,
          })}
          style={{ ...FIELD, marginTop: 10, fontWeight: 700, cursor: 'pointer', border: '1px solid #e8efff', background: '#e8efff' }}
        >
          Search
        </button>

        {txns.isLoading ? (
          <div data-testid="search-loading" style={{ height: 60, opacity: 0.4, marginTop: 12 }} />
        ) : txns.isError ? (
          <p data-testid="search-error" role="alert" style={{ fontSize: 12, color: '#b42318', margin: '12px 0 0' }}>
            Could not run the search.
          </p>
        ) : txns.data && txns.data.items.length === 0 ? (
          <div data-testid="search-empty" style={{ fontSize: 13, color: '#515970', marginTop: 12 }}>
            No transactions match these filters in this period.
          </div>
        ) : txns.data ? (
          <>
            <div style={{ fontSize: 11, color: '#515970', margin: '12px 0 6px' }}>
              {txns.data.total} matching · showing {txns.data.items.length}
            </div>
            <div style={{ overflowX: 'auto', maxWidth: '100%', minWidth: 0 }}>
              <table data-testid="search-table" style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720, fontSize: 12 }}>
                <thead>
                  <tr>{['When', 'Player', 'Type', 'Status', 'Currency', 'Amount', 'Reference'].map((h) => (
                    <th key={h} style={TH}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {txns.data.items.map((t) => (
                    <tr key={t.id}>
                      <td style={TD}>{new Date(t.createdAt).toLocaleString()}</td>
                      <td style={{ ...TD, overflowWrap: 'anywhere', whiteSpace: 'normal', maxWidth: 160 }}>{t.username}</td>
                      <td style={TD}>{t.type.toLowerCase().replace(/_/g, ' ')}</td>
                      <td style={TD}>{t.status.toLowerCase()}</td>
                      <td style={TD}>{t.currency}</td>
                      <td style={TD}>{t.amount}</td>
                      <td style={{ ...TD, overflowWrap: 'anywhere', whiteSpace: 'normal', maxWidth: 200 }}>{t.reference ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>

      {/* ------------------------------------------------- F-07 failures */}
      <section data-testid="finance-failures" style={{ ...PANEL, minWidth: 0 }}>
        <h2 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 10px' }}>Failures</h2>
        {failures.isLoading ? (
          <div data-testid="failures-loading" style={{ height: 60, opacity: 0.4 }} />
        ) : failures.isError ? (
          <p data-testid="failures-error" role="alert" style={{ fontSize: 12, color: '#b42318', margin: 0 }}>
            Could not load failures.
          </p>
        ) : failures.data ? (
          <>
            {failures.data.failedDeposits.length === 0
              && failures.data.failedWithdrawals.length === 0
              && failures.data.failedRounds.length === 0 ? (
                <div data-testid="failures-empty" style={{ fontSize: 13, color: '#515970' }}>
                  Nothing failed in this period.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
                  <FailureTable
                    testId="failed-deposits"
                    title={`Failed deposits (${failures.data.failedDeposits.length})`}
                    rows={failures.data.failedDeposits.map((d) => [
                      new Date(d.createdAt).toLocaleString(), d.username, d.currency, d.amount, d.status.toLowerCase(),
                    ])}
                  />
                  <FailureTable
                    testId="failed-withdrawals"
                    title={`Failed / rejected withdrawals (${failures.data.failedWithdrawals.length})`}
                    rows={failures.data.failedWithdrawals.map((w) => [
                      new Date(w.createdAt).toLocaleString(), w.username, w.currency, w.amount, w.status.toLowerCase(),
                    ])}
                  />
                  {failures.data.failedRounds.length > 0 ? (
                    <FailureTable
                      testId="failed-rounds"
                      title="Failed game rounds"
                      head={['Game', 'Status', 'Count']}
                      rows={failures.data.failedRounds.map((r) => [r.gameKey, r.status.toLowerCase(), String(r.count)])}
                    />
                  ) : null}
                </div>
              )}
            {/* Why this view does not read wallet_transactions. The operator sees the reasoning. */}
            <p data-testid="failures-note" style={{ fontSize: 11, color: '#515970', margin: '12px 0 0', lineHeight: 1.55 }}>
              {failures.data.ledgerNote}
            </p>
          </>
        ) : null}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: '#ebeef5', border: '1px solid #ccd2e0', borderRadius: 10, padding: 12, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: '#515970' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function FailureTable({
  testId, title, rows, head = ['When', 'Player', 'Currency', 'Amount', 'Status'],
}: {
  testId: string; title: string; rows: string[][]; head?: string[];
}) {
  if (rows.length === 0) return null;
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.85, marginBottom: 6 }}>{title}</div>
      <div style={{ overflowX: 'auto', maxWidth: '100%', minWidth: 0 }}>
        <table data-testid={testId} style={{ borderCollapse: 'collapse', width: '100%', minWidth: 520, fontSize: 12 }}>
          <thead><tr>{head.map((h) => <th key={h} style={TH}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${testId}-${i}`}>
                {r.map((cell, j) => (
                  <td key={j} style={j === 1 ? { ...TD, overflowWrap: 'anywhere', whiteSpace: 'normal', maxWidth: 160 } : TD}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
