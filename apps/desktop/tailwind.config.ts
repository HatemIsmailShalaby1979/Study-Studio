import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      // Every colour token defined in globals.css MUST be listed here.
      // A token that exists in CSS but not in this map produces no utility
      // class, so `bg-primary-soft` silently renders nothing. Guarded by
      // scripts/check-tokens.mjs — see DESIGN.md §11 D1/D2.
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: "var(--card)",
        "card-border": "var(--card-border)",
        primary: "var(--primary)",
        "primary-hover": "var(--primary-hover)",
        "primary-soft": "var(--primary-soft)",
        sidebar: "var(--sidebar)",
        "sidebar-hover": "var(--sidebar-hover)",
        muted: "var(--muted)",
        "accent-green": "var(--accent-green)",
        "accent-red": "var(--accent-red)",
        "accent-blue": "var(--accent-blue)",
        "accent-amber": "var(--accent-amber)",
      },
      // `--font-inter` is set on <html> by next/font (src/app/layout.tsx).
      // Exposed here so components can reach the typeface through `font-sans`
      // instead of hard-coding a family name. The system stack mirrors the
      // fallback in globals.css and is what covers Arabic glyphs.
      fontFamily: {
        sans: [
          "var(--font-inter, 'Inter')",
          "system-ui",
          "-apple-system",
          "'Segoe UI'",
          "Roboto",
          "'Helvetica Neue'",
          "Arial",
          "sans-serif",
        ],
        // `--font-geist-mono` is set by next/font/local (src/app/layout.tsx)
        // from the GeistMonoVF.woff already in the repo. Without this entry
        // `font-mono` silently used Tailwind's default stack and the shipped
        // font file stayed dead weight (DESIGN.md §11 D4).
        mono: [
          "var(--font-geist-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "'Liberation Mono'",
          "'Courier New'",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};
export default config;
