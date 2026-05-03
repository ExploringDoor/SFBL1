import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Tenant theme overrides land here via CSS vars at runtime.
        brand: {
          primary: "var(--brand-primary, #1e40af)",
          accent: "var(--brand-accent, #f59e0b)",
        },
      },
    },
  },
  plugins: [],
};

export default config;
