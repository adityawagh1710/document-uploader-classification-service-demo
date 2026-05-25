import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Slate-based dashboard palette — matches the reference's KPI tiles.
        bg: {
          base: "#0a0f1c",
          panel: "rgba(30,41,59,0.75)",
          panelAlt: "rgba(15,23,42,0.65)",
        },
        border: {
          subtle: "rgba(148,163,184,0.12)",
          strong: "rgba(148,163,184,0.30)",
        },
        accent: {
          ok: "#4ade80",
          warn: "#fbbf24",
          crit: "#f87171",
          info: "#38bdf8",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      animation: {
        pulse: "pulse 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
