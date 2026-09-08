'use client';

/**
 * RoundDetail — compact "what happened to my money?" traceability timeline (Phase 2C.4).
 *
 * Shows the server-authoritative chain for one round: GAME ROUND → STAKE → RESERVATION → RESULT →
 * PAYOUT → WALLET BALANCE → LEDGER, from a single backend response. No client calculation, no demo
 * wallet. Rendered as a mobile bottom-sheet; provably-fair secrets are only present when the backend
 * reveals them (redacted while a round is still active).
 */
import { useRoundDetails } from './use-game-history';

function fmt(ts?: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function Step({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#7c3aed', marginTop: 4 }} />
        <span style={{ flex: 1, width: 2, background: '#ccd2e0' }} />
      </div>
      <div style={{ flex: 1, paddingBottom: 14 }}>
        <div style={{ fontSize: 11, letterSpacing: 0.5, color: '#515970', textTransform: 'uppercase', fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 13, marginTop: 3 }}>{children}</div>
      </div>
    </div>
  );
}

export function RoundDetail({ roundId, onClose }: { roundId: string; onClose: () => void }) {
  const { details, loading, error } = useRoundDetails(roundId);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, background: '#000a', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} data-testid="round-detail" style={{ width: '100%', maxWidth: 480, maxHeight: '88vh', overflowY: 'auto', background: '#ebeef5', color: '#1b1f37', borderRadius: '18px 18px 0 0', border: '1px solid #ccd2e0', padding: '16px 16px calc(20px + env(safe-area-inset-bottom))' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <b style={{ fontSize: 15 }}>Round traceability</b>
          <button data-testid="close-detail" onClick={onClose} aria-label="close" style={{ background: 'none', border: 'none', color: '#515970', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {loading && <div data-testid="detail-loading" style={{ color: '#515970', fontSize: 13, padding: 24, textAlign: 'center' }}>Loading…</div>}
        {error && <div data-testid="detail-error" style={{ color: '#b42318', fontSize: 13, padding: 12 }}>⚠ {error}</div>}

        {details && (
          <div>
            <Step label="Game round">
              <div><b>{details.round.gameKey}</b> · {details.round.betType} · <span style={{ color: '#515970' }}>{details.round.status}</span></div>
              <div style={{ fontSize: 10, color: '#626a7e', wordBreak: 'break-all', marginTop: 2 }}>{details.round.id}</div>
              <div style={{ fontSize: 11, color: '#626a7e' }}>{fmt(details.round.createdAt)}</div>
            </Step>
            <Step label="Stake">
              <b>{details.round.stake}</b>{details.settlement ? ` ${details.settlement.currency}` : ''}
            </Step>
            <Step label="Reservation">
              {details.reservation
                ? <>held <b>{details.reservation.amount}</b> · {details.reservation.status}{details.reservation.releasedAt ? ` · released ${fmt(details.reservation.releasedAt)}` : ''}</>
                : <span style={{ color: '#626a7e' }}>—</span>}
            </Step>
            <Step label="Result">
              <span style={{ color: Number(details.round.netResult) > 0 ? '#0f7a4a' : Number(details.round.netResult) < 0 ? '#b42318' : '#8a5300', fontWeight: 700 }}>
                {Number(details.round.netResult) > 0 ? 'WIN' : Number(details.round.netResult) < 0 ? 'LOSS' : 'PUSH'} · net {details.round.netResult}
              </span>
            </Step>
            <Step label="Payout">
              <b>{details.round.payout}</b>
            </Step>
            <Step label="Wallet balance">
              {details.settlement
                ? <>bal {details.settlement.balanceBefore} → <b>{details.settlement.balanceAfter}</b> {details.settlement.currency}</>
                : <span style={{ color: '#626a7e' }}>pending settlement</span>}
            </Step>
            <Step label="Ledger">
              {details.ledger.length === 0 ? <span style={{ color: '#626a7e' }}>—</span> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {details.ledger.flatMap((l) => l.entries).map((e) => (
                    <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: e.direction === 'CREDIT' ? '#0f7a4a' : '#b42318' }}>{e.direction}</span>
                      <span>{e.amount}</span>
                    </div>
                  ))}
                </div>
              )}
            </Step>

            {/* provably-fair (only present when the backend reveals it) */}
            {(() => {
              const f = details.round.fairness as { serverSeedHash?: string; serverSeed?: string; clientSeed?: string; nonce?: number } | null;
              if (!f) return null;
              return (
                <div style={{ marginTop: 8, fontSize: 10, color: '#626a7e', wordBreak: 'break-all' }}>
                  Provably fair · hash {f.serverSeedHash ?? '—'}{f.serverSeed ? ` · seed ${f.serverSeed}` : ' · seed hidden until settled'}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

export default RoundDetail;
