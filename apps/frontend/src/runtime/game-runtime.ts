'use client';

import type {
  CurrencyCode,
  GameId,
  IBetRequest,
  IBetResult,
  IFairnessProof,
  IGameDescriptor,
  IGameResult,
  IGameSession,
  PlayerId,
} from '@gaming-platform/types';
import { BetOutcome } from '@gaming-platform/types';

import { BetEngine, type BetLimits } from './bet-engine';
import { EngineRegistry } from './engine-registry';
import { EventBus, RuntimeEventName, type RuntimeEvent } from './event-bus';
import { GameError, RuntimeError, RuntimeErrorCode, toRuntimeError } from './errors';
import { getFeatureFlags } from './feature-flags';
import type { DemoHistoryRecord } from './providers/history';
import type { ProviderSet } from './providers';
import { SessionManager } from './session-manager';

/** A registered game = descriptor + limits. `config` carries the engine preset. */
export interface GameRegistration extends IGameDescriptor {
  config: Record<string, unknown> & { minBet: number; maxBet: number };
}

/** Player context for the demo runtime (single-player). */
export interface PlayerContext {
  playerId: PlayerId;
  currency: CurrencyCode;
}

/**
 * The Game Runtime (Phase 2.2) — the ONE orchestrator between UI and the platform.
 *
 * Owns the canonical lifecycle and drives it through providers + engines, emitting
 * events at every step. Games never touch the wallet/history/analytics directly.
 * `placeBet` runs the full pipeline for INSTANT games; cashable games (crash) use
 * `startRound` → `cashOut` / `finishRound`. Provider-agnostic and demo-active.
 */
export class GameRuntime {
  private readonly sessions = new SessionManager();
  private readonly betEngine = new BetEngine();
  private readonly engines = new EngineRegistry();
  private readonly bus = new EventBus();
  private readonly games = new Map<GameId, GameRegistration>();
  private readonly nonces = new Map<string, number>();
  private readonly serverSeeds = new Map<string, string>();

  constructor(
    private readonly providers: ProviderSet,
    private readonly player: PlayerContext,
  ) {}

  /* ----------------------------- registration ----------------------------- */

  registerGame(game: GameRegistration): void {
    this.games.set(game.gameId, game);
  }
  registerEngine(engine: Parameters<EngineRegistry['register']>[0]): void {
    this.engines.register(engine);
  }

  /* -------------------------------- events -------------------------------- */

  /** Subscribe to runtime events for a session; returns an unsubscribe fn. */
  subscribe(sessionId: string, handler: (event: RuntimeEvent) => void): () => void {
    return this.bus.onAny((e) => {
      if (!e.sessionId || e.sessionId === sessionId) handler(e);
    });
  }
  onAny(handler: (event: RuntimeEvent) => void): () => void {
    return this.bus.onAny(handler);
  }

  /* ------------------------------- sessions ------------------------------- */

  async createSession(input: { gameId: GameId }): Promise<IGameSession> {
    const flags = getFeatureFlags();
    const commit = flags.provablyFair ? this.providers.provablyFair.commit() : undefined;
    if (commit) this.bus.emit(RuntimeEventName.PROVABLY_FAIR_GENERATED, { serverSeedHash: commit.serverSeedHash });
    const session = this.sessions.createSession({
      gameId: input.gameId,
      playerId: this.player.playerId,
      currency: this.player.currency,
      serverSeedHash: commit?.serverSeedHash,
    });
    // stash the committed server seed on the session (demo: kept client-side)
    if (commit) this.serverSeeds.set(session.sessionId, commit.serverSeed);
    this.bus.emit(RuntimeEventName.SESSION_CREATED, { session }, { sessionId: session.sessionId });
    return session;
  }

  getSession(sessionId: string): IGameSession | null {
    return this.sessions.getSession(sessionId);
  }

  /* ------------------------------ bet helpers ----------------------------- */

  private limitsFor(gameId: GameId): BetLimits {
    const g = this.games.get(gameId);
    return { minBet: g?.config.minBet ?? 1, maxBet: g?.config.maxBet ?? Number.MAX_SAFE_INTEGER };
  }

  private nextFairness(session: IGameSession, clientSeed: string): IFairnessProof {
    const nonce = (this.nonces.get(session.sessionId) ?? 0) + 1;
    this.nonces.set(session.sessionId, nonce);
    const serverSeed = this.serverSeeds.get(session.sessionId) ?? '';
    return { serverSeed, serverSeedHash: session.serverSeedHash ?? '', clientSeed, nonce };
  }

  /** Validate, then debit the stake. Shared by placeBet + startRound. */
  private async validateAndDebit(bet: IBetRequest): Promise<IGameSession> {
    const session = this.sessions.getSession(bet.sessionId);
    this.bus.emit(RuntimeEventName.BET_CREATED, { bet }, { sessionId: bet.sessionId });

    const balance = Number(await this.providers.wallet.getBalance(this.player.playerId, this.player.currency));
    const check = this.betEngine.validate(bet, { session, balance, limits: this.limitsFor(bet.gameId) });
    if (!check.ok) {
      this.bus.emit(RuntimeEventName.BET_REJECTED, { error: check.error }, { sessionId: bet.sessionId });
      throw check.error;
    }
    if (!session) throw new RuntimeError(RuntimeErrorCode.INVALID_SESSION, 'No session.');
    this.bus.emit(RuntimeEventName.BET_VALIDATED, { bet }, { sessionId: bet.sessionId });

    const debited = await this.providers.wallet.debit({
      playerId: this.player.playerId,
      currency: this.player.currency,
      amount: bet.stake.amount,
      reference: `stake:${bet.gameId}`,
      idempotencyKey: `debit:${bet.idempotencyKey}`,
    });
    this.bus.emit(RuntimeEventName.WALLET_DEBITED, { amount: bet.stake.amount, balanceAfter: debited.balanceAfter }, { sessionId: bet.sessionId });
    return session;
  }

  private runEngine(session: IGameSession, bet: IBetRequest): { result: IGameResult; roundId: string } {
    const game = this.games.get(bet.gameId);
    const engine = this.engines.get(game?.engineKey ?? '');
    if (!game || !engine) throw new GameError(RuntimeErrorCode.ENGINE_FAILURE, `No engine for game ${bet.gameId}.`);
    const fairness = this.nextFairness(session, bet.clientSeed ?? 'demo');
    const round = this.sessions.createRound({ session, bet, fairness });
    const raw = engine.createRound({ session, bet, config: game.config, rng: this.providers.provablyFair, fairness });
    const result: IGameResult = { ...raw, roundId: round.roundId };
    this.sessions.setResult(round.roundId, result);
    this.bus.emit(RuntimeEventName.ROUND_STARTED, { result }, { sessionId: session.sessionId, roundId: round.roundId });
    return { result, roundId: round.roundId };
  }

  /* --------------------------- lifecycle: instant ------------------------- */

  /** Full pipeline for a single-shot game (validate → debit → engine → settle → credit → history). */
  async placeBet<TPick = unknown>(bet: IBetRequest<TPick>): Promise<IBetResult> {
    try {
      const session = await this.validateAndDebit(bet as IBetRequest);
      const { result } = this.runEngine(session, bet as IBetRequest);
      return await this.finalize(session, bet as IBetRequest, result, result.win ? result.multiplier : 0, result.win);
    } catch (err) {
      const e = toRuntimeError(err);
      this.bus.emit(RuntimeEventName.ERROR, { error: e }, { sessionId: bet.sessionId });
      throw e;
    }
  }

  /* ---------------------------- lifecycle: cashable ----------------------- */

  /** Start a cashable round (crash): validate → debit → engine determines the target. */
  async startRound<TState = unknown>(
    bet: IBetRequest<number>,
  ): Promise<{ result: IGameResult<TState>; roundId: string }> {
    try {
      const session = await this.validateAndDebit(bet as IBetRequest);
      const { result, roundId } = this.runEngine(session, bet as IBetRequest);
      return { result: result as IGameResult<TState>, roundId };
    } catch (err) {
      const e = toRuntimeError(err);
      this.bus.emit(RuntimeEventName.ERROR, { error: e }, { sessionId: bet.sessionId });
      throw e;
    }
  }

  /** Cash out a live round at `atMultiplier` (win). */
  async cashOut(input: { roundId: string; atMultiplier: number }): Promise<IBetResult> {
    const round = this.sessions.getRound(input.roundId);
    if (!round || !round.result) throw new RuntimeError(RuntimeErrorCode.ROUND_NOT_FOUND, 'Round not found.');
    const winResult: IGameResult = { ...round.result, multiplier: input.atMultiplier, win: true };
    return this.finalize(round.session, round.bet, winResult, input.atMultiplier, true, input.atMultiplier);
  }

  /** Finish a round with no cash-out (loss/bust). `finalMultiplier` labels history. */
  async finishRound(input: { roundId: string; finalMultiplier?: number }): Promise<IBetResult> {
    const round = this.sessions.getRound(input.roundId);
    if (!round || !round.result) throw new RuntimeError(RuntimeErrorCode.ROUND_NOT_FOUND, 'Round not found.');
    const lossResult: IGameResult = { ...round.result, multiplier: 0, win: false };
    return this.finalize(round.session, round.bet, lossResult, input.finalMultiplier ?? 0, false, 0);
  }

  /** Cancel a round and refund the stake (e.g. engine error). */
  async cancelRound(input: { roundId: string }): Promise<void> {
    const round = this.sessions.getRound(input.roundId);
    if (!round) return;
    await this.providers.wallet.credit({
      playerId: this.player.playerId,
      currency: this.player.currency,
      amount: round.bet.stake.amount,
      reference: `refund:${input.roundId}`,
      idempotencyKey: `refund:${round.bet.idempotencyKey}`,
    });
    this.sessions.cancel(input.roundId);
    this.bus.emit(RuntimeEventName.ROUND_CANCELLED, { roundId: input.roundId }, { sessionId: round.session.sessionId, roundId: input.roundId });
  }

  /* ----------------------------- shared finalize -------------------------- */

  /** Settlement → credit → history → analytics → notifications, in the fixed order. */
  private async finalize(
    session: IGameSession,
    bet: IBetRequest,
    result: IGameResult,
    displayValue: number,
    win: boolean,
    creditMultiplier?: number,
  ): Promise<IBetResult> {
    this.bus.emit(RuntimeEventName.SETTLEMENT_STARTED, { roundId: result.roundId }, { sessionId: session.sessionId, roundId: result.roundId });
    let betResult: IBetResult;
    try {
      betResult = await this.providers.settlement.settle({ session, result, bet, wallet: this.providers.wallet });
    } catch (err) {
      const e = toRuntimeError(err);
      this.bus.emit(RuntimeEventName.SETTLEMENT_FAILED, { error: e }, { sessionId: session.sessionId, roundId: result.roundId });
      throw e;
    }
    if (win && Number(betResult.payout) > 0) {
      this.bus.emit(RuntimeEventName.WALLET_CREDITED, { amount: betResult.payout, balanceAfter: betResult.balanceAfter }, { sessionId: session.sessionId, roundId: result.roundId });
    }
    this.sessions.settle(result.roundId);
    this.bus.emit(RuntimeEventName.SETTLEMENT_COMPLETED, { betResult }, { sessionId: session.sessionId, roundId: result.roundId });

    // History (delegates to demo stores → keeps existing UI surfaces in sync)
    const game = this.games.get(bet.gameId);
    const record: DemoHistoryRecord = {
      ...betResult,
      outcome: win ? BetOutcome.Win : BetOutcome.Loss,
      playerId: session.playerId,
      gameId: bet.gameId,
      gameName: game?.name,
      displayLabel: `${displayValue.toFixed(2)}×`,
      displayValue,
      multiplier: creditMultiplier ?? betResult.multiplier,
    };
    await this.providers.history.record(record);
    this.bus.emit(RuntimeEventName.HISTORY_UPDATED, { record }, { sessionId: session.sessionId, roundId: result.roundId });
    this.bus.emit(RuntimeEventName.STATISTICS_UPDATED, { gameId: bet.gameId }, { sessionId: session.sessionId, roundId: result.roundId });

    // Best-effort tail — never fails a settled bet.
    try {
      this.providers.analytics.track({ event: win ? 'bet_won' : 'bet_lost', playerId: session.playerId, props: { gameId: bet.gameId, multiplier: displayValue } });
      await this.providers.notifications.notify({ playerId: session.playerId, type: win ? 'win' : 'loss', payload: { gameId: bet.gameId } });
      this.bus.emit(RuntimeEventName.NOTIFICATION_SENT, { gameId: bet.gameId }, { sessionId: session.sessionId });
    } catch {
      /* observability failures are swallowed by design */
    }

    this.bus.emit(RuntimeEventName.ROUND_FINISHED, { betResult }, { sessionId: session.sessionId, roundId: result.roundId });
    return betResult;
  }

  /* ------------------------------ history/stats --------------------------- */

  getHistory(input: { gameId?: GameId; limit?: number }): Promise<{ items: IBetResult[]; nextCursor?: string }> {
    return this.providers.history.list({ playerId: this.player.playerId, gameId: input.gameId, limit: input.limit });
  }

  /** Replay seeds for a round (provably-fair reproduction). */
  getReplay(roundId: string): IFairnessProof | null {
    return this.sessions.getReplay(roundId);
  }
}
