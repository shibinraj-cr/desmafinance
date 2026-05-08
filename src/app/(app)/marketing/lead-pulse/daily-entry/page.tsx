import { PhasePlaceholder } from "../_phase-placeholder";

export const dynamic = "force-dynamic";

export default function DailyEntryPlaceholder() {
  return (
    <PhasePlaceholder
      title="Daily Entry"
      phase="Phase B"
      description="L1 and L2 BDEs will log their daily lead activity by source on this page. The table will validate row totals server-side, auto-save drafts, and lock entries older than 3 days."
    />
  );
}
