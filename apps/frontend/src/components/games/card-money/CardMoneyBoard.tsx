'use client';

/**
 * CardMoneyBoard — shared real-money board for Dragon Tiger · Andar Bahar · Teen Patti (Phase 2C.7),
 * mobile-first & config-driven. The bet menu (keys, labels, payouts) comes from the config API; the
 * dealt hands, winner, winning bets, payout and balance are the authoritative server values (no demo
 * wallet). Large touch bet chips, sticky balance, clear result. No horizontal overflow at 375/390/412.
 */
import { useCardMoney } from './use-card-money';
import type { CardVariant } from '@/lib/card-money-api';

const TITLES: Record<CardVariant, string> = { 'dragon-tiger': 'Dragon Tiger', 'andar-bahar': 'Andar Bahar', 'teen-patti': 'Teen Patti' };

function isRed(card: string): boolean {
  return /[HD]$/i.test(card) || card.includes('♥') || card.includes('♦');
}

function CardChip({ code }: { code: string }) {
  return (
    <span style={{ display: 'inline-flex', minWidth: 30, height: 42, alignItems: 'center', justifyContent: 'center', padding: '0 6px', borderRadius: 6, background: '#f8fafc', color: isRed(code) ? '#dc2626' : '#0f172a', fontWeight: 800, fontSize: 15, border: '1px solid #cbd5e1' }}>{code}</span>
  );
}

export function CardMoneyBoard({ variant }: { variant: CardVariant }) {
  const g = useCardMoney(variant);
  const min = g.config?.limits.min ?? 1;
  const max = g.config?.limits.max ?? 10000;
  const r = g.lastResult;
  const selBet = g.bets.find((b) => b.key === g.betKey);
  const potential = selBet ? (Number(g.stake) * selBet.payout).toFixed(2) : '0.00';
  const sides = g.config?.sides ?? [];

  return (
    <div style={{ color: '#e5e7eb', maxWidth: 460, margin: '0 auto', padding: '0 4px 24px', boxSizing: 'border-box' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#0b0f19', padding: '10px 12px', borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #1f2937', marginBottom: 12 }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{TITLES[variant]} · Balance</span>
        <b data-testid="balance" style={{ fontSize: 20, color: '#34d399' }}>{g.balance === null ? '—' : `₹${g.balance}`}</b>
      </div>

      {/* result: dealt hands + winner */}
      <div style={{ minHeight: 116, background: 'radial-gradient(ellipse at center,#1e1b4b,#0b0f19)', borderRadius: 16, padding: 14, marginBottom: 12, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {r ? (
          <>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              {sides.filter((s) => (r.hands[s]?.length ?? 0) > 0).map((s) => (
                <div key={s} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, opacity: 0.6, textTransform: 'capitalize', marginBottom: 4 }}>{s}{r.winners.includes(s) ? ' 👑' : ''}</div>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap', maxWidth: 200 }}>{(r.hands[s] ?? []).map((c, i) => <CardChip key={i} code={c} />)}</div>
                </div>
              ))}
            </div>
            <div data-testid="multiplier" style={{ textAlign: 'center', fontWeight: 800, fontSize: 16, color: Number(r.payout) > 0 ? '#34d399' : '#fca5a5' }}>
              {r.isTie ? 'TIE · ' : ''}{Number(r.payout) > 0 ? `WON ₹${r.payout}` : 'LOST'}{r.winningBets.length ? ` · ${r.winningBets.join(', ')}` : ''}
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', opacity: 0.6, fontSize: 13 }}>Pick a bet &amp; stake, then Deal.</div>
        )}
      </div>

      {/* bet options from config */}
      <div style={{ fontSize: 12, opacity: 0.7, margin: '4px 2px' }}>Bet</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {g.bets.map((b) => (
          <button key={b.key} data-testid={`bet-${b.key}`} onClick={() => g.setBetKey(b.key)} aria-pressed={g.betKey === b.key}
            style={{ flex: '1 1 30%', minWidth: 92, padding: '14px 8px', borderRadius: 12, cursor: 'pointer', border: g.betKey === b.key ? '2px solid #fbbf24' : '1px solid #334155', background: g.betKey === b.key ? '#78350f' : '#111827', color: '#e5e7eb' }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>{b.label}</div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>{b.payout}×</div>
          </button>
        ))}
      </div>

      <div style={{ fontSize: 12, opacity: 0.7, margin: '4px 2px' }}>Stake (₹{min}–₹{max}) · pays ₹{potential}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {['5', '10', '25', '50', '100'].map((s) => (
          <button key={s} onClick={() => g.setStake(s)} style={chip(g.stake === s)} aria-pressed={g.stake === s}>₹{s}</button>
        ))}
        <input inputMode="decimal" value={g.stake} onChange={(e) => g.setStake(e.target.value.replace(/[^\d.]/g, ''))} aria-label="stake"
          style={{ width: 80, padding: '10px 12px', borderRadius: 10, border: '1px solid #334155', background: '#111827', color: '#e5e7eb', fontSize: 15 }} />
      </div>

      {g.error && <div data-testid="error" style={{ color: '#fca5a5', fontSize: 13, margin: '6px 2px' }}>⚠ {g.error}</div>}

      <button data-testid="play" onClick={() => g.play()} disabled={g.playing || g.balance === null || !g.betKey}
        style={{ width: '100%', padding: '16px', borderRadius: 14, border: 'none', background: !g.betKey ? '#374151' : g.playing ? '#3730a3' : '#7c3aed', color: 'white', fontWeight: 800, fontSize: 18, cursor: 'pointer' }}>
        {g.playing ? 'Dealing…' : `Deal ₹${g.stake}${selBet ? ` on ${selBet.label}` : ''}`}
      </button>

      <p style={{ fontSize: 11, opacity: 0.45, textAlign: 'center', marginTop: 10 }}>Real-money round · provably fair · cards &amp; balance are authoritative from the server.</p>
    </div>
  );
}

function chip(active: boolean): React.CSSProperties {
  return { padding: '11px 14px', minWidth: 52, borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 700, border: active ? '2px solid #fbbf24' : '1px solid #334155', background: active ? '#78350f' : '#111827', color: '#e5e7eb' };
}

export default CardMoneyBoard;
