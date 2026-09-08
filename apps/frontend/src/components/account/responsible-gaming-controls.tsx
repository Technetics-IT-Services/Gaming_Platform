'use client';

/**
 * Responsible gaming — the REAL, server-enforced controls.
 *
 * Every limit and restriction shown here is persisted server-side and enforced before any money or
 * game action, by a guard that runs ahead of the frozen money core. Nothing on this screen is a
 * client-side check: if the network call fails, the user is told the change did NOT take effect
 * rather than being shown an optimistic success.
 *
 * Usage figures are computed by the server from authoritative financial tables, never here.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  LIMIT_PERIODS,
  LIMIT_TYPES,
  responsibleGamingApi,
  type LimitPeriod,
  type LimitType,
} from '@/lib/responsible-gaming-api';

const PANEL: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #ccd2e0', borderRadius: 14, padding: 14,
};
const FIELD: React.CSSProperties = {
  minHeight: 44, padding: '0 10px', borderRadius: 10, border: '1px solid #b9c1d4',
  background: '#ebeef5', color: '#1b1f37', fontSize: 14, width: '100%', boxSizing: 'border-box',
};

const TYPE_LABEL: Record<LimitType, string> = {
  DEPOSIT: 'Deposit limit',
  WAGER: 'Wager limit',
  LOSS: 'Loss limit',
};

const TYPE_HELP: Record<LimitType, string> = {
  DEPOSIT: 'Caps how much you can deposit in the period.',
  WAGER: 'Caps your total stake in the period.',
  LOSS: 'Caps your net loss (stakes minus winnings) in the period.',
};

export function ResponsibleGamingControls({ currency = 'INR' }: { currency?: string }) {
  const qc = useQueryClient();
  const [type, setType] = useState<LimitType>('DEPOSIT');
  const [period, setPeriod] = useState<LimitPeriod>('DAILY');
  const [amount, setAmount] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmExclude, setConfirmExclude] = useState(false);
  const [coolOffDays, setCoolOffDays] = useState('7');

  const overview = useQuery({
    queryKey: ['rg', 'overview'],
    queryFn: responsibleGamingApi.overview,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['rg', 'overview'] });

  const setLimit = useMutation({
    mutationFn: () => responsibleGamingApi.setLimit({ type, period, amount, currency }),
    onSuccess: (r) => {
      setAmount('');
      setNotice(
        new Date(r.effectiveFrom).getTime() > Date.now() + 60_000
          ? `Saved. This increase takes effect at ${new Date(r.effectiveFrom).toLocaleString()}.`
          : 'Saved. This limit is active now.',
      );
      invalidate();
    },
    onError: () => setNotice(null),
  });

  const removeLimit = useMutation({
    mutationFn: (v: { type: LimitType; period: LimitPeriod }) =>
      responsibleGamingApi.removeLimit({ ...v, currency }),
    onSuccess: () => { setNotice('Limit removed.'); invalidate(); },
  });

  const selfExclude = useMutation({
    mutationFn: () => responsibleGamingApi.createRestriction({ type: 'SELF_EXCLUSION' }),
    onSuccess: () => { setConfirmExclude(false); setNotice('Self-exclusion is active.'); invalidate(); },
  });

  const coolOff = useMutation({
    mutationFn: () => {
      const days = Math.max(1, Number.parseInt(coolOffDays, 10) || 1);
      return responsibleGamingApi.createRestriction({
        type: 'COOLING_OFF',
        endsAt: new Date(Date.now() + days * 86_400_000).toISOString(),
      });
    },
    onSuccess: () => { setNotice('Cooling-off period started.'); invalidate(); },
  });

  const d = overview.data;
  const activeRestriction = d?.restrictions.find((r) => r.status === 'ACTIVE');

  return (
    <div data-testid="rg-controls" style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      {activeRestriction ? (
        <section data-testid="rg-active-restriction" style={{ ...PANEL, borderColor: '#f0b4b0' }} role="alert">
          <div style={{ fontSize: 14, fontWeight: 800, color: '#b42318', marginBottom: 6 }}>
            {activeRestriction.type === 'SELF_EXCLUSION' ? 'Self-exclusion active' : 'Cooling-off active'}
          </div>
          <p style={{ fontSize: 12, opacity: 0.8, margin: 0, lineHeight: 1.6 }}>
            Playing and depositing are blocked
            {activeRestriction.endsAt
              ? ` until ${new Date(activeRestriction.endsAt).toLocaleString()}.`
              : ' indefinitely.'}{' '}
            You can still withdraw your balance. Only support can lift this early.
          </p>
        </section>
      ) : null}

      {/* ---------------------------------------------------------- limits */}
      <section style={{ ...PANEL, minWidth: 0 }}>
        <h2 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 4px' }}>Your limits</h2>
        <p style={{ fontSize: 12, color: '#515970', margin: '0 0 12px', lineHeight: 1.5 }}>
          Enforced by the server before any deposit or bet. Reducing a limit takes effect immediately.
        </p>

        {overview.isLoading ? (
          <div data-testid="rg-loading" style={{ height: 60, opacity: 0.4 }} />
        ) : overview.isError ? (
          <div data-testid="rg-error" role="alert" style={{ fontSize: 13, color: '#b42318' }}>
            Could not load your limits. They may still be active — please retry before assuming otherwise.
          </div>
        ) : d && d.limits.length > 0 ? (
          <ul data-testid="rg-limit-list" style={{ listStyle: 'none', margin: '0 0 12px', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {d.limits.map((l) => (
              <li key={`${l.type}-${l.period}-${l.currency}`}
                  style={{ border: '1px solid #ccd2e0', borderRadius: 10, padding: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 13 }}>{TYPE_LABEL[l.type]} · {l.period.toLowerCase()}</strong>
                  <span style={{ fontSize: 13 }}>{l.limit} {l.currency}</span>
                </div>
                <div style={{ fontSize: 12, color: '#515970', marginTop: 4 }}>
                  Used {l.used} · Remaining {l.remaining}
                </div>
                <button
                  data-testid={`rg-remove-${l.type}-${l.period}`}
                  onClick={() => removeLimit.mutate({ type: l.type, period: l.period })}
                  disabled={removeLimit.isPending}
                  style={{
                    minHeight: 44, marginTop: 8, padding: '0 12px', borderRadius: 10, fontSize: 13,
                    border: '1px solid #b9c1d4', background: '#ebeef5', color: '#1b1f37', cursor: 'pointer',
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p data-testid="rg-no-limits" style={{ fontSize: 13, color: '#515970', margin: '0 0 12px' }}>
            No limits set. Your play is currently uncapped.
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: '#515970' }}>Limit type</span>
            <select data-testid="rg-type" value={type} onChange={(e) => setType(e.target.value as LimitType)} style={FIELD}>
              {LIMIT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
          </label>
          <p style={{ fontSize: 11, color: '#626a7e', margin: 0 }}>{TYPE_HELP[type]}</p>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: '#515970' }}>Period</span>
            <select data-testid="rg-period" value={period} onChange={(e) => setPeriod(e.target.value as LimitPeriod)} style={FIELD}>
              {LIMIT_PERIODS.map((p) => <option key={p} value={p}>{p.toLowerCase()}</option>)}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: '#515970' }}>Amount ({currency})</span>
            <input data-testid="rg-amount" inputMode="decimal" value={amount}
                   onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 5000" style={FIELD} />
          </label>

          <button
            data-testid="rg-save-limit"
            onClick={() => setLimit.mutate()}
            disabled={!amount || setLimit.isPending}
            style={{
              minHeight: 44, borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer',
              border: '1px solid #86c9a6', background: '#e6f6ee', color: '#1b1f37',
              opacity: !amount || setLimit.isPending ? 0.6 : 1,
            }}
          >
            {setLimit.isPending ? 'Saving…' : 'Save limit'}
          </button>

          {setLimit.isError ? (
            <span data-testid="rg-save-error" role="alert" style={{ fontSize: 12, color: '#b42318' }}>
              Could not save. Your limit was NOT changed.
            </span>
          ) : null}
          {notice ? (
            <span data-testid="rg-notice" role="status" style={{ fontSize: 12, color: '#0f7a4a' }}>{notice}</span>
          ) : null}
        </div>
      </section>

      {/* ------------------------------------------------------ take a break */}
      <section style={{ ...PANEL, minWidth: 0 }}>
        <h2 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 4px' }}>Take a break</h2>
        <p style={{ fontSize: 12, color: '#515970', margin: '0 0 12px', lineHeight: 1.5 }}>
          Blocks playing and depositing. You can always withdraw your balance.
        </p>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: '#515970' }}>Cooling-off (days)</span>
          <input data-testid="rg-cooloff-days" inputMode="numeric" value={coolOffDays}
                 onChange={(e) => setCoolOffDays(e.target.value)} style={FIELD} />
        </label>
        <button
          data-testid="rg-cooloff"
          onClick={() => coolOff.mutate()}
          disabled={coolOff.isPending || !!activeRestriction}
          style={{
            minHeight: 44, width: '100%', borderRadius: 10, fontSize: 14, fontWeight: 700,
            border: '1px solid #b9c1d4', background: '#ebeef5', color: '#1b1f37',
            cursor: activeRestriction ? 'not-allowed' : 'pointer', opacity: activeRestriction ? 0.5 : 1,
          }}
        >
          {coolOff.isPending ? 'Starting…' : 'Start cooling-off'}
        </button>

        <div style={{ height: 1, background: '#ccd2e0', margin: '14px 0' }} />

        {!confirmExclude ? (
          <button
            data-testid="rg-self-exclude"
            onClick={() => setConfirmExclude(true)}
            disabled={!!activeRestriction}
            style={{
              minHeight: 44, width: '100%', borderRadius: 10, fontSize: 14, fontWeight: 700,
              border: '1px solid #f0b4b0', background: '#ebeef5', color: '#b42318',
              cursor: activeRestriction ? 'not-allowed' : 'pointer', opacity: activeRestriction ? 0.5 : 1,
            }}
          >
            Self-exclude indefinitely
          </button>
        ) : (
          <div data-testid="rg-exclude-confirm" style={{ border: '1px solid #f0b4b0', borderRadius: 10, padding: 10 }}>
            <p style={{ fontSize: 12, margin: '0 0 10px', lineHeight: 1.6, color: '#b42318' }}>
              This blocks playing and depositing <strong>indefinitely</strong>. Only support can lift it.
              You will still be able to withdraw your balance. Are you sure?
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                data-testid="rg-exclude-confirm-yes"
                onClick={() => selfExclude.mutate()}
                disabled={selfExclude.isPending}
                style={{ minHeight: 44, flex: '1 1 120px', borderRadius: 10, fontSize: 13, fontWeight: 700,
                         border: '1px solid #f0b4b0', background: '#f0b4b0', color: '#fff', cursor: 'pointer' }}
              >
                {selfExclude.isPending ? 'Applying…' : 'Yes, exclude me'}
              </button>
              <button
                onClick={() => setConfirmExclude(false)}
                style={{ minHeight: 44, flex: '1 1 120px', borderRadius: 10, fontSize: 13,
                         border: '1px solid #b9c1d4', background: '#ebeef5', color: '#1b1f37', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
