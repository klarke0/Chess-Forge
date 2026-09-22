/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        outfit: ["Outfit", "sans-serif"],
      },
      colors: {
        forge: {
          // Backgrounds
          base:     "var(--forge-bg-base)",
          surface:  "var(--forge-bg-surface)",
          card:     "var(--forge-bg-card)",
          elevated: "var(--forge-bg-elevated)",
          shell:    "var(--forge-bg-shell)",
          board:    "var(--forge-bg-board)",
          nav:      "var(--forge-bg-nav)",
          // Accents
          primary:          "var(--forge-accent-primary)",
          "primary-hover":  "var(--forge-accent-primary-hover)",
          "primary-muted":  "var(--forge-accent-primary-muted)",
          "primary-border": "var(--forge-accent-primary-border)",
          warm:             "var(--forge-accent-warm)",
          "warm-muted":     "var(--forge-accent-warm-muted)",
          "warm-bg":        "var(--forge-accent-warm-bg)",
          "warm-border":    "var(--forge-accent-warm-border)",
          success:          "var(--forge-accent-success)",
          "success-muted":  "var(--forge-accent-success-muted)",
          danger:           "var(--forge-accent-danger)",
          "danger-muted":   "var(--forge-accent-danger-muted)",
          warning:          "var(--forge-accent-warning)",
          "warning-muted":  "var(--forge-accent-warning-muted)",
          insight:          "var(--forge-accent-insight)",
          "insight-muted":  "var(--forge-accent-insight-muted)",
          "success-border": "var(--forge-accent-success-border)",
          "danger-border":  "var(--forge-accent-danger-border)",
          "warning-border": "var(--forge-accent-warning-border)",
          "insight-border": "var(--forge-accent-insight-border)",
          // Text
          "text-primary":   "var(--forge-text-primary)",
          "text-secondary": "var(--forge-text-secondary)",
          "text-inactive":  "var(--forge-text-inactive)",
          "text-muted":     "var(--forge-text-muted)",
          // Borders (also usable as bg-forge-border-subtle etc.)
          "border-subtle":  "var(--forge-border-subtle)",
          "border-default": "var(--forge-border-default)",
          // Chess-semantic: grade (engine move quality) and drill source
          // (which pool a Train Now card came from). Aliases onto the
          // accent palette above — see src/design/tokens.ts for the mapping.
          grade: {
            best:       "var(--forge-grade-best)",
            inaccuracy: "var(--forge-grade-inaccuracy)",
            mistake:    "var(--forge-grade-mistake)",
            blunder:    "var(--forge-grade-blunder)",
          },
          drill: {
            blunder:   "var(--forge-drill-blunder)",
            deviation: "var(--forge-drill-deviation)",
            review:    "var(--forge-drill-review)",
            punish:    "var(--forge-drill-punish)",
          },
        },
      },
      borderRadius: {
        "forge-sm":   "var(--forge-radius-sm)",
        "forge-md":   "var(--forge-radius-md)",
        "forge-lg":   "var(--forge-radius-lg)",
        "forge-xl":   "var(--forge-radius-xl)",
        "forge-pill": "var(--forge-radius-pill)",
      },
      fontSize: {
        "forge-label-sm": ["var(--forge-label-sm-size)", { letterSpacing: "var(--forge-label-sm-tracking)" }],
        "forge-label":    ["var(--forge-label-size)",    { letterSpacing: "var(--forge-label-tracking)" }],
        "forge-label-lg": ["var(--forge-label-lg-size)", { letterSpacing: "var(--forge-label-lg-tracking)" }],
      },
      transitionDuration: {
        "forge-fast": "var(--forge-motion-fast)",
        "forge-base": "var(--forge-motion-base)",
      },
      transitionTimingFunction: {
        forge: "var(--forge-motion-easing)",
      },
    },
  },
  plugins: [],
};
