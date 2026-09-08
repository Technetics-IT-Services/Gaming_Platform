'use client';

/**
 * LobbyGameCard — a mobile-first real-money game card (Phase 2C.8). The whole card is the tap target
 * and launches the game's authoritative `-money` route. A disabled/maintenance game is NOT launchable
 * (server-authoritative `status`) and shows an "Unavailable" state — never a demo fallback.
 */
import Link from 'next/link';

import type { GameDefinition } from '@/lib/games/catalog';

export function LobbyGameCard({ game }: { game: GameDefinition }) {
  const live = game.status === 'live';
  const inner = (
    <div
      data-testid={`game-card-${game.key}`}
      data-status={game.status}
      style={{
        position: 'relative', borderRadius: 16, overflow: 'hidden', border: '1px solid #1f2937',
        background: 'linear-gradient(160deg,#1e1b4b,#0b0f19)', padding: 14, minHeight: 128,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        opacity: live ? 1 : 0.55, cursor: live ? 'pointer' : 'not-allowed',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span style={{ fontSize: 34, lineHeight: 1 }}>{game.icon}</span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {game.isNew && <span style={badge('#7c3aed')}>NEW</span>}
          {game.tags.includes('india') && <span style={badge('#ea580c')}>IN</span>}
          <span style={badge('#047857')}>₹</span>
        </div>
      </div>
      <div>
        <div style={{ fontWeight: 800, fontSize: 15, color: '#f1f5f9' }}>{game.name}</div>
        <div style={{ fontSize: 11, opacity: 0.6, textTransform: 'capitalize' }}>{game.category} · min ₹{game.minStake}</div>
      </div>
      {!live && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(2,6,23,0.55)' }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#fca5a5', letterSpacing: 0.5 }}>UNAVAILABLE</span>
        </div>
      )}
    </div>
  );

  if (!live) return <div aria-disabled>{inner}</div>;
  return (
    <Link href={game.route} aria-label={`Play ${game.name}`} style={{ textDecoration: 'none' }}>
      {inner}
    </Link>
  );
}

function badge(bg: string): React.CSSProperties {
  return { fontSize: 9, fontWeight: 800, color: 'white', background: bg, borderRadius: 6, padding: '2px 5px', letterSpacing: 0.3 };
}

export default LobbyGameCard;
