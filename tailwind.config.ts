import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // DESFIN brand palette: bright gold accent on charcoal, with light surfaces
        // for legibility of dense financial data.
        primary: "#F5C518", // gold/yellow — buttons, chart accents
        "primary-container": "#C9A019", // darker gold (hover, accent stripes)
        "on-primary": "#1A1A1A", // near-black text on yellow buttons
        "on-primary-container": "#FFF8DC", // cream
        "primary-fixed": "#FFE082", // light gold tint
        "primary-fixed-dim": "#FFD54F", // mid gold
        accent: "#7E6510", // dark gold — passes WCAG AA on white for inline text

        // Sidebar / brand surfaces (dark charcoal — matches the logo background)
        brand: "#1F1F1F",
        "brand-elevated": "#2A2A2A",
        "brand-line": "#3A3A3A",
        "on-brand": "#F5F5F5",
        "on-brand-variant": "#BDBDBD",

        // Light surfaces (main canvas, cards)
        secondary: "#5C5F61",
        "on-secondary": "#FFFFFF",
        "secondary-container": "#E0E3E5",
        "on-secondary-container": "#3F3F3F",
        "secondary-fixed-dim": "#9E9E9E",
        tertiary: "#5D4037",
        surface: "#FAFAFA",
        "surface-dim": "#E5E5E5",
        "surface-bright": "#FFFFFF",
        "surface-container-lowest": "#FFFFFF",
        "surface-container-low": "#F5F5F5",
        "surface-container": "#EEEEEE",
        "surface-container-high": "#E7E7E7",
        "surface-container-highest": "#DDDDDD",
        "surface-variant": "#E1E1E1",
        "on-surface": "#1A1A1A",
        "on-surface-variant": "#424242",
        outline: "#9E9E9E",
        "outline-variant": "#D5D5D5",
        error: "#BA1A1A",
        "error-container": "#FFDAD6",
        "on-error-container": "#93000A",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        // Lead Pulse "Futuristic HUD" display face — consumed only inside
        // `.lp-scope` (the mono face is applied via scoped CSS so the global
        // `font-mono` utility is left untouched for Finance/HR).
        display: ["var(--font-display)", "var(--font-inter)", "Inter", "sans-serif"],
        malayalam: [
          "Noto Sans Malayalam",
          "var(--font-inter)",
          "Inter",
          "system-ui",
          "sans-serif",
        ],
      },
      borderRadius: {
        DEFAULT: "0.5rem",
        sm: "0.25rem",
        md: "0.75rem",
        lg: "1rem",
        xl: "1.5rem",
      },
      spacing: {
        xs: "4px",
        sm: "12px",
        base: "8px",
        md: "16px",
        lg: "24px",
        xl: "32px",
        gutter: "24px",
        margin: "32px",
      },
      fontSize: {
        h1: ["30px", { lineHeight: "38px", letterSpacing: "-0.02em", fontWeight: "600" }],
        h2: ["24px", { lineHeight: "32px", letterSpacing: "-0.01em", fontWeight: "600" }],
        h3: ["20px", { lineHeight: "28px", fontWeight: "600" }],
        "body-lg": ["16px", { lineHeight: "24px", fontWeight: "400" }],
        "body-md": ["14px", { lineHeight: "20px", fontWeight: "400" }],
        "label-sm": ["12px", { lineHeight: "16px", fontWeight: "500" }],
        caption: ["12px", { lineHeight: "16px", fontWeight: "400" }],
        "data-mono": ["14px", { lineHeight: "20px", letterSpacing: "0.02em", fontWeight: "600" }],
      },
    },
  },
  plugins: [],
};
export default config;
