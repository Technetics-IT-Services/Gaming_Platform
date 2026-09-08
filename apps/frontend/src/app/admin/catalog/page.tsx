'use client';

/**
 * Game catalog administration (Phase 2D.13, AD-03).
 *
 * THE GAP THIS CLOSES. Four guarded backend surfaces — categories, providers, collections and
 * launchers, 18 routes — had no frontend, so the game catalogue could not be organised inside the
 * product. This was the last requirement whose remaining work was pure engineering.
 *
 * WHAT THIS DELIBERATELY DOES NOT TOUCH. A category, provider, collection or launcher is
 * presentation and routing metadata. It sets no odds, no RTP, no stake limit and no payout. The
 * money-affecting game *variant* configuration lives on its own surfaces and is not reachable from
 * here — organising a shelf must never become a way to change what a game pays.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { gameCatalogApi } from '@/lib/game-catalog-api';
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

type Tab = 'categories' | 'providers' | 'collections' | 'launchers';
const TABS: { key: Tab; label: string }[] = [
  { key: 'categories', label: 'Categories' },
  { key: 'providers', label: 'Providers' },
  { key: 'collections', label: 'Collections' },
  { key: 'launchers', label: 'Launchers' },
];

export default function AdminCatalogPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isDemoSession = useAuthStore((s) => s.isDemoSession);
  const mayWrite = !isDemoSession && (user?.permissions ?? []).includes('games:write');

  const [tab, setTab] = useState<Tab>('categories');
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', extra: '' });

  const list = useQuery({
    queryKey: ['admin', 'catalog', tab],
    queryFn: () => {
      switch (tab) {
        case 'categories': return gameCatalogApi.categories();
        case 'providers': return gameCatalogApi.providers();
        case 'collections': return gameCatalogApi.collections();
        case 'launchers': return gameCatalogApi.launchers();
      }
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'catalog'] });

  const create = useMutation({
    mutationFn: () => {
      const name = form.name.trim();
      const extra = form.extra.trim() || undefined;
      switch (tab) {
        case 'categories': return gameCatalogApi.createCategory({ name, description: extra });
        case 'providers': return gameCatalogApi.createProvider({ name, code: extra });
        case 'collections': return gameCatalogApi.createCollection({ name, description: extra });
        // Launchers are registered by the platform, not created from this console.
        default: throw new Error('not creatable here');
      }
    },
    onSuccess: () => { setNotice('Created.'); setForm({ name: '', extra: '' }); invalidate(); },
    onError: () => setNotice(null),
  });

  const remove = useMutation({
    mutationFn: (id: string) => {
      switch (tab) {
        case 'categories': return gameCatalogApi.deleteCategory(id);
        case 'providers': return gameCatalogApi.deleteProvider(id);
        case 'collections': return gameCatalogApi.deleteCollection(id);
        default: throw new Error('not deletable here');
      }
    },
    onSuccess: () => { setNotice('Deleted.'); invalidate(); },
    onError: () => setNotice(null),
  });

  // The four catalog kinds share a display shape but not a TypeScript type; the table reads a
  // small, common set of optional fields rather than four near-identical render branches.
  const rows = (list.data ?? []) as unknown as Record<string, unknown>[];
  const creatable = tab !== 'launchers';
  const extraLabel = tab === 'providers' ? 'Code (optional)' : 'Description (optional)';

  return (
    <div
      data-testid="admin-catalog"
      style={{
        color: '#1b1f37', width: '100%', maxWidth: 1100, minWidth: 0,
        margin: '0 auto', padding: '4px 0 28px', boxSizing: 'border-box',
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 2px 4px' }}>Game catalogue</h1>
      <p style={{ fontSize: 12, color: '#515970', margin: '0 2px 14px', lineHeight: 1.5 }}>
        {mayWrite
          ? 'How games are grouped and presented. Nothing here changes odds, payouts or stake limits.'
          : 'Read-only: changing the catalogue requires the games-write permission. The server refuses writes from this account.'}
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            data-testid={`catalog-tab-${t.key}`}
            onClick={() => { setTab(t.key); setForm({ name: '', extra: '' }); }}
            style={{
              ...FIELD, width: 'auto', minWidth: 120, fontWeight: 700, cursor: 'pointer',
              background: tab === t.key ? '#e8efff' : '#ebeef5',
              border: `1px solid ${tab === t.key ? '#e8efff' : '#b9c1d4'}`,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {list.isLoading ? (
        <div data-testid="catalog-loading" style={{ ...PANEL, height: 100 }} />
      ) : list.isError ? (
        <div data-testid="catalog-error" role="alert" style={{ ...PANEL, borderColor: '#f0b4b0', color: '#b42318' }}>
          Could not load the catalogue.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {notice ? (
            <span data-testid="catalog-notice" role="status" style={{ fontSize: 12, color: '#0f7a4a' }}>{notice}</span>
          ) : null}
          {create.isError || remove.isError ? (
            <span data-testid="catalog-action-error" role="alert" style={{ fontSize: 12, color: '#b42318' }}>
              That change was refused by the server and was NOT applied.
            </span>
          ) : null}

          {mayWrite && creatable ? (
            <section data-testid="catalog-create" style={{ ...PANEL, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>
                New {tab.slice(0, -1)}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                <label style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <span style={{ fontSize: 11, color: '#515970' }}>Name</span>
                  <input data-testid="catalog-name" value={form.name}
                         onChange={(e) => setForm({ ...form, name: e.target.value })}
                         placeholder="Live casino" style={FIELD} />
                </label>
                <label style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <span style={{ fontSize: 11, color: '#515970' }}>{extraLabel}</span>
                  <input data-testid="catalog-extra" value={form.extra}
                         onChange={(e) => setForm({ ...form, extra: e.target.value })} style={FIELD} />
                </label>
              </div>
              <button
                data-testid="catalog-create-submit"
                disabled={form.name.trim().length < 2 || create.isPending}
                onClick={() => create.mutate()}
                style={{ ...BTN('#e6f6ee', '#86c9a6'), marginTop: 10, minWidth: 150,
                         opacity: form.name.trim().length < 2 ? 0.6 : 1 }}
              >
                {create.isPending ? 'Creating…' : 'Create'}
              </button>
            </section>
          ) : null}

          {tab === 'launchers' ? (
            <p data-testid="catalog-launchers-note" style={{ fontSize: 11, color: '#515970', margin: '0 2px', lineHeight: 1.55 }}>
              Launchers are registered by the platform when a game runtime is installed. They are
              listed here for visibility rather than created by hand.
            </p>
          ) : null}

          {rows.length === 0 ? (
            <div data-testid="catalog-empty" style={{ ...PANEL, fontSize: 13, color: '#515970' }}>
              Nothing configured yet.
            </div>
          ) : (
            <div style={{ ...PANEL, padding: 0, overflowX: 'auto', maxWidth: '100%', minWidth: 0 }}>
              <table data-testid="catalog-table" style={{ borderCollapse: 'collapse', width: '100%', minWidth: 620, fontSize: 12 }}>
                <thead>
                  <tr>
                    {['Name', tab === 'providers' ? 'Code' : 'Detail', 'Games', 'Active',
                      ...(mayWrite && creatable ? ['Actions'] : [])].map((h) => (
                        <th key={h} style={TH}>{h}</th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const id = String(r.id ?? '');
                    const detail = String(r.code ?? r.description ?? r.key ?? '—');
                    return (
                      <tr key={id} data-testid={`catalog-row-${id}`}>
                        <td style={{ ...TD, overflowWrap: 'anywhere', whiteSpace: 'normal', maxWidth: 220 }}>
                          {String(r.name ?? '—')}
                        </td>
                        <td style={{ ...TD, overflowWrap: 'anywhere', whiteSpace: 'normal', maxWidth: 240 }}>
                          {detail}
                        </td>
                        <td style={TD}>{r.gameCount === undefined ? '—' : String(r.gameCount)}</td>
                        <td style={{ ...TD, color: r.isActive === false ? '#515970' : '#0f7a4a' }}>
                          {r.isActive === false ? 'no' : 'yes'}
                        </td>
                        {mayWrite && creatable ? (
                          <td style={TD}>
                            <button
                              data-testid={`catalog-delete-${id}`}
                              disabled={remove.isPending}
                              onClick={() => remove.mutate(id)}
                              style={BTN('#fef2f2', '#f0b4b0')}
                            >
                              Delete
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
