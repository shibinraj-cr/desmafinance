import { PhasePlaceholder } from "../_phase-placeholder";

export const dynamic = "force-dynamic";

export default function MonthlyReportPlaceholder() {
  return (
    <PhasePlaceholder
      title="Monthly Funnel Report"
      phase="Phase C"
      description="Replaces the legacy Excel monthly tabs. Eight-source matrix with sticky BDE column, KPI strip, conversion-coloured cells, and Excel/PDF exports."
    />
  );
}
