/**
 * Lead Pulse uses the dark "Darkroom" theme from BUILD_SPEC §2 (deep
 * charcoal background, gold accents) instead of the light Finance theme.
 * Scope the dark surfaces with a wrapper element that overrides the
 * background and default text colour for everything inside Lead Pulse.
 *
 * The site-level SideNav stays as-is (already dark) — only the main
 * canvas needs the override.
 */
export default function LeadPulseLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-full lp-scope"
      style={{
        // CSS variables consumed by lp-* utility classes in globals.css
        // and inline styles below. Defined here so a Lead Pulse leaf
        // page can use them without further wiring.
        ["--lp-surface" as string]: "#171309",
        ["--lp-surface-container" as string]: "#231f14",
        ["--lp-surface-container-high" as string]: "#2e2a1e",
        ["--lp-surface-container-low" as string]: "#1f1b11",
        ["--lp-on-surface" as string]: "#ebe2d0",
        ["--lp-on-surface-variant" as string]: "#d1c6ab",
        ["--lp-outline" as string]: "#9a9078",
        ["--lp-outline-variant" as string]: "#4d4632",
        ["--lp-primary" as string]: "#facc15",
        ["--lp-on-primary" as string]: "#3c2f00",
        ["--lp-cyan" as string]: "#33e4ff",
        ["--lp-orange" as string]: "#ffb693",
        ["--lp-error" as string]: "#ffb4ab",
        backgroundColor: "var(--lp-surface)",
        color: "var(--lp-on-surface)",
      }}
    >
      {children}
    </div>
  );
}
