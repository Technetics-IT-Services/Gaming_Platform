'use client';

import type { GameId, IGameSession } from '@gaming-platform/types';
import { useEffect, useState } from 'react';

import { getGameRuntime, type GameRuntime } from '../index';

/**
 * React binding for the runtime (Phase 2.2). Resolves the shared runtime and
 * opens a session for `gameId` on mount. The UI drives play through
 * `runtime.startRound / cashOut / finishRound` and may `subscribe` to events.
 * No game logic lives here — this only manages the session handle.
 */
export function useGameRuntime(gameId: GameId): { runtime: GameRuntime; session: IGameSession | null } {
  const runtime = getGameRuntime();
  const [session, setSession] = useState<IGameSession | null>(null);

  useEffect(() => {
    let active = true;
    void runtime.createSession({ gameId }).then((s) => {
      if (active) setSession(s);
    });
    return () => {
      active = false;
    };
  }, [gameId, runtime]);

  return { runtime, session };
}
