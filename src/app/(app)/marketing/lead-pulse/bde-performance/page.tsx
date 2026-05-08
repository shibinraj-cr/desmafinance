import { PhasePlaceholder } from "../_phase-placeholder";

export const dynamic = "force-dynamic";

export default function BdePerformancePlaceholder() {
  return (
    <PhasePlaceholder
      title="BDE Performance"
      phase="Phase E"
      description="Per-BDE performance dashboard with KPI strip, Performance Over Time chart, source-level breakdown, and recent daily entries."
    />
  );
}
