/**
 * Media Planner reuses the Lead Pulse Darkroom theme (gold / cyan / orange /
 * purple accents on dark surfaces). Mirrors the voxbay layout — the wrapper
 * provides the `--lp-*` CSS variables and background, every child inherits.
 * Without this layout the page would render on the light canvas with the
 * variables undefined (the holiday-calendar gap).
 */
export default function MediaPlannerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-full lp-scope"
      style={{
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
