import { redirect } from "next/navigation";

// /finance/approvals is now a hub — Pending / Approved / Rejected each
// live at their own sub-route so deep links stay stable. Land everyone
// on Pending by default; the per-tab sub-page handles the actual work.
export default function ApprovalsIndex() {
  redirect("/finance/approvals/pending");
}
