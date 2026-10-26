import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { getCrmAccess } from "@/lib/crm-rbac";
import {
  FOLLOW_UP_CAP_DAYS,
  FOLLOW_UP_EXTENSION_DAYS,
  FOLLOW_UP_REVIEW_DAYS,
  REMARKETING_CAP_DAYS,
  runLifecycleSweep,
} from "@/lib/crm-lifecycle";
import { LifecycleClient } from "./client";

export const dynamic = "force-dynamic";

const LIFECYCLE_PAGE = "/crm/lifecycle";

export default async function LifecyclePage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  const access = await getCrmAccess(userId, perms);

  if (!canSeePage(perms, LIFECYCLE_PAGE) || !access.canBulkStatus) {
    return (
      <>
        <TopBar title="Lead Lifecycle" subtitle="Admin" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            The lifecycle caps are managed by administrators and the Marketing Admin.
          </div>
        </div>
      </>
    );
  }

  // What a run would do right now with the saved switches, and what switching
  // both on would do — the second is the number to look at before turning on.
  const [current, ifEnabled] = await Promise.all([
    runLifecycleSweep({ dryRun: true }),
    runLifecycleSweep({ dryRun: true, previewAsIfEnabled: true }),
  ]);

  return (
    <>
      <TopBar title="Lead Lifecycle" subtitle="Follow-Up and Re-marketing time limits" />
      <div className="p-margin space-y-lg">
        <LifecycleClient
          rules={{
            followUpCapDays: FOLLOW_UP_CAP_DAYS,
            followUpReviewDays: FOLLOW_UP_REVIEW_DAYS,
            followUpExtensionDays: FOLLOW_UP_EXTENSION_DAYS,
            remarketingCapDays: REMARKETING_CAP_DAYS,
          }}
          initial={JSON.parse(JSON.stringify(current))}
          ifEnabled={JSON.parse(JSON.stringify(ifEnabled))}
        />
      </div>
    </>
  );
}
