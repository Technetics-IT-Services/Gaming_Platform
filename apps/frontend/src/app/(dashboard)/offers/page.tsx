'use client';

/**
 * Live offers (AD-08, player side) — REAL server data.
 *
 * Every card here is a `Promotion` row the operator actually published and activated: ACTIVE, inside
 * its scheduled window, and not past its redemption cap. If none are published the page says so
 * rather than inventing offers.
 *
 * This is deliberately a SEPARATE route from the fictional demo `/promotions` showcase, exactly as
 * the real `/lobby` sits beside the demo `/games` lobby. There is no claim button and no bonus
 * value, because awarding is blocked on a missing business rule — the server's own reason is shown.
 */
import { useQuery } from '@tanstack/react-query';

import { promotionsApi } from '@/lib/promotions-api';

const PANEL: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #ccd2e0', borderRadius: 14, padding: 14,
};

const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');

const window_ = (startsAt: string | null, endsAt: string | null): string | null => {
  const d = (v: string) => new Date(v).toLocaleDateString();
  if (startsAt && endsAt) return `${d(startsAt)} – ${d(endsAt)}`;
  if (endsAt) return `until ${d(endsAt)}`;
  if (startsAt) return `from ${d(startsAt)}`;
  return null;
};

export default function OffersPage() {
  const offers = useQuery({ queryKey: ['promotions', 'active'], queryFn: promotionsApi.active });
  const d = offers.data;

  return (
    <div
      data-testid="offers-page"
      style={{
        color: '#1b1f37', width: '100%', maxWidth: 560, minWidth: 0,
        margin: '0 auto', padding: '12px 12px 28px', boxSizing: 'border-box',
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 2px 6px' }}>Offers</h1>
      <p style={{ fontSize: 12, color: '#515970', margin: '0 2px 14px', lineHeight: 1.5 }}>
        Offers currently published by the operator.
      </p>

      {offers.isLoading ? (
        <div data-testid="offers-loading" style={{ ...PANEL, height: 110 }} />
      ) : offers.isError ? (
        <div data-testid="offers-error" role="alert" style={{ ...PANEL, borderColor: '#f0b4b0', color: '#b42318' }}>
          Could not load offers. Please try again.
        </div>
      ) : d ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {d.items.length === 0 ? (
            <div data-testid="offers-empty" style={{ ...PANEL, fontSize: 13, color: '#515970', lineHeight: 1.6 }}>
              There are no offers running right now. When the operator publishes one it appears here.
            </div>
          ) : (
            <ul data-testid="offers-list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {d.items.map((p) => {
                const w = window_(p.startsAt, p.endsAt);
                return (
                  <li key={p.id} data-testid={`offer-${p.code}`} style={{ ...PANEL, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 15, overflowWrap: 'anywhere', minWidth: 0 }}>{p.name}</strong>
                      <span style={{ fontSize: 10, color: '#515970', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        {label(p.type)}
                      </span>
                    </div>
                    {p.description ? (
                      <p style={{ fontSize: 12, color: '#515970', margin: '6px 0 0', lineHeight: 1.55, overflowWrap: 'anywhere' }}>
                        {p.description}
                      </p>
                    ) : null}
                    <div style={{ fontSize: 11, color: '#626a7e', marginTop: 8, overflowWrap: 'anywhere' }}>
                      code {p.code}{w ? ` · ${w}` : ''}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {d.unavailable.length > 0 ? (
            <section data-testid="offers-unavailable" style={{ ...PANEL, borderColor: '#fff7e6', minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#8a5300', marginBottom: 6 }}>
                How to take part
              </div>
              <p style={{ fontSize: 11, color: '#515970', margin: 0, lineHeight: 1.55 }}>
                These are published offers, not credited bonuses. Nothing is added to your balance from
                this page — contact support to ask how an offer applies to your account.
              </p>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 11, lineHeight: 1.6, color: '#515970' }}>
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
