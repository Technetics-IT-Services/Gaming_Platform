'use client';

/**
 * Platform settings (AD-09).
 *
 * This replaces a 22-line placeholder. Every row comes from `GET /admin/settings`, which returns
 * only the server's allow-listed keys along with their type, default state and description.
 *
 * WHAT IS DELIBERATELY ABSENT: game-variant configuration, wallet/payout/settlement settings,
 * responsible-gaming enforcement and session-security controls. Those are money- or
 * safety-affecting and are not on the server's allow-list, so no UI is offered for them — the page
 * says so rather than leaving an operator to wonder.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { canWritePartners } from '@/lib/partner-access';
import { adminSettingsApi, type SettingView } from '@/lib/settings-api';
import { useAuthStore } from '@/stores/auth-store';

const PANEL: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #ccd2e0', borderRadius: 14, padding: 14,
};
const FIELD: React.CSSProperties = {
  minHeight: 44, padding: '10px', borderRadius: 10, border: '1px solid #b9c1d4',
  background: '#ebeef5', color: '#1b1f37', fontSize: 14, width: '100%', boxSizing: 'border-box',
};

export default function AdminSettingsPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isDemoSession = useAuthStore((s) => s.isDemoSession);
  // `settings:write` is held by super-admin only, exactly like partner writes.
  const mayWrite = canWritePartners(user, isDemoSession)
    || (user?.permissions ?? []).includes('settings:write');

  const [drafts, setDrafts] = useState<Record<string, string | boolean | number>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const list = useQuery({ queryKey: ['admin', 'settings'], queryFn: adminSettingsApi.list });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'settings'] });

  const save = useMutation({
    mutationFn: (v: { key: string; value: string | boolean | number }) => adminSettingsApi.set(v.key, v.value),
    onSuccess: (s) => {
      setNotice(`Saved ${s.key}${s.requiresRestart ? ' — a restart is required to take effect.' : '.'}`);
      setDrafts((d) => { const n = { ...d }; delete n[s.key]; return n; });
      invalidate();
    },
    onError: () => setNotice(null),
  });

  const reset = useMutation({
    mutationFn: (key: string) => adminSettingsApi.reset(key),
    onSuccess: (s) => { setNotice(`${s.key} restored to its default.`); invalidate(); },
    onError: () => setNotice(null),
  });

  const draftOf = (s: SettingView) => (s.key in drafts ? drafts[s.key]! : s.value);

  return (
    <div
      data-testid="admin-settings"
      style={{
        color: '#1b1f37', width: '100%', maxWidth: 900, minWidth: 0,
        margin: '0 auto', padding: '4px 0 28px', boxSizing: 'border-box',
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 2px 4px' }}>Platform settings</h1>
      <p style={{ fontSize: 12, color: '#515970', margin: '0 2px 14px', lineHeight: 1.5 }}>
        {mayWrite
          ? 'Only these settings can be changed here. Every change is audited.'
          : 'Read-only: changing settings requires super-admin. The server refuses writes from this account.'}
      </p>

      {list.isLoading ? (
        <div data-testid="settings-loading" style={{ ...PANEL, height: 100 }} />
      ) : list.isError ? (
        <div data-testid="settings-error" role="alert" style={{ ...PANEL, borderColor: '#f0b4b0', color: '#b42318' }}>
          Could not load settings.
        </div>
      ) : list.data && list.data.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {notice ? (
            <span data-testid="settings-notice" role="status" style={{ fontSize: 12, color: '#0f7a4a' }}>{notice}</span>
          ) : null}
          {(save.isError || reset.isError) ? (
            <span data-testid="settings-mutation-error" role="alert" style={{ fontSize: 12, color: '#b42318' }}>
              That change was refused by the server and was NOT applied.
            </span>
          ) : null}

          {list.data.map((s) => (
            <section key={s.key} data-testid={`setting-${s.key}`} style={{ ...PANEL, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 13, overflowWrap: 'anywhere', minWidth: 0 }}>{s.key}</strong>
                <span style={{ fontSize: 11, color: '#626a7e', whiteSpace: 'nowrap' }}>
                  {s.isCustomised ? 'customised' : 'default'}{s.isPublic ? ' · public' : ''}
                </span>
              </div>
              <p style={{ fontSize: 11, color: '#515970', margin: '6px 0 10px', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
                {s.description}
              </p>

              {s.type === 'BOOLEAN' ? (
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, fontSize: 14, cursor: mayWrite ? 'pointer' : 'default' }}>
                  <input
                    data-testid={`setting-input-${s.key}`}
                    type="checkbox"
                    disabled={!mayWrite}
                    checked={Boolean(draftOf(s))}
                    onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: e.target.checked }))}
                    style={{ width: 20, height: 20 }}
                  />
                  {Boolean(draftOf(s)) ? 'Enabled' : 'Disabled'}
                </label>
              ) : (
                <input
                  data-testid={`setting-input-${s.key}`}
                  disabled={!mayWrite}
                  inputMode={s.type === 'INTEGER' ? 'numeric' : 'text'}
                  value={String(draftOf(s) ?? '')}
                  onChange={(e) => setDrafts((d) => ({
                    ...d,
                    [s.key]: s.type === 'INTEGER' ? e.target.value : e.target.value,
                  }))}
                  style={FIELD}
                />
              )}

              {mayWrite ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, minWidth: 0 }}>
                  <button
                    data-testid={`setting-save-${s.key}`}
                    onClick={() => save.mutate({
                      key: s.key,
                      value: s.type === 'INTEGER' ? Number(draftOf(s)) : draftOf(s),
                    })}
                    disabled={save.isPending}
                    style={{ ...FIELD, flex: '0 0 auto', width: 'auto', padding: '0 16px', cursor: 'pointer',
                             border: '1px solid #86c9a6', background: '#e6f6ee', fontWeight: 700 }}
                  >
                    {save.isPending ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    data-testid={`setting-reset-${s.key}`}
                    onClick={() => reset.mutate(s.key)}
                    disabled={reset.isPending || !s.isCustomised}
                    style={{ ...FIELD, flex: '0 0 auto', width: 'auto', padding: '0 16px',
                             cursor: s.isCustomised ? 'pointer' : 'not-allowed', opacity: s.isCustomised ? 1 : 0.5 }}
                  >
                    Reset to default
                  </button>
                </div>
              ) : null}
            </section>
          ))}

          {/* Honest statement of what this screen deliberately cannot do. */}
          <section data-testid="settings-excluded" style={{ ...PANEL, borderColor: '#fff7e6', minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#8a5300', marginBottom: 6 }}>
              Not editable here, by design
            </div>
            <p style={{ fontSize: 11, color: '#515970', margin: 0, lineHeight: 1.6 }}>
              Game odds and variant configuration, wallet and payout settings, settlement behaviour,
              responsible-gaming enforcement and session-security controls are money- or
              safety-affecting. They are not exposed through this screen, and the server rejects any
              attempt to change them here.
            </p>
          </section>
        </div>
      ) : (
        <div data-testid="settings-empty" style={{ ...PANEL, fontSize: 13, color: '#515970' }}>
          No manageable settings are configured.
        </div>
      )}
    </div>
  );
}
