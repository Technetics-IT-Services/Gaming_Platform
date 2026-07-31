/**
 * Plinko responsive layout (Sprint 1, STEP 4).
 *
 * Pure breakpoint + board-geometry math so the same board renders correctly on mobile,
 * tablet and desktop. UI-framework-agnostic and deterministic (testable without a DOM).
 */

export type LayoutMode = 'mobile' | 'tablet' | 'desktop';

export interface BoardLayout {
  mode: LayoutMode;
  /** CSS pixel width the board should occupy. */
  boardWidth: number;
  /** Peg diameter in px. */
  pegSize: number;
  /** Ball diameter in px. */
  ballSize: number;
  /** Font size for slot multipliers. */
  slotFontPx: number;
  /** Compact controls (stacked) on narrow screens. */
  stackControls: boolean;
}

export function layoutMode(viewportWidth: number): LayoutMode {
  if (viewportWidth < 640) return 'mobile';
  if (viewportWidth < 1024) return 'tablet';
  return 'desktop';
}

/** Board geometry for a viewport width + row count. */
export function layoutFor(viewportWidth: number, rows: number): BoardLayout {
  const mode = layoutMode(viewportWidth);
  const boardWidth = mode === 'mobile' ? Math.min(viewportWidth - 24, 420) : mode === 'tablet' ? 520 : 640;
  // More rows ⇒ smaller pegs to fit the widest base row (rows+1 slots).
  const pegSize = Math.max(6, Math.floor(boardWidth / (rows + 1) / 2));
  return {
    mode,
    boardWidth,
    pegSize,
    ballSize: Math.max(8, pegSize + 2),
    slotFontPx: mode === 'mobile' ? 10 : 12,
    stackControls: mode === 'mobile',
  };
}

/** Peg (x, y) centres for rendering the triangular grid, normalized to the board box. */
export function pegPositions(rows: number): { row: number; col: number; x: number; y: number }[] {
  const out: { row: number; col: number; x: number; y: number }[] = [];
  for (let r = 0; r < rows; r += 1) {
    const pegsInRow = r + 2; // row 0 has 2 pegs, widening to rows+1 at the base
    for (let c = 0; c < pegsInRow; c += 1) {
      const x = (c - (pegsInRow - 1) / 2) / (rows / 2 + 1); // centred, normalized
      const y = (r + 1) / (rows + 1);
      out.push({ row: r, col: c, x, y });
    }
  }
  return out;
}
