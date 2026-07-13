import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { VoxbayReconcileClient } from "./client";

export const dynamic = "force-dynamic";

const VOXBAY_RECONCILE_PAGE = "/crm/voxbay-reconcile";

export default async function VoxbayReconcilePage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  if (!canSeePage(perms, VOXBAY_RECONCILE_PAGE)) {
    return (
      <>
        <TopBar title="Voxbay Reconcile" subtitle="Admin" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            The Voxbay reconciliation tool is available to administrators and the Marketing Admin only.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar title="Voxbay Reconcile" subtitle="Find callers missing from the CRM" />
      <div className="p-margin space-y-lg">
        <VoxbayReconcileClient />
      </div>
    </>
  );
}
