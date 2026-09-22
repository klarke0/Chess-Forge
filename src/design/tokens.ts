/**
 * Square colors for the chess board. Matches the chess.com classic theme.
 * Spread these into <Chessboard customDarkSquareStyle/customLightSquareStyle>
 * so every board instance reads from one source of truth.
 */
export const BOARD_THEME = {
  customDarkSquareStyle: { backgroundColor: "#769656" },
  customLightSquareStyle: { backgroundColor: "#eeeed2" },
} as const;

/**
 * Muted board palette — used only for the small weakest-position thumbnail
 * on the home screen, where the chess.com colors are too vibrant against
 * the dashboard surface.
 */
export const BOARD_THEME_MUTED = {
  customDarkSquareStyle: { backgroundColor: "#1e293b" },
  customLightSquareStyle: { backgroundColor: "#475569" },
} as const;

const accent = {
  primary: {
    DEFAULT: "#4f46e5",
    hover: "#6366f1",
    shadow: "rgba(79,70,229,0.3)",
    muted: "rgba(79,70,229,0.1)",
    border: "rgba(79,70,229,0.2)",
  },
  warm: {
    DEFAULT: "#f97316",
    muted: "#fb923c",
    // Unlike the other accents, `muted` here is a lighter foreground shade,
    // not a background tint — kept as-is to avoid redefining an existing
    // (if unused) token. `bg`/`border` fill the gap so warm has the same
    // muted-background-chip shape as success/danger/warning/insight.
    bg: "rgba(249,115,22,0.1)",
    border: "rgba(249,115,22,0.2)",
  },
  success: {
    DEFAULT: "#34d399",
    muted: "rgba(52,211,153,0.1)",
    border: "rgba(52,211,153,0.2)",
  },
  danger: {
    DEFAULT: "#fb7185",
    muted: "rgba(251,113,133,0.1)",
    border: "rgba(251,113,133,0.2)",
  },
  warning: {
    DEFAULT: "#fbbf24",
    muted: "rgba(251,191,36,0.1)",
    border: "rgba(251,191,36,0.2)",
  },
  insight: {
    DEFAULT: "#a78bfa",
    muted: "rgba(167,139,250,0.1)",
    border: "rgba(167,139,250,0.2)",
  },
} as const;

export const tokens = {
  bg: {
    base: "#050507",
    surface: "#0a0d14",
    card: "#0d1117",
    elevated: "#111520",
    shell: "#020204",
    board: "#161b22",
    nav: "rgba(10, 13, 20, 0.9)",
  },
  accent,
  text: {
    primary: "#e2e8f0",
    secondary: "#94a3b8",
    inactive: "#64748b",
    muted: "#475569",
  },
  border: {
    subtle: "rgba(255,255,255,0.05)",
    default: "rgba(255,255,255,0.10)",
  },
  radius: {
    sm: "0.75rem",
    md: "1rem",
    lg: "1.5rem",
    xl: "2rem",
    pill: "9999px",
  },
  /**
   * Type roles distilled from the label pattern already repeated ~40x across
   * V2 screens (`text-[10px] font-black uppercase tracking-widest`), which had
   * drifted to 4 different undocumented pixel sizes. Use via the
   * `text-forge-label-*` Tailwind utilities, not raw arbitrary sizes.
   */
  type: {
    label: {
      sm: { size: "0.5rem", tracking: "0.1em" }, // 8px — dense inline tags
      DEFAULT: { size: "0.625rem", tracking: "0.1em" }, // 10px — the dominant eyebrow size
      lg: { size: "0.6875rem", tracking: "0.08em" }, // 11px — section headers
    },
  },
  /**
   * Durations/easing already converged on in practice (duration-150 +
   * transition-colors/all dominate V2); named here so new code reaches for a
   * token instead of picking a number.
   */
  motion: {
    fast: "150ms",
    base: "300ms",
    easing: "cubic-bezier(0.4, 0, 0.2, 1)",
  },
  /**
   * Chess-domain semantic layer — aliases onto the accent palette so intent
   * ("this is a blunder") survives in the class name instead of only the hue
   * ("this is rose"). Values match the grade strings actually written by the
   * engine/analysis pipeline (`server/utils/analysis.ts`) and the drill
   * sources served by `v2_train_now.ts`, not a generic best/good/great scale.
   */
  grade: {
    best: accent.success.DEFAULT,
    inaccuracy: accent.warning.DEFAULT,
    mistake: accent.warm.DEFAULT,
    blunder: accent.danger.DEFAULT,
  },
  drillSource: {
    blunder: accent.danger.DEFAULT,
    deviation: accent.warning.DEFAULT,
    review: "#94a3b8", // text.secondary — neutral, this source isn't a mistake
    // Previously shared accent.warning with `deviation` (an unintentional
    // collision, not a deliberate choice) — insight/violet gives punish
    // drills their own identity as the "combine my mistakes with theirs" mode.
    punish: accent.insight.DEFAULT,
  },
} as const;

export type Tokens = typeof tokens;

/**
 * Writes all token values as --forge-* CSS custom properties onto :root.
 * Not needed at startup if index.css is loaded — use for programmatic access
 * (canvas, Chart.js, inline styles that need the raw value).
 */
export function injectTokens(): void {
  const root = document.documentElement;

  root.style.setProperty("--forge-bg-base", tokens.bg.base);
  root.style.setProperty("--forge-bg-surface", tokens.bg.surface);
  root.style.setProperty("--forge-bg-card", tokens.bg.card);
  root.style.setProperty("--forge-bg-elevated", tokens.bg.elevated);
  root.style.setProperty("--forge-bg-shell", tokens.bg.shell);
  root.style.setProperty("--forge-bg-board", tokens.bg.board);
  root.style.setProperty("--forge-bg-nav", tokens.bg.nav);

  root.style.setProperty("--forge-accent-primary", tokens.accent.primary.DEFAULT);
  root.style.setProperty("--forge-accent-primary-hover", tokens.accent.primary.hover);
  root.style.setProperty("--forge-accent-primary-shadow", tokens.accent.primary.shadow);
  root.style.setProperty("--forge-accent-primary-muted", tokens.accent.primary.muted);
  root.style.setProperty("--forge-accent-primary-border", tokens.accent.primary.border);
  root.style.setProperty("--forge-accent-warm", tokens.accent.warm.DEFAULT);
  root.style.setProperty("--forge-accent-warm-muted", tokens.accent.warm.muted);
  root.style.setProperty("--forge-accent-warm-bg", tokens.accent.warm.bg);
  root.style.setProperty("--forge-accent-warm-border", tokens.accent.warm.border);
  root.style.setProperty("--forge-accent-success", tokens.accent.success.DEFAULT);
  root.style.setProperty("--forge-accent-success-muted", tokens.accent.success.muted);
  root.style.setProperty("--forge-accent-success-border", tokens.accent.success.border);
  root.style.setProperty("--forge-accent-danger", tokens.accent.danger.DEFAULT);
  root.style.setProperty("--forge-accent-danger-muted", tokens.accent.danger.muted);
  root.style.setProperty("--forge-accent-danger-border", tokens.accent.danger.border);
  root.style.setProperty("--forge-accent-warning", tokens.accent.warning.DEFAULT);
  root.style.setProperty("--forge-accent-warning-muted", tokens.accent.warning.muted);
  root.style.setProperty("--forge-accent-warning-border", tokens.accent.warning.border);
  root.style.setProperty("--forge-accent-insight", tokens.accent.insight.DEFAULT);
  root.style.setProperty("--forge-accent-insight-muted", tokens.accent.insight.muted);
  root.style.setProperty("--forge-accent-insight-border", tokens.accent.insight.border);

  root.style.setProperty("--forge-text-primary", tokens.text.primary);
  root.style.setProperty("--forge-text-secondary", tokens.text.secondary);
  root.style.setProperty("--forge-text-inactive", tokens.text.inactive);
  root.style.setProperty("--forge-text-muted", tokens.text.muted);

  root.style.setProperty("--forge-border-subtle", tokens.border.subtle);
  root.style.setProperty("--forge-border-default", tokens.border.default);

  root.style.setProperty("--forge-radius-sm", tokens.radius.sm);
  root.style.setProperty("--forge-radius-md", tokens.radius.md);
  root.style.setProperty("--forge-radius-lg", tokens.radius.lg);
  root.style.setProperty("--forge-radius-xl", tokens.radius.xl);
  root.style.setProperty("--forge-radius-pill", tokens.radius.pill);

  root.style.setProperty("--forge-label-sm-size", tokens.type.label.sm.size);
  root.style.setProperty("--forge-label-sm-tracking", tokens.type.label.sm.tracking);
  root.style.setProperty("--forge-label-size", tokens.type.label.DEFAULT.size);
  root.style.setProperty("--forge-label-tracking", tokens.type.label.DEFAULT.tracking);
  root.style.setProperty("--forge-label-lg-size", tokens.type.label.lg.size);
  root.style.setProperty("--forge-label-lg-tracking", tokens.type.label.lg.tracking);

  root.style.setProperty("--forge-motion-fast", tokens.motion.fast);
  root.style.setProperty("--forge-motion-base", tokens.motion.base);
  root.style.setProperty("--forge-motion-easing", tokens.motion.easing);

  root.style.setProperty("--forge-grade-best", tokens.grade.best);
  root.style.setProperty("--forge-grade-inaccuracy", tokens.grade.inaccuracy);
  root.style.setProperty("--forge-grade-mistake", tokens.grade.mistake);
  root.style.setProperty("--forge-grade-blunder", tokens.grade.blunder);

  root.style.setProperty("--forge-drill-blunder", tokens.drillSource.blunder);
  root.style.setProperty("--forge-drill-deviation", tokens.drillSource.deviation);
  root.style.setProperty("--forge-drill-review", tokens.drillSource.review);
  root.style.setProperty("--forge-drill-punish", tokens.drillSource.punish);
}
