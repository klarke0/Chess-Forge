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
          warm:             "var(--forge-accent-warm)",
          "warm-muted":     "var(--forge-accent-warm-muted)",
          success:          "var(--forge-accent-success)",
          "success-muted":  "var(--forge-accent-success-muted)",
          danger:           "var(--forge-accent-danger)",
          "danger-muted":   "var(--forge-accent-danger-muted)",
          warning:          "var(--forge-accent-warning)",
          "warning-muted":  "var(--forge-accent-warning-muted)",
          insight:          "var(--forge-accent-insight)",
          "insight-muted":  "var(--forge-accent-insight-muted)",
          // Text
          "text-primary":   "var(--forge-text-primary)",
          "text-secondary": "var(--forge-text-secondary)",
          "text-inactive":  "var(--forge-text-inactive)",
          "text-muted":     "var(--forge-text-muted)",
          // Borders (also usable as bg-forge-border-subtle etc.)
          "border-subtle":  "var(--forge-border-subtle)",
          "border-default": "var(--forge-border-default)",
        },
      },
      borderRadius: {
        "forge-sm":   "var(--forge-radius-sm)",
        "forge-md":   "var(--forge-radius-md)",
        "forge-lg":   "var(--forge-radius-lg)",
        "forge-xl":   "var(--forge-radius-xl)",
        "forge-pill": "var(--forge-radius-pill)",
      },
    },
  },
  plugins: [],
};
