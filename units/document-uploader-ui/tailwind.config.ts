import type { Config } from "tailwindcss";

const config: Config = {
  // Opus2 product theme is light. The legacy technical dashboard (now at
  // /monitor) is dark — it scopes its own background via `.monitor-shell`
  // and uses explicit colors in the component classes (globals.css), so it
  // survives the switch to a light default without a `dark` variant.
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Opus2 semantic tokens (light) — sourced from the Figma prototype's
        //    theme.css and mapped to CSS variables defined in globals.css. ──
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: { DEFAULT: "var(--card)", foreground: "var(--card-foreground)" },
        popover: { DEFAULT: "var(--popover)", foreground: "var(--popover-foreground)" },
        primary: { DEFAULT: "var(--primary)", foreground: "var(--primary-foreground)" },
        secondary: { DEFAULT: "var(--secondary)", foreground: "var(--secondary-foreground)" },
        muted: { DEFAULT: "var(--muted)", foreground: "var(--muted-foreground)" },
        destructive: { DEFAULT: "var(--destructive)", foreground: "var(--destructive-foreground)" },
        input: "var(--input)",
        ring: "var(--ring)",
        header: { DEFAULT: "var(--header)", foreground: "var(--header-foreground)" },
        // `accent` carries both the Opus2 token (DEFAULT/foreground) and the
        // legacy dashboard status hues (ok/warn/crit/info) consumed by the
        // Monitor page's KpiTile/Pill component classes.
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
          ok: "#4ade80",
          warn: "#fbbf24",
          crit: "#f87171",
          info: "#38bdf8",
        },
        // `border` keeps a DEFAULT for the light theme plus the subtle/strong
        // pair the Monitor dashboard already depends on.
        border: {
          DEFAULT: "var(--border)",
          subtle: "rgba(148,163,184,0.12)",
          strong: "rgba(148,163,184,0.30)",
        },
        // Legacy dark dashboard surface palette (Monitor page only).
        bg: {
          base: "#0a0f1c",
          panel: "rgba(30,41,59,0.75)",
          panelAlt: "rgba(15,23,42,0.65)",
        },
      },
      borderRadius: {
        card: "var(--radius-card)",
        button: "var(--radius-button)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        elevation: "0px 1px 1.1px 0px rgba(0,0,0,0.1)",
      },
      fontFamily: {
        sans: ["var(--font-lato)", "Lato", "ui-sans-serif", "system-ui", "sans-serif"],
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
