'use client';

/**
 * Operating expenses (Phase 2D.12, F-03).
 *
 * The backend has been complete since Phase 2D.5 but had no screen, so finance staff could not
 * record an expense inside the product. This completes the vertical slice.
 *
 * WHAT IS NOT HERE, AND WHY. There is no profit figure and no revenue column: profit is
 * revenue − expenses, and revenue has no agreed accounting definition on this platform (client
 * decision D-01). The server returns that reason and this page prints it instead of a number.
 *
 * The chart of accounts is the client's own — categories are operator-created, never seeded with
 * invented names. Amounts are decimal strings and are only ever summed **within one currency**.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EXPENSE_STATUSES, expensesApi, type ExpenseStatus } from '@/lib/expenses-api';
import { useAuthStore } from '@/stores/auth-store';

const PANEL: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #ccd2e0', borderRadius: 14, padding: 14,
};
const FIELD: React.CSSProperties = {
  minHeight: 44, padding: '10px', borderRadius: 10, border: '1px solid #b9c1d4',
  background: '#ebeef5', color: '#1b1f37', fontSize: 14, width: '100%', boxSizing: 'border-box',
};
const BTN = (bg: string, border: string): React.CSSProperties => ({
  ...FIELD, width: 'auto', minWidth: 96, fontSize: 12, fontWeight: 700,
  cursor: 'pointer', background: bg, border: `1px solid ${border}`,
});
const TH: React.CSSProperties = {
  textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #ccd2e0', whiteSpace: 'nowrap', color: '#515970',
};
const TD: React.CSSProperties = {
  padding: '10px 12px', borderBottom: '1px solid #ffffff', whiteSpace: 'nowrap',
};

const STATUS_COLOR: Record<string, string> = {
  DRAFT: '#8a5300', CONFIRMED: '#0f7a4a', VOID: '#515970',
};
const AMOUNT_RE = /^\d{1,12}(\.\d{1,8})?$/;
const label = (s: string) => s.toLowerCase();
const today = () => new Date().toISOString().slice(0, 10);

export default function AdminExpensesPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isDemoSession = useAuthStore((s) => s.isDemoSession);
  const mayWrite = !isDemoSession && (user?.permissions ?? []).includes('expenses:write');

  const [status, setStatus] = useState<string>('');
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({
    categoryId: '', description: '', amount: '', currency: 'INR', incurredOn: today(), reference: '',
  });
  const [newCategory, setNewCategory] = useState({ code: '', name: '' });

  const categories = useQuery({ queryKey: ['admin', 'expense-categories'], queryFn: expensesApi.categories });
  const list = useQuery({
    queryKey: ['admin', 'expenses', status],
    queryFn: () => expensesApi.list({ status: (status || undefined) as ExpenseStatus | undefined, limit: 50 }),
  });
  const totals = useQuery({ queryKey: ['admin', 'expense-totals'], queryFn: () => expensesApi.totals() });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'expenses'] });
    qc.invalidateQueries({ queryKey: ['admin', 'expense-totals'] });
    qc.invalidateQueries({ queryKey: ['admin', 'expense-categories'] });
  };

  const createCategory = useMutation({
    mutationFn: () => expensesApi.createCategory({ code: newCategory.code.trim(), name: newCategory.name.trim() }),
    onSuccess: (c) => { setNotice(`Category ${c.code} created.`); setNewCategory({ code: '', name: '' }); invalidate(); },
    onError: () => setNotice(null),
  });

  const create = useMutation({
    mutationFn: () => expensesApi.create({
      categoryId: form.categoryId,
      description: form.description.trim(),
      amount: form.amount.trim(),
      currency: form.currency.trim().toUpperCase(),
      incurredOn: form.incurredOn,
      reference: form.reference.trim() || undefined,
    }),
    onSuccess: (e) => {
      setNotice(`Recorded ${e.amount} ${e.currency} as ${label(e.status)}.`);
      setForm({ ...form, description: '', amount: '', reference: '' });
      invalidate();
    },
    onError: () => setNotice(null),
  });

  const act = useMutation({
    mutationFn: (v: { action: 'confirm' | 'void'; id: string }) =>
      v.action === 'confirm' ? expensesApi.confirm(v.id) : expensesApi.void(v.id, 'Voided by operator'),
    onSuccess: (_d, v) => { setNotice(`Expense ${v.action}ed.`); invalidate(); },
    onError: () => setNotice(null),
  });

  const cats = categories.data ?? [];
  const validExpense = form.categoryId !== ''
    && form.description.trim().length >= 2
    && AMOUNT_RE.test(form.amount.trim())
    && /^\d{4}-\d{2}-\d{2}$/.test(form.incurredOn);

  const d = list.data;

  return (
    <div
      data-testid="admin-expenses"
      style={{
        color: '#1b1f37', width: '100%', maxWidth: 1150, minWidth: 0,
        margin: '0 auto', padding: '4px 0 28px', boxSizing: 'border-box',
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 2px 4px' }}>Expenses</h1>
      <p style={{ fontSize: 12, color: '#515970', margin: '0 2px 14px', lineHeight: 1.5 }}>
        {mayWrite
          ? 'Business spending. These records never touch a player wallet and create no ledger entry.'
          : 'Read-only: recording expenses requires the expenses-write permission. The server refuses writes from this account.'}
      </p>

      {/* -------------------------------------------------------- totals */}
      <section data-testid="expense-totals" style={{ ...PANEL, marginBottom: 14, minWidth: 0 }}>
        <h2 style={{ fontSize: 14, fontWeight: 800, margin: '0 0 10px' }}>Confirmed totals</h2>
        {totals.isLoading ? (
          <div data-testid="totals-loading" style={{ height: 40, opacity: 0.4 }} />
        ) : totals.isError ? (
          <p data-testid="totals-error" role="alert" style={{ fontSize: 12, color: '#b42318', margin: 0 }}>
            Could not load totals.
          </p>
        ) : totals.data ? (
          <>
            {totals.data.byCurrency.length === 0 ? (
              <p data-testid="totals-empty" style={{ fontSize: 13, color: '#515970', margin: 0 }}>
                No confirmed expenses yet.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                {totals.data.byCurrency.map((t) => (
                  <div key={t.currency} data-testid={`total-${t.currency}`}
                       style={{ background: '#ebeef5', border: '1px solid #ccd2e0', borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 11, color: '#515970' }}>{t.currency}</div>
                    <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4, overflowWrap: 'anywhere' }}>{t.total}</div>
                    <div style={{ fontSize: 10, color: '#626a7e', marginTop: 2 }}>{t.count} confirmed</div>
                  </div>
                ))}
              </div>
            )}
            {totals.data.unavailable.length > 0 ? (
              <div data-testid="expenses-unavailable" style={{ marginTop: 12, borderTop: '1px solid #ccd2e0', paddingTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#8a5300', marginBottom: 6 }}>Not available</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, lineHeight: 1.6, color: '#515970' }}>
                  {totals.data.unavailable.map((u) => (
                    <li key={u.metric} style={{ overflowWrap: 'anywhere' }}>
                      <b style={{ color: '#8a5300' }}>{u.metric}</b> — {u.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      {mayWrite ? (
        <>
          {/* ------------------------------------------------ new category */}
          <section data-testid="expense-category-form" style={{ ...PANEL, marginBottom: 14, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>Expense category</div>
            <p style={{ fontSize: 11, color: '#515970', margin: '0 0 10px', lineHeight: 1.5 }}>
              Your chart of accounts. Nothing is pre-seeded — the categories are yours to define.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
              <label style={{ flex: '1 1 140px', minWidth: 0 }}>
                <span style={{ fontSize: 11, color: '#515970' }}>Code</span>
                <input data-testid="category-code" value={newCategory.code}
                       onChange={(e) => setNewCategory({ ...newCategory, code: e.target.value.toUpperCase() })}
                       placeholder="MARKETING" style={FIELD} />
              </label>
              <label style={{ flex: '1 1 200px', minWidth: 0 }}>
                <span style={{ fontSize: 11, color: '#515970' }}>Name</span>
                <input data-testid="category-name" value={newCategory.name}
                       onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                       placeholder="Marketing and acquisition" style={FIELD} />
              </label>
            </div>
            <button
              data-testid="category-submit"
              disabled={newCategory.code.trim().length < 2 || newCategory.name.trim().length < 2 || createCategory.isPending}
              onClick={() => createCategory.mutate()}
              style={{ ...BTN('#e8efff', '#e8efff'), marginTop: 10, minWidth: 150 }}
            >
              {createCategory.isPending ? 'Creating…' : 'Add category'}
            </button>
            {createCategory.isError ? (
              <p data-testid="category-error" role="alert" style={{ fontSize: 12, color: '#b42318', margin: '8px 0 0' }}>
                Could not create the category. Nothing was saved — the code may already exist.
              </p>
            ) : null}
          </section>

          {/* ------------------------------------------------- new expense */}
          <section data-testid="expense-form" style={{ ...PANEL, marginBottom: 14, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>Record an expense</div>
            {cats.length === 0 ? (
              <p data-testid="expense-needs-category" style={{ fontSize: 12, color: '#515970', margin: 0 }}>
                Create a category first — an expense must be classified.
              </p>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                  <label style={{ flex: '1 1 180px', minWidth: 0 }}>
                    <span style={{ fontSize: 11, color: '#515970' }}>Category</span>
                    <select data-testid="expense-category" value={form.categoryId}
                            onChange={(e) => setForm({ ...form, categoryId: e.target.value })} style={FIELD}>
                      <option value="">Choose…</option>
                      {cats.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                    </select>
                  </label>
                  <label style={{ flex: '2 1 240px', minWidth: 0 }}>
                    <span style={{ fontSize: 11, color: '#515970' }}>Description</span>
                    <input data-testid="expense-description" value={form.description}
                           onChange={(e) => setForm({ ...form, description: e.target.value })}
                           placeholder="What was this spend for?" style={FIELD} />
                  </label>
                  <label style={{ flex: '1 1 130px', minWidth: 0 }}>
                    <span style={{ fontSize: 11, color: '#515970' }}>Amount</span>
                    <input data-testid="expense-amount" value={form.amount} inputMode="decimal"
                           onChange={(e) => setForm({ ...form, amount: e.target.value })}
                           placeholder="1250.00" style={FIELD} />
                  </label>
                  <label style={{ flex: '0 1 110px', minWidth: 0 }}>
                    <span style={{ fontSize: 11, color: '#515970' }}>Currency</span>
                    <input data-testid="expense-currency" value={form.currency} maxLength={8}
                           onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} style={FIELD} />
                  </label>
                  <label style={{ flex: '1 1 150px', minWidth: 0 }}>
                    <span style={{ fontSize: 11, color: '#515970' }}>Incurred on</span>
                    <input data-testid="expense-date" type="date" value={form.incurredOn}
                           onChange={(e) => setForm({ ...form, incurredOn: e.target.value })} style={FIELD} />
                  </label>
                  <label style={{ flex: '1 1 160px', minWidth: 0 }}>
                    <span style={{ fontSize: 11, color: '#515970' }}>Reference (optional)</span>
                    <input data-testid="expense-reference" value={form.reference}
                           onChange={(e) => setForm({ ...form, reference: e.target.value })}
                           placeholder="invoice number" style={FIELD} />
                  </label>
                </div>
                <p style={{ fontSize: 11, color: '#626a7e', margin: '10px 0 0', lineHeight: 1.5 }}>
                  Recorded as a draft. Only a confirmed expense counts toward the totals above.
                </p>
                <button
                  data-testid="expense-submit"
                  disabled={!validExpense || create.isPending}
                  onClick={() => create.mutate()}
                  style={{ ...BTN('#e6f6ee', '#86c9a6'), marginTop: 10, minWidth: 160, opacity: validExpense ? 1 : 0.6 }}
                >
                  {create.isPending ? 'Recording…' : 'Record expense'}
                </button>
                {create.isError ? (
                  <p data-testid="expense-error" role="alert" style={{ fontSize: 12, color: '#b42318', margin: '8px 0 0' }}>
                    The expense was refused and was NOT saved. A duplicate reference is the usual cause.
                  </p>
                ) : null}
              </>
            )}
          </section>
        </>
      ) : null}

      {notice ? (
        <div data-testid="expenses-notice" role="status" style={{ fontSize: 12, color: '#0f7a4a', marginBottom: 10 }}>{notice}</div>
      ) : null}
      {act.isError ? (
        <div data-testid="expenses-action-error" role="alert" style={{ fontSize: 12, color: '#b42318', marginBottom: 10 }}>
          That change was refused by the server and was NOT applied.
        </div>
      ) : null}

      {/* ----------------------------------------------------------- list */}
      <div style={{ ...PANEL, marginBottom: 14, minWidth: 0 }}>
        <label style={{ display: 'block', maxWidth: 240 }}>
          <span style={{ fontSize: 11, color: '#515970' }}>Status</span>
          <select data-testid="expense-status-filter" value={status} onChange={(e) => setStatus(e.target.value)} style={FIELD}>
            <option value="">All</option>
            {EXPENSE_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </label>
      </div>

      {list.isLoading ? (
        <div data-testid="expenses-loading" style={{ ...PANEL, height: 100 }} />
      ) : list.isError ? (
        <div data-testid="expenses-error" role="alert" style={{ ...PANEL, borderColor: '#f0b4b0', color: '#b42318' }}>
          Could not load expenses.
        </div>
      ) : d && d.items.length === 0 ? (
        <div data-testid="expenses-empty" style={{ ...PANEL, fontSize: 13, color: '#515970' }}>
          No expenses recorded with this status.
        </div>
      ) : d ? (
        <div style={{ ...PANEL, padding: 0, overflowX: 'auto', maxWidth: '100%', minWidth: 0 }}>
          <table data-testid="expenses-table" style={{ borderCollapse: 'collapse', width: '100%', minWidth: 820, fontSize: 12 }}>
            <thead>
              <tr>
                {['Incurred', 'Description', 'Amount', 'Currency', 'Status',
                  ...(mayWrite ? ['Actions'] : [])].map((h) => <th key={h} style={TH}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {d.items.map((e) => (
                <tr key={e.id} data-testid={`expense-row-${e.id}`}>
                  <td style={TD}>{e.incurredOn.slice(0, 10)}</td>
                  <td style={{ ...TD, overflowWrap: 'anywhere', whiteSpace: 'normal', maxWidth: 260 }}>{e.description}</td>
                  <td style={TD}>{e.amount}</td>
                  <td style={TD}>{e.currency}</td>
                  <td style={{ ...TD, color: STATUS_COLOR[e.status] ?? '#1b1f37' }}>{label(e.status)}</td>
                  {mayWrite ? (
                    <td style={TD}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {e.status === 'DRAFT' ? (
                          <button data-testid={`expense-confirm-${e.id}`} disabled={act.isPending}
                                  onClick={() => act.mutate({ action: 'confirm', id: e.id })}
                                  style={BTN('#e6f6ee', '#86c9a6')}>
                            Confirm
                          </button>
                        ) : null}
                        {e.status !== 'VOID' ? (
                          <button data-testid={`expense-void-${e.id}`} disabled={act.isPending}
                                  onClick={() => act.mutate({ action: 'void', id: e.id })}
                                  style={BTN('#fef2f2', '#f0b4b0')}>
                            Void
                          </button>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
