/**
 * Scheduled Draw Engine (Sprint 4, STEP 4) — reusable, additive.
 *
 * A framework-agnostic coordinator for scheduled, provably-fair draws: schedule a draw
 * at a time, register tickets during the sale window, expose a countdown, execute the
 * draw once (deriving winning numbers from the frozen provably-fair provider), publish
 * the result, and support replay + a future jackpot hook. It **owns no money** — it
 * hands the draw result to the game engine's settlement step (which runs through the
 * frozen runtime/ledger). Only Number Lottery uses it, but nothing here is lottery-
 * specific beyond the number-derivation config.
 */
import type { IFairnessProof, IProvablyFairProvider } from '@gaming-platform/types';

import { deriveDraw } from './provably-fair';
import { type DrawResult } from './types';

export enum DrawStatus {
  Scheduled = 'scheduled',
  Closed = 'closed', // sales closed, awaiting execution
  Drawn = 'drawn', // executed + published
}

export interface TicketRef {
  ticketId: string;
  /** The runtime round id this ticket is settled through. */
  roundId?: string;
}

export interface Draw {
  id: string;
  drawAt: number;
  status: DrawStatus;
  /** Sales close this many ms before the draw. */
  closeBeforeMs: number;
  fairness?: IFairnessProof;
  result?: DrawResult;
  tickets: TicketRef[];
  /** Rolling jackpot pool (future support) — accrues from ticket sales. */
  jackpotPool: number;
}

export interface DrawConfig {
  drawMain: number;
  range: number;
  bonus: boolean;
}

export class ScheduledDrawEngine {
  private readonly draws = new Map<string, Draw>();
  constructor(private readonly config: DrawConfig, private readonly clock: () => number = () => Date.now()) {}

  /** Schedule a draw. */
  schedule(id: string, drawAt: number, opts: { closeBeforeMs?: number } = {}): Draw {
    const draw: Draw = { id, drawAt, status: DrawStatus.Scheduled, closeBeforeMs: opts.closeBeforeMs ?? 5_000, tickets: [], jackpotPool: 0 };
    this.draws.set(id, draw);
    return draw;
  }
  get(id: string): Draw {
    const d = this.draws.get(id);
    if (!d) throw new Error('no such draw');
    return d;
  }
  open(now: number = this.clock()): Draw[] {
    return [...this.draws.values()].filter((d) => d.status !== DrawStatus.Drawn && now < d.drawAt);
  }

  /** ms until the draw (or 0 if past). */
  countdown(id: string, now: number = this.clock()): number {
    return Math.max(0, this.get(id).drawAt - now);
  }
  /** Are sales still open for this draw? */
  salesOpen(id: string, now: number = this.clock()): boolean {
    const d = this.get(id);
    return d.status === DrawStatus.Scheduled && now < d.drawAt - d.closeBeforeMs;
  }

  /** Register a ticket for a draw (sale window). Accrues the jackpot pool. */
  addTicket(id: string, ticket: TicketRef, contribution = 0, now: number = this.clock()): void {
    if (!this.salesOpen(id, now)) throw new Error('sales closed for this draw');
    const d = this.get(id);
    d.tickets.push(ticket);
    d.jackpotPool += contribution;
  }

  /**
   * Execute the draw once (idempotent): derive the winning numbers from the provided
   * draw fairness and publish. Returns the result + the tickets to settle.
   */
  execute(rng: IProvablyFairProvider, id: string, fairness: IFairnessProof, now: number = this.clock()): { result: DrawResult; tickets: TicketRef[] } {
    const d = this.get(id);
    if (d.status === DrawStatus.Drawn) return { result: d.result!, tickets: d.tickets };
    if (now < d.drawAt) throw new Error('draw time not reached');
    const result = deriveDraw(rng, fairness, this.config);
    d.fairness = fairness;
    d.result = result;
    d.status = DrawStatus.Drawn;
    return { result, tickets: d.tickets };
  }

  /** Replay a published draw from its revealed fairness (verification aid). */
  replay(rng: IProvablyFairProvider, id: string): DrawResult {
    const d = this.get(id);
    if (!d.fairness) throw new Error('draw not executed');
    return deriveDraw(rng, d.fairness, this.config);
  }

  /** Advance any draws whose time has passed but aren't drawn (scheduler tick). */
  dueDraws(now: number = this.clock()): Draw[] {
    return [...this.draws.values()].filter((d) => d.status !== DrawStatus.Drawn && now >= d.drawAt);
  }
}
