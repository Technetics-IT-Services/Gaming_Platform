'use client';

import { GameLobby } from '@/components/games/lobby/GameLobby';

/**
 * Real-money mobile lobby (Phase 2C.8) — the canonical discovery surface for the production
 * real-money games. Lives in the auth-guarded casino group (guests → /login) with the shared mobile
 * bottom navigation. Server-authoritative catalog/availability; no demo wallet.
 */
export default function LobbyPage() {
  return (
    <div className="min-h-full py-3">
      <GameLobby />
    </div>
  );
}
