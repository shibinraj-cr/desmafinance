import { HudClock } from "./_hud-clock";

/**
 * Lead Pulse uses the dark "Futuristic HUD" skin (deep charcoal background,
 * glassmorphism cards, gold accents + glow) instead of the light Finance
 * theme. Scope the dark surfaces with a `.lp-scope` wrapper that overrides the
 * background and default text colour for everything inside Lead Pulse and
 * carries the `--lp-*` design tokens consumed by the HUD rules in globals.css.
 *
 * The site-level SideNav stays as-is (already dark) — only the main canvas
 * needs the override. The ambient grid + corner glows are painted by
 * `.lp-scope::before/::after` (globals.css); content sits above them.
 */
export default function LeadPulseLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-full lp-scope"
      style={{
        // Core surfaces — deepened to a near-black warm charcoal and made
        // translucent so the glass `backdrop-filter` reads against the grid.
        ["--lp-surface" as string]: "#0B0A06",
        ["--lp-surface-container" as string]: "rgba(28,24,14,0.66)",
        ["--lp-surface-container-high" as string]: "rgba(40,35,22,0.72)",
        ["--lp-surface-container-low" as string]: "rgba(20,17,9,0.7)",
        // Opaque fallbacks for places that need a solid fill (chart tooltips,
        // native pickers) — referenced from CSS / _charts.tsx.
        ["--lp-surface-solid" as string]: "#14110a",
        ["--lp-on-surface" as string]: "#EDE6D6",
        ["--lp-on-surface-variant" as string]: "#d1c6ab",
        ["--lp-outline" as string]: "#9a9078",
        ["--lp-outline-variant" as string]: "rgba(245,197,24,0.14)",
        // Gold stays the primary accent; cyan/orange/violet are data companions.
        ["--lp-primary" as string]: "#facc15",
        ["--lp-on-primary" as string]: "#3c2f00",
        ["--lp-cyan" as string]: "#33e4ff",
        ["--lp-orange" as string]: "#ffb693",
        ["--lp-accent-2" as string]: "#8B7BFF",
        ["--lp-error" as string]: "#ffb4ab",
        // HUD chrome tokens.
        ["--lp-glow" as string]: "0 0 0 1px rgba(245,197,24,0.08), 0 0 24px rgba(250,204,21,0.07)",
        ["--lp-glass-blur" as string]: "10px",
        backgroundColor: "var(--lp-surface)",
        color: "var(--lp-on-surface)",
      }}
    >
      {/* HUD header band — cosmetic. Module wordmark + pulsing LIVE pill + clock. */}
      <div className="lp-hud-header">
        <div className="flex items-baseline gap-[10px] min-w-0">
          <span className="lp-hud-title">Marketing</span>
          <span className="lp-hud-sub">Lead Pulse · OS</span>
        </div>
        <div className="flex items-center gap-[10px] flex-shrink-0">
          <span className="lp-hud-live">
            <span className="lp-hud-live-dot" aria-hidden />
            Live
          </span>
          <HudClock />
        </div>
      </div>
      {children}
    </div>
  );
}
