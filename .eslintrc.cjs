module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
  ],
  ignorePatterns: ["dist", ".eslintrc.cjs", "scripts/archive/**", "test_sf_mate.ts"],
  parser: "@typescript-eslint/parser",
  plugins: ["react-refresh"],
  rules: {
    "react-refresh/only-export-components": [
      "warn",
      { allowConstantExport: true },
    ],
    // Allowed but visible — drives token migration without breaking existing builds.
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        "vars": "all",
        "args": "after-used",
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_",
        "caughtErrors": "all",
        "caughtErrorsIgnorePattern": "^_"
      }
    ],
    // Design-system enforcement: forbid hardcoded color literals so the forge-*
    // token system stays the single source of truth. See CLAUDE.md "Style
    // Conventions". Domain-specific palettes (e.g. move-quality colors in
    // GameReviewSummary, the chess.com square palette in BOARD_THEME) are
    // intentionally exempted by being centralized in design/tokens.ts.
    "no-restricted-syntax": [
      "warn",
      {
        selector:
          "Literal[value=/(?:bg|border|text|ring|outline|divide|fill|stroke|shadow)-\\[#[0-9a-fA-F]{3,8}\\]/]",
        message:
          "Hardcoded color literals are not allowed. Use a forge-* token from src/design/tokens.ts (e.g. bg-forge-card) or add a new token if one is missing.",
      },
      {
        selector:
          "Literal[value=/(?:bg|border|text|divide|ring)-white\\/(?:[0-9]+|\\[0\\.[0-9]+\\])/]",
        message:
          "white/N opacity utilities bypass the token system. Use border-forge-border-subtle, border-forge-border-default, or add a new token if you need a different opacity.",
      },
    ],
  },
  overrides: [
    {
      // V2 product surface: also forbid raw Tailwind palette classes
      // (text-slate-400, bg-indigo-600, border-rose-500/20, ...). Unlike
      // hardcoded hex, these slip past the base rule above because they
      // read as ordinary Tailwind utilities — but every high-frequency one
      // is already a forge-* token (see src/design/tokens.ts and the
      // 2026-09 design-system sweep). A handful of one-off shades with no
      // clean token equivalent (odd opacities, the sky-* phase color) are
      // knowingly left unflagged rather than forced onto the wrong token.
      files: ["src/v2/**"],
      rules: {
        "no-restricted-syntax": [
          "warn",
          {
            selector:
              "Literal[value=/(?:bg|border|text|ring|outline|divide|fill|stroke|shadow)-\\[#[0-9a-fA-F]{3,8}\\]/]",
            message:
              "Hardcoded color literals are not allowed. Use a forge-* token from src/design/tokens.ts (e.g. bg-forge-card) or add a new token if one is missing.",
          },
          {
            selector:
              "Literal[value=/(?:bg|border|text|divide|ring)-white\\/(?:[0-9]+|\\[0\\.[0-9]+\\])/]",
            message:
              "white/N opacity utilities bypass the token system. Use border-forge-border-subtle, border-forge-border-default, or add a new token if you need a different opacity.",
          },
          {
            selector:
              "Literal[value=/\\b(?:bg|border|text)-(?:slate|rose|emerald|amber|indigo|violet|orange|yellow)-[0-9]{2,3}(?:\\/[0-9]{1,3})?\\b/]",
            message:
              "Raw Tailwind palette classes bypass the token system. Use the matching forge-* token (e.g. text-forge-danger, not text-rose-400) — see src/design/tokens.ts. If no token fits, add one rather than reaching for the raw palette.",
          },
        ],
      },
    },
    {
      // V1-only files preserved for the legacy shell — exempt from the token
      // sweep so we don't churn deprecated code that's no longer extended.
      files: [
        "src/App.tsx",
        "src/components/Layout.tsx",
        "src/components/TrainTab.tsx",
        "src/components/ReviewTab.tsx",
        "src/components/LibraryTab.tsx",
        "src/components/ChapterLibrary.tsx",
        "src/components/CoachPanel.tsx",
        "src/components/SettingsPanel.tsx",
        "src/components/ExplorePanel/**",
        "src/hooks/useTraining.ts",
        "src/stores/trainingStore.ts",
      ],
      rules: {
        "no-restricted-syntax": "off",
        "no-empty": "off",
        "no-constant-condition": "off",
        "@typescript-eslint/no-unused-vars": "off",
        "prefer-const": "off",
      },
    },
  ],
};
