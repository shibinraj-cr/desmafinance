import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";

export default async function RootPage() {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) redirect("/login");
  // L1 / L2 BDEs work out of the CRM, so default them to their "My Leads"
  // queue (the page already scopes to the BDE's own leads). Everyone else
  // lands on their first allowed page; fallback to /finance/overview.
  const lp = await getLeadPulseAccess(userId, perms);
  if (lp.role === "l1" || lp.role === "l2") {
    redirect("/crm/leads");
  }
  const target = perms.pages[0] ?? "/finance/overview";
  redirect(target);
}
