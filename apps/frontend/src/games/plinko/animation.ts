/**
 * Plinko animation timeline + state machine (Sprint 1, STEP 5).
 *
 * Pure, deterministic ball-drop choreography derived from the provably-fair path.
 * The React board renders these frames; the logic is UI-framework-agnostic and fully
 * testable. Fast mode compresses the timeline; replay re-runs an exact past drop.
 */

export interface Frame {
  /** Row index the ball is passing (0..rows). */
  row: number;
  /** Horizontal position, normalized to [-1, 1] (−1 leftmost bin, +1 rightmost). */
  x: number;
  /** Milliseconds from drop start. */
  atMs: number;
}

export interface TimelineOptions {
  stepMs?: number;
  fast?: boolean;
}

/**
 * Build the ball's frame timeline from the per-row steps. The ball starts centred and
 * drifts ± each row; the final x corresponds to the landing bin.
 */
export function buildTimeline(dirs: number[], opts: TimelineOptions = {}): Frame[] {
  const rows = dirs.length;
  const step = (opts.fast ? 40 : 220) * (opts.stepMs ? opts.stepMs / 220 : 1);
  const frames: Frame[] = [{ row: 0, x: 0, atMs: 0 }];
  let rights = 0;
  for (let i = 0; i < rows; i += 1) {
    if (dirs[i] === 1) rights += 1;
    // After i+1 steps, x = (2·rights − (i+1)) / rows  → spreads to [-1, 1] at the base.
    const x = (2 * rights - (i + 1)) / rows;
    frames.push({ row: i + 1, x, atMs: Math.round((i + 1) * step) });
  }
  return frames;
}

/** Landing bin ↔ normalized x of the slot centres. */
export function binToX(bin: number, rows: number): number {
  return (2 * bin - rows) / rows;
}

export type AnimationPhase = 'idle' | 'dropping' | 'landed';

/**
 * A tick-driven animation state machine (deterministic; the UI advances it on a
 * rAF/interval, tests advance it explicitly). Exposes the current ball position.
 */
export class PlinkoAnimation {
  private phase: AnimationPhase = 'idle';
  private frames: Frame[] = [];
  private index = 0;

  start(dirs: number[], opts?: TimelineOptions): void {
    this.frames = buildTimeline(dirs, opts);
    this.index = 0;
    this.phase = this.frames.length ? 'dropping' : 'landed';
  }
  /** Advance one frame. Returns the current frame (or the last on completion). */
  tick(): Frame | undefined {
    if (this.phase !== 'dropping') return this.current();
    if (this.index < this.frames.length - 1) {
      this.index += 1;
      if (this.index === this.frames.length - 1) this.phase = 'landed';
    } else {
      this.phase = 'landed';
    }
    return this.current();
  }
  current(): Frame | undefined {
    return this.frames[this.index];
  }
  getPhase(): AnimationPhase {
    return this.phase;
  }
  isDone(): boolean {
    return this.phase === 'landed';
  }
  reset(): void {
    this.phase = 'idle';
    this.frames = [];
    this.index = 0;
  }
}
