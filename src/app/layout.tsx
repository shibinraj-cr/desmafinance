import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "@/components/providers";

// Fonts are SELF-HOSTED (./fonts), not fetched from Google at build time.
//
// `next/font/google` downloads every face from fonts.gstatic.com during
// `next build`. That is a network call per weight on a build machine we do not
// control, and a single failure aborts the whole build with an unrelated-looking
// "TypeError: Cannot read properties of null (reading '1')" out of the font
// loader. It cost two red deploys on 23-24 Sep 2026 — neither had anything to do
// with the code being shipped.
//
// These are the same Google faces, latin subset, in their VARIABLE form: one
// file each covering the whole weight range instead of one per weight, so all
// three together are ~111 KB and the build makes no network call for type.
//
// To refresh: take the `/* latin */` src URL from
// https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap
// (requested with a modern browser User-Agent, or Google serves .ttf) and
// replace the file. Keep the declared weight range in step with that CSS.
const inter = localFont({
  src: "./fonts/Inter-latin-variable.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-inter",
  display: "swap",
  fallback: ["Inter", "system-ui", "sans-serif"],
});

// Display + mono faces for the Lead Pulse "Futuristic HUD" skin. Exposed as
// CSS variables and consumed only inside `.lp-scope` (see globals.css) so the
// rest of the app keeps Inter and its existing text metrics.
const spaceGrotesk = localFont({
  src: "./fonts/SpaceGrotesk-latin-variable.woff2",
  weight: "300 700",
  style: "normal",
  variable: "--font-display",
  display: "swap",
  fallback: ["Inter", "system-ui", "sans-serif"],
});

const jetbrainsMono = localFont({
  src: "./fonts/JetBrainsMono-latin-variable.woff2",
  weight: "100 800",
  style: "normal",
  variable: "--font-mono",
  display: "swap",
  // Arial is the default metric donor and is wrong for a mono face — it would
  // make the fallback render at a visibly different width.
  adjustFontFallback: false,
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});

export const metadata: Metadata = {
  title: "DESGRO — Desma International",
  description: "Desma International — Financial Insights Dashboard",
  icons: {
    icon: [
      { url: "/desgro-icon.png", type: "image/png" },
    ],
    apple: "/desgro-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        {/* Material Symbols isn't available via next/font; load via link tag. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
        />
      </head>
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
