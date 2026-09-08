'use client';

/**
 * BlackjackMoneyBoard — real-money Blackjack (Phase 2C.4), mobile-first.
 *
 * Authenticated & INTERACTIVE: start deals a hand via the backend money bridge
 * (`/games/blackjack/start`); HIT / STAND / DOUBLE actions (`/action`) advance it. The cards,
 * dealer play, result, payout and balance are the authoritative server values (no demo wallet).
 * Sticky balance; dealer + player hands with scores (hole card hidden while active); large HIT /
 * STAND controls with a sticky bottom action bar; DOUBLE shown only when legal. Only legal actions
 * render — no disabled clutter. No horizontal overflow at 375/390/412.
 */
import { useBlackjackMoney } from './use-blackjack-money';

const STAKE_CHIPS = ['5', '10', '25', '50', '100'];

function Card({ code, hidden }: { code?: string; hidden?: boolean }) {
  if (hidden || !code) {
    return <span style={{ display: 'inline-block', width: 40, height: 56, borderRadius: 7, background: 'repeating-linear-gradient(45deg,#3730a3,#3730a3 6px,#4338ca 6px,#4338ca 12px)', border: '1px solid #6366f1' }} />;
  }
  const rank = code.slice(0, code.length - 1).replace('T', '10');
  const s = code.slice(-1);
  const suit = s === 'H' ? '♥' : s === 'D' ? '♦' : s === 'C' ? '♣' : s === 'S' ? '♠' : '★';
  const red = s === 'H' || s === 'D';
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 40, height: 56, borderRadius: 7, background: '#fff', color: red ? '#b91c1c' : '#111827', fontWeight: 800, border: '1px solid #cbd5e1' }}>
      <span style={{ fontSize: 16, lineHeight: 1 }}>{rank}</span>
      <span style={{ fontSize: 17, lineHeight: 1 }}>{suit}</span>
    </span>
  );
}

export function BlackjackMoneyBoard() {
  const g = useBlackjackMoney();
  const h = g.hand;
  const legal = h?.legalActions ?? [];
  const min = g.config?.limits.min ?? 1;
  const max = g.config?.limits.max ?? 10000;
  const resultColor = h && !h.active ? (Number(h.payout) > 0 ? (h.winner === 'push' ? '#fbbf24' : '#34d399') : '#fca5a5') : '#e5e7eb';

  return (
    <div style={{ color: '#e5e7eb', maxWidth: 460, margin: '0 auto', padding: '0 4px 96px', boxSizing: 'border-box' }}>
      {/* sticky authoritative balance */}
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#0b0f19', padding: '10px 12px', borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #1f2937', marginBottom: 12 }}>
        <div><div style={{ fontSize: 11, opacity: 0.6 }}>Balance</div><b data-testid="balance" style={{ fontSize: 19, color: '#34d399' }}>{g.balance === null ? '—' : `₹${g.balance}`}</b></div>
        <div style={{ textAlign: 'right' }}><div style={{ fontSize: 11, opacity: 0.6 }}>Stake</div><b style={{ fontSize: 17, color: '#fbbf24' }}>₹{h ? h.stake : g.stake}</b></div>
      </div>

      {/* table */}
      <div style={{ background: 'radial-gradient(ellipse at center,#0f5132,#062916)', borderRadius: 16, padding: 14, marginBottom: 12, minHeight: 180 }}>
        {/* dealer */}
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>Dealer {h && !h.active ? `· ${h.dealerValue}` : ''}</div>
        <div data-testid="dealer" style={{ display: 'flex', gap: 6, minHeight: 56, marginBottom: 12 }}>
          {h ? (
            h.active
              ? <> <Card code={h.dealer[0]} /> <Card hidden /> </>
              : h.dealer.map((c, i) => <Card key={i} code={c} />)
          ) : <span style={{ opacity: 0.5, fontSize: 13 }}>—</span>}
        </div>
        {/* player */}
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>You {h ? `· ${h.playerValue}` : ''}{h?.doubled ? ' · doubled' : ''}</div>
        <div data-testid="player" style={{ display: 'flex', gap: 6, minHeight: 56, flexWrap: 'wrap' }}>
          {h ? h.player.map((c, i) => <Card key={i} code={c} />) : <span style={{ opacity: 0.5, fontSize: 13 }}>—</span>}
        </div>
        {h && !h.active && (
          <div style={{ textAlign: 'center', marginTop: 10, fontWeight: 800, fontSize: 16, color: resultColor }}>
            {h.winner === 'push' ? 'PUSH' : Number(h.payout) > 0 ? `YOU WIN +₹${h.payout}` : 'DEALER WINS'}
          </div>
        )}
      </div>

      {g.error && <div data-testid="error" style={{ color: '#fca5a5', fontSize: 13, margin: '6px 2px' }}>⚠ {g.error}</div>}

      {/* pre-hand: stake + deal */}
      {!g.active && (
        <>
          {g.settled ? (
            <button data-testid="new-hand" onClick={g.newHand} style={{ width: '100%', padding: '16px', borderRadius: 14, border: 'none', background: '#7c3aed', color: 'white', fontWeight: 800, fontSize: 18, cursor: 'pointer' }}>New Hand</button>
          ) : (
            <>
              <div style={{ fontSize: 12, opacity: 0.7, margin: '4px 2px' }}>Stake (₹{min}–₹{max})</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                {STAKE_CHIPS.map((s) => (
                  <button key={s} onClick={() => g.setStake(s)} style={chip(g.stake === s)} aria-pressed={g.stake === s}>₹{s}</button>
                ))}
                <input inputMode="decimal" value={g.stake} onChange={(e) => g.setStake(e.target.value.replace(/[^\d.]/g, ''))} aria-label="stake"
                  style={{ width: 80, padding: '10px 12px', borderRadius: 10, border: '1px solid #334155', background: '#111827', color: '#e5e7eb', fontSize: 15 }} />
              </div>
              <button data-testid="deal" onClick={() => void g.start()} disabled={g.starting || g.balance === null}
                style={{ width: '100%', padding: '16px', borderRadius: 14, border: 'none', background: g.starting ? '#3730a3' : '#7c3aed', color: 'white', fontWeight: 800, fontSize: 18, cursor: 'pointer' }}>
                {g.starting ? 'Dealing…' : `Deal ₹${g.stake}`}
              </button>
            </>
          )}
        </>
      )}

      {/* active hand: sticky bottom action bar — large HIT / STAND, DOUBLE when legal */}
      {g.active && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 10, background: 'linear-gradient(#0b0f19cc,#0b0f19)', padding: '10px 12px calc(10px + env(safe-area-inset-bottom))', borderTop: '1px solid #1f2937' }}>
          <div style={{ maxWidth: 460, margin: '0 auto', display: 'flex', gap: 8 }}>
            <button data-testid="hit" onClick={() => g.act('HIT')} disabled={g.acting} style={actionBtn('#10b981', '#04231a')}>HIT</button>
            <button data-testid="stand" onClick={() => g.act('STAND')} disabled={g.acting} style={actionBtn('#f59e0b', '#231a04')}>STAND</button>
            {legal.includes('DOUBLE') && (
              <button data-testid="double" onClick={() => g.act('DOUBLE')} disabled={g.acting} style={actionBtn('#7c3aed', '#fff', 0.85)}>2×</button>
            )}
          </div>
        </div>
      )}

      <p style={{ fontSize: 11, opacity: 0.45, textAlign: 'center', marginTop: 10 }}>
        Real-money hand · provably fair · cards &amp; balance are authoritative from the server. Split/insurance not offered.
      </p>
    </div>
  );
}

function chip(active: boolean): React.CSSProperties {
  return { padding: '11px 14px', minWidth: 56, borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 700, border: active ? '2px solid #fbbf24' : '1px solid #334155', background: active ? '#78350f' : '#111827', color: '#e5e7eb' };
}
function actionBtn(bg: string, color: string, flex = 1): React.CSSProperties {
  return { flex, padding: '18px 8px', borderRadius: 14, border: 'none', background: bg, color, fontWeight: 900, fontSize: 18, cursor: 'pointer' };
}

export default BlackjackMoneyBoard;
