'use client';

/**
 * LotteryMoneyBoard — real-money Number Lottery (Phase 2C.3), mobile-first.
 *
 * Authenticated: the player picks numbers (manual or quick-pick) and buys a ticket into the SHARED
 * scheduled draw via the backend money bridge (`/games/lottery/buy`). Ticket purchase RESERVES the
 * price; the winning numbers, prize and balance are the authoritative server values when the draw
 * resolves (no demo wallet). Large touch-friendly 1–pool grid, quick pick / clear / confirm, draw
 * countdown, my-tickets history, and a provably-fair panel. No horizontal overflow at 375/390/412.
 */
import { useLotteryMoney } from './use-lottery-money';

function countdown(drawAt?: string | null): string {
  if (!drawAt) return '—';
  const ms = new Date(drawAt).getTime() - Date.now();
  if (ms <= 0) return 'drawing…';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

export function LotteryMoneyBoard() {
  const g = useLotteryMoney();
  const numbers = Array.from({ length: g.pool }, (_, i) => i + 1);

  return (
    <div style={{ color: '#e5e7eb', maxWidth: 460, margin: '0 auto', padding: '0 4px', boxSizing: 'border-box' }}>
      {/* sticky authoritative balance + draw countdown */}
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#0b0f19', padding: '10px 12px', borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #1f2937', marginBottom: 12 }}>
        <div><div style={{ fontSize: 11, opacity: 0.6 }}>Balance</div><b data-testid="balance" style={{ fontSize: 19, color: '#34d399' }}>{g.balance === null ? '—' : `₹${g.balance}`}</b></div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, opacity: 0.6 }}>Draw #{g.draw?.drawNumber ?? '—'} in</div>
          <b data-testid="countdown" style={{ fontSize: 17, color: '#fbbf24' }}>{countdown(g.draw?.drawAt)}</b>
        </div>
      </div>

      {/* selected numbers */}
      <div style={{ textAlign: 'center', minHeight: 60, background: 'radial-gradient(ellipse at center,#1e1b4b,#0b0f19)', borderRadius: 16, padding: 12, marginBottom: 10 }}>
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Your numbers ({g.picks.length}/{g.pick})</div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap', minHeight: 34 }}>
          {g.picks.length === 0 ? <span style={{ opacity: 0.5, fontSize: 13 }}>Tap numbers or Quick Pick</span> : g.picks.map((n) => (
            <span key={n} style={{ width: 34, height: 34, borderRadius: '50%', background: '#7c3aed', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14 }}>{n}</span>
          ))}
        </div>
      </div>

      {/* actions */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button data-testid="quick-pick" onClick={g.quickPick} style={secBtn()}>Quick Pick</button>
        <button data-testid="clear" onClick={g.clear} style={secBtn()}>Clear</button>
      </div>

      {/* number grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 5, marginBottom: 12 }}>
        {numbers.map((n) => {
          const on = g.picks.includes(n);
          return (
            <button key={n} data-testid={`num-${n}`} onClick={() => g.toggle(n)} aria-pressed={on}
              style={{ aspectRatio: '1', borderRadius: 8, border: on ? '2px solid #fbbf24' : '1px solid #334155', background: on ? '#7c3aed' : '#111827', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: 0 }}>{n}</button>
          );
        })}
      </div>

      {g.error && <div data-testid="error" style={{ color: '#fca5a5', fontSize: 13, margin: '6px 2px' }}>⚠ {g.error}</div>}

      {/* confirm — large one-hand tap target */}
      <button data-testid="confirm" onClick={() => void g.buy()} disabled={g.buying || g.balance === null || !g.complete}
        style={{ width: '100%', padding: '16px', borderRadius: 14, border: 'none', background: g.buying ? '#3730a3' : !g.complete ? '#374151' : '#7c3aed', color: 'white', fontWeight: 800, fontSize: 18, cursor: 'pointer' }}>
        {g.buying ? 'Buying…' : !g.complete ? `Pick ${g.pick} numbers` : `Confirm Ticket · ₹${g.config?.ticketPrice ?? ''}`}
      </button>

      {/* prize tiers */}
      {g.config && (
        <div style={{ fontSize: 11, opacity: 0.6, textAlign: 'center', marginTop: 8 }}>
          Prizes: {Object.entries(g.config.prizeTiers).map(([m, x]) => `${m}★ ×${x}`).join(' · ')} · Draw #{g.draw?.drawNumber ?? '—'}
        </div>
      )}

      {/* my tickets */}
      {g.tickets.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, margin: '0 2px 6px' }}>My tickets</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {g.tickets.slice(0, 10).map((t) => (
              <div key={t.ticketId} style={{ border: '1px solid #1f2937', borderRadius: 10, padding: '8px 10px', fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Draw #{t.drawNumber ?? '—'} · {t.picks.join(', ')}</span>
                  <span style={{ fontWeight: 700, color: t.settled ? (t.won ? '#34d399' : '#fca5a5') : '#fbbf24' }}>
                    {t.settled ? (t.won ? `WON ₹${t.payout}` : 'no win') : t.status === 'RESERVED' ? 'pending draw' : t.status}
                  </span>
                </div>
                {t.settled && t.winningNumbers.length > 0 && (
                  <div style={{ opacity: 0.6, marginTop: 2 }}>won numbers: {t.winningNumbers.join(', ')}{t.matches != null ? ` · ${t.matches} match` : ''}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* provably fair */}
      <div style={{ marginTop: 14, fontSize: 10, opacity: 0.45, wordBreak: 'break-all' }}>
        Provably fair · draw commitment (serverSeedHash): {g.draw?.serverSeedHash ?? '—'}
      </div>
      <p style={{ fontSize: 11, opacity: 0.45, textAlign: 'center', marginTop: 8 }}>
        Real-money ticket · shared scheduled draw · winning numbers &amp; balance are authoritative from the server.
      </p>
    </div>
  );
}

function secBtn(): React.CSSProperties {
  return { flex: 1, padding: '12px', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 700, border: '1px solid #334155', background: '#111827', color: '#e5e7eb' };
}

export default LotteryMoneyBoard;
