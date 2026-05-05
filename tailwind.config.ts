import type { Config } from "tailwindcss";

// Tokens are sourced from docs/dvsl-visual-spec.md. Anything that
// would look "DVSL-ish" should resolve through one of these — the
// visual spec is the single source of truth for both this config
// and the component CSS.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Inter: body / tables / form inputs / metadata.
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        // Barlow Condensed: section titles, hero, eyebrows, buttons,
        // table headers, scoreboard numbers, ticker datetime.
        barlow: ["'Barlow Condensed'", "Inter", "sans-serif"],
        // Oswald: team identity (team names in tables, big abbrevs
        // in the box-score popup, week-nav dates, ticker abbrevs,
        // tab buttons).
        oswald: ["Oswald", "Inter", "sans-serif"],
      },
      colors: {
        // Tenant theme. The middleware sets --brand-primary on
        // :root from tenant config; SFBL/DVSL get #002D72.
        brand: {
          primary: "var(--brand-primary, #002D72)",
          accent: "var(--brand-accent, #F5C842)",
        },
        // DVSL semantic palette. DVSL's `--gold` and `--white` are
        // misnamed — `--gold` is actually navy #002D72 and `--white`
        // is near-black #1a1a1a. We rename them here so the codebase
        // reads honestly.
        ink: "#1a1a1a",
        muted: {
          DEFAULT: "rgba(0,0,0,0.50)", // --muted
          soft: "rgba(0,0,0,0.35)", // --muted2
        },
        surface: {
          DEFAULT: "#ffffff", // --bg / --card
          alt: "#f8f8f8", // --card2
          tint: "#f0f0f0", // --card3
          gray: "#f5f5f5", // --bg2 / footer
        },
        line: {
          DEFAULT: "rgba(0,0,0,0.10)", // --border
          strong: "rgba(0,0,0,0.15)", // --border2
          soft: "rgba(0,0,0,0.06)", // table row dividers
        },
        navy: {
          DEFAULT: "#002D72", // --gold / --blue
          dim: "rgba(0,45,114,0.08)", // --gold-dim
          glow: "rgba(0,45,114,0.10)", // --gold-glow
          soft: "rgba(0,45,114,0.04)", // career-row bg
        },
        // True accent gold (only inside dark box-score popup).
        gold: "#F5C842",
        win: "#22c55e",
        loss: "#c8102e",
      },
      letterSpacing: {
        eyebrow: "0.16em",
        nav: "0.07em",
        ticker: "0.10em",
        label: "0.12em",
        head: "0.04em",
        title: "-0.01em",
        hero: "-0.03em",
      },
      borderRadius: {
        card: "12px", // gc-card
        panel: "14px", // div-card, ldr-card, pcard
        modal: "18px", // modal-box
        pop: "16px", // pop-box, bsm-inner
      },
      boxShadow: {
        cardHover: "0 4px 20px rgba(0,0,0,0.10)",
        modal: "0 32px 80px rgba(0,0,0,0.20)",
        pop: "0 20px 60px rgba(0,0,0,0.15)",
        primary: "0 4px 20px rgba(59,130,246,0.35)",
      },
      maxWidth: {
        container: "1180px", // .container
        scores: "1060px", // .gc-cards-grid, .sb-wrap
        modal: "900px", // modal-box
        pop: "760px", // pop-box
      },
      height: {
        ticker: "48px",
        "ticker-mob": "64px",
        nav: "62px",
      },
    },
  },
  plugins: [],
};

export default config;
