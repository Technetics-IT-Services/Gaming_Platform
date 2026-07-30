'use client';

import type {
  CurrencyCode,
  GameId,
  IBetRequest,
  IFairnessProof,
  IGameResult,
  IGameSession,
  PlayerId,
} from '@gaming-platform/types';
import { RoundStatus, SessionStatus } from '@gaming-platform/types';

/**
 * Session manager (Phase 2.2).
 *
 * Owns session + round LIFECYCLE state — creation, idle timeout, round tracking,
 * replay data. It holds NO UI state and performs no IO; it is a pure in-memory
 * bookkeeper the runtime drives. (In the real backend runtime this maps to
 * `RuntimeSession`/`ActiveRuntime`; the client demo keeps it local.)
 */
export interface RoundState {
  roundId: string;
  session: IGameSession;
  bet: IBetRequest;
  status: RoundStatus;
  fairness: IFairnessProof;
  /** Raw engine outcome once computed (e.g. crash point). */
  result?: IGameResult;
  createdAt: number;
  settledAt?: number;
}

const DEFAULT_IDLE_MS = 15 * 60_000; // 15 minutes

export class SessionManager {
  private readonly sessions = new Map<string, IGameSession>();
  private readonly lastActivity = new Map<string, number>();
  private readonly rounds = new Map<string, RoundState>();
  private seq = 0;

  constructor(private readonly idleMs: number = DEFAULT_IDLE_MS) {}

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${Date.now().toString(36)}_${this.seq}`;
  }

  createSession(input: {
    gameId: GameId;
    playerId: PlayerId;
    currency: CurrencyCode;
    serverSeedHash?: string;
  }): IGameSession {
    const session: IGameSession = {
      sessionId: this.id('sess'),
      gameId: input.gameId,
      playerId: input.playerId,
      currency: input.currency,
      status: SessionStatus.Active,
      createdAt: new Date().toISOString(),
      serverSeedHash: input.serverSeedHash,
    };
    this.sessions.set(session.sessionId, session);
    this.lastActivity.set(session.sessionId, Date.now());
    return session;
  }

  getSession(sessionId: string): IGameSession | null {
    const s = this.sessions.get(sessionId) ?? null;
    if (s && this.isExpired(sessionId)) {
      s.status = SessionStatus.Expired;
    }
    return s;
  }

  /** Mark a session active (call on each interaction to reset the idle clock). */
  touch(sessionId: string): void {
    if (this.sessions.has(sessionId)) this.lastActivity.set(sessionId, Date.now());
  }

  isExpired(sessionId: string): boolean {
    const last = this.lastActivity.get(sessionId);
    return last !== undefined && Date.now() - last > this.idleMs;
  }

  createRound(input: { session: IGameSession; bet: IBetRequest; fairness: IFairnessProof }): RoundState {
    this.touch(input.session.sessionId);
    const round: RoundState = {
      roundId: this.id('round'),
      session: input.session,
      bet: input.bet,
      status: RoundStatus.Pending,
      fairness: input.fairness,
      createdAt: Date.now(),
    };
    this.rounds.set(round.roundId, round);
    return round;
  }

  getRound(roundId: string): RoundState | null {
    return this.rounds.get(roundId) ?? null;
  }

  setResult(roundId: string, result: IGameResult): void {
    const r = this.rounds.get(roundId);
    if (r) {
      r.result = result;
      r.status = RoundStatus.InProgress;
    }
  }

  settle(roundId: string): void {
    const r = this.rounds.get(roundId);
    if (r) {
      r.status = RoundStatus.Settled;
      r.settledAt = Date.now();
    }
  }

  cancel(roundId: string): void {
    const r = this.rounds.get(roundId);
    if (r) {
      r.status = RoundStatus.Voided;
      r.settledAt = Date.now();
    }
  }

  /** Replay data — the seeds needed to reproduce a round's outcome. */
  getReplay(roundId: string): IFairnessProof | null {
    return this.rounds.get(roundId)?.fairness ?? null;
  }

  /** Drop settled rounds older than `keepMs` to avoid unbounded growth. */
  prune(keepMs = 10 * 60_000): void {
    const now = Date.now();
    for (const [id, r] of this.rounds) {
      if (r.settledAt && now - r.settledAt > keepMs) this.rounds.delete(id);
    }
  }
}
