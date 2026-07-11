import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { MetaReconcileClient } from "./client";

export const dynamic = "force-dynamic";

const META_RECONCILE_PAGE = "/crm/meta-reconcile";

export default async function MetaReconcilePage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  if (!canSeePage(perms, META_RECONCILE_PAGE)) {
    return (
      <>
        <TopBar title="Meta Reconcile" subtitle="Admin" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            The Meta reconciliation tool is available to administrators and the Marketing Admin only.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar title="Meta Reconcile" subtitle="Find Meta leads missing from the CRM" />
      <div className="p-margin space-y-lg">
        <MetaReconcileClient />
      </div>
    </>
  );
}
