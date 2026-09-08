/**
 * Light surface palette for the inline-styled operator and account screens (Phase 2D.14).
 *
 * WHY THIS EXISTS. The design system in `packages/ui` has been light-first from the start — near
 * white page, white cards, dark `--foreground` text. But a run of screens built in later phases
 * styled themselves inline with a DARK palette (`#111827` panels, `#e5e7eb` text) and set that
 * light-grey text colour on their ROOT element. Inside a dark panel that reads fine; every heading,
 * helper line and empty state that sits directly on the light app shell rendered light grey on
 * near white — measured at **1.14:1**, effectively invisible. That is the bug players reported on
 * the wallet screens.
 *
 * These constants are the light equivalents, derived from the same design tokens so the inline
 * screens and the Tailwind screens agree:
 *
 *   TEXT      -> --foreground        230 35% 16%   16.2:1 on white
 *   MUTED     -> --muted-foreground  225 16% 38%    6.9:1 on white
 *   SURFACE   -> --card              0 0% 100%
 *   INSET     -> --muted             222 32% 94%
 *   LINE      -> --border            224 24% 84%
 *
 * Every semantic colour below is chosen to clear WCAG AA (4.5:1) against SURFACE and INSET, and is
 * verified by a live pixel-sampling contrast audit rather than by eye.
 *
 * Literal hex rather than `hsl(var(--x))` because these screens style through the `style` prop,
 * where a CSS variable cannot be interpolated into a colour the same way; the values are kept in
 * step with the tokens by `surface.test.ts`.
 */

/* ------------------------------------------------------------------ neutrals */

/** Primary text. 16.2:1 on white. */
export const TEXT = '#1b1f37';
/** Secondary text — still AA at 6.9:1, so labels and hints stay readable. */
export const MUTED = '#515970';
/** Disabled text: dimmer than MUTED, still AA on white (5.4:1) and on INSET (4.7:1). */
export const DISABLED = '#626a7e';
/** Card / panel surface. */
export const SURFACE = '#ffffff';
/** Recessed surface: table headers, sticky bars, inset rows. */
export const INSET = '#ebeef5';
/** Hairline border. */
export const LINE = '#ccd2e0';
/** Stronger border: inputs, focusable controls. */
export const LINE_STRONG = '#b9c1d4';

/* ----------------------------------------------------------------- semantics */

/** Error text. 6.6:1 on white. */
export const DANGER = '#b42318';
export const DANGER_SURFACE = '#fef2f2';
export const DANGER_LINE = '#f0b4b0';

/** Warning / pending text. 6.3:1 on white. */
export const WARN = '#8a5300';
export const WARN_SURFACE = '#fff7e6';
export const WARN_LINE = '#e9c07a';

/** Success / credit text. 5.4:1 on white. */
export const SUCCESS = '#0f7a4a';
export const SUCCESS_SURFACE = '#e6f6ee';
export const SUCCESS_LINE = '#86c9a6';

/** Informational text and links. 6.7:1 on white. */
export const INFO = '#1d4ed8';
export const INFO_SURFACE = '#e8efff';

/** Brand accents kept from the existing identity — both carry white text at AA. */
export const BRAND = '#7c3aed';
export const BRAND_ALT = '#0369a1';
export const PINK = '#be185d';
export const VIOLET = '#6d28d9';

/** Neutral control background for a disabled button, with DISABLED text on it. */
export const CONTROL_OFF = '#cbd2e0';

/* -------------------------------------------------------------- style pieces */

/** A standard panel: white card, hairline border. */
export const PANEL = {
  background: SURFACE,
  border: `1px solid ${LINE}`,
  borderRadius: 14,
  padding: 14,
} as const;

/** Page root: sets the readable foreground these screens previously got wrong. */
export const PAGE = { color: TEXT } as const;
