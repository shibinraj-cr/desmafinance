import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";
import { EtimeSettingsClient } from "./client";

export const dynamic = "force-dynamic";

export default async function AttendanceSettingsPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!canApproveHr(perms)) {
    return (
      <>
        <TopBar title="Biometric Sync" subtitle="HR" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            Biometric sync settings are available to HR approvers only.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar title="Biometric Sync" subtitle="eTimeOffice attendance integration" />
      <div className="p-margin space-y-lg">
        <EtimeSettingsClient />
      </div>
    </>
  );
}
