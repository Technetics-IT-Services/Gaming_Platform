'use client';

/**
 * GameLobby — the mobile-first real-money lobby (Phase 2C.8). Header with the authoritative wallet
 * balance, fast search, category chips, a featured rail, recents (from authenticated game history) and
 * a 2-column game grid whose cards launch the server-authoritative `-money` routes. Server-authoritative
 * availability/limits (from `GET /catalog`); no demo wallet; no client-controlled money. Fits 375/390/412.
 */
import Link from 'next/link';
import { History, Search, User, Wallet } from 'lucide-react';

import { LOBBY_FILTERS } from '@/lib/games/filter';
import { LobbyGameCard } from './LobbyGameCard';
import { useLobby } from './use-lobby';

export function GameLobby() {
  const g = useLobby();

  return (
    <div style={{ color: '#e5e7eb', maxWidth: 520, margin: '0 auto', padding: '0 12px 24px', boxSizing: 'border-box' }}>
      {/* header — brand + sticky authoritative balance + profile */}
      <div style={{ position: 'sticky', top: 0, zIndex: 6, background: '#0b0f19', paddingTop: 10, paddingBottom: 10, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontWeight: 900, fontSize: 18, letterSpacing: 0.5 }}>🎰 Lobby</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Link href="/wallet" aria-label="Wallet" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', background: '#111827', border: '1px solid #1f2937', borderRadius: 999, padding: '7px 12px' }}>
              <Wallet size={15} color="#34d399" />
              <b data-testid="balance" style={{ fontSize: 14, color: '#34d399' }}>{g.balance === null ? '—' : `₹${g.balance}`}</b>
            </Link>
            <Link href="/profile" aria-label="Profile" style={{ display: 'inline-flex', padding: 8, background: '#111827', border: '1px solid #1f2937', borderRadius: 999 }}>
              <User size={16} color="#e5e7eb" />
            </Link>
          </div>
        </div>

        {/* search */}
        <div style={{ position: 'relative', marginTop: 10 }}>
          <Search size={16} color="#64748b" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            data-testid="lobby-search" inputMode="search" value={g.query} onChange={(e) => g.setQuery(e.target.value)}
            placeholder="Search games"
            style={{ width: '100%', padding: '12px 12px 12px 36px', borderRadius: 12, border: '1px solid #334155', background: '#111827', color: '#e5e7eb', fontSize: 15, boxSizing: 'border-box' }}
          />
        </div>

        {/* category chips */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginTop: 10, paddingBottom: 2, WebkitOverflowScrolling: 'touch' }}>
          {LOBBY_FILTERS.map((f) => (
            <button key={f.key} data-testid={`filter-${f.key}`} onClick={() => g.setFilter(f.key)} aria-pressed={g.filter === f.key}
              style={{ flex: '0 0 auto', padding: '8px 14px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', border: g.filter === f.key ? '2px solid #fbbf24' : '1px solid #334155', background: g.filter === f.key ? '#78350f' : '#111827', color: '#e5e7eb' }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* loading skeleton */}
      {g.loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {Array.from({ length: 6 }, (_, i) => <div key={i} style={{ height: 128, borderRadius: 16, background: '#111827', border: '1px solid #1f2937' }} />)}
        </div>
      ) : (
        <>
          {/* featured rail (only on the 'all' filter with no query) */}
          {g.filter === 'all' && !g.query && g.featured.length > 0 && (
            <section style={{ marginBottom: 14 }}>
              <h2 style={{ fontSize: 13, opacity: 0.7, margin: '4px 2px 8px' }}>⭐ Featured</h2>
              <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4, WebkitOverflowScrolling: 'touch' }}>
                {g.featured.map((game) => (
                  <div key={game.key} style={{ flex: '0 0 44%', maxWidth: 200 }}><LobbyGameCard game={game} /></div>
                ))}
              </div>
            </section>
          )}

          {/* recents from authenticated game history */}
          {g.filter === 'all' && !g.query && g.recents.length > 0 && (
            <section style={{ marginBottom: 14 }}>
              <h2 style={{ fontSize: 13, opacity: 0.7, margin: '4px 2px 8px' }}>🕑 Recently played</h2>
              <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4, WebkitOverflowScrolling: 'touch' }}>
                {g.recents.map((game) => (
                  <div key={game.key} style={{ flex: '0 0 44%', maxWidth: 200 }}><LobbyGameCard game={game} /></div>
                ))}
              </div>
            </section>
          )}

          {/* main grid */}
          <section>
            <h2 style={{ fontSize: 13, opacity: 0.7, margin: '4px 2px 8px' }}>{g.filter === 'all' && !g.query ? 'All games' : `${g.filtered.length} game${g.filtered.length === 1 ? '' : 's'}`}</h2>
            {g.filtered.length === 0 ? (
              <div data-testid="lobby-empty" style={{ textAlign: 'center', opacity: 0.6, fontSize: 14, padding: '32px 0' }}>No games match your search.</div>
            ) : (
              <div data-testid="lobby-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {g.filtered.map((game) => <LobbyGameCard key={game.key} game={game} />)}
              </div>
            )}
          </section>

          {/* responsible-gaming / account surface (reuses existing production pages) */}
          <section style={{ marginTop: 18, borderTop: '1px solid #1f2937', paddingTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Link href="/game-history" style={footerLink}><History size={13} /> Game history</Link>
            <Link href="/wallet/history" style={footerLink}>Wallet history</Link>
            <Link href="/settings" style={footerLink}>Limits &amp; settings</Link>
          </section>
        </>
      )}
    </div>
  );
}

const footerLink: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#93c5fd', textDecoration: 'none', background: '#111827', border: '1px solid #1f2937', borderRadius: 999, padding: '7px 12px' };

export default GameLobby;
