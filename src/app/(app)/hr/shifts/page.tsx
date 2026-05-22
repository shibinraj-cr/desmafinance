import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { loadShifts } from "@/lib/hr-data";
import { ShiftsEditor } from "./client";

export const dynamic = "force-dynamic";

export default async function ShiftsPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Shifts" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">
              You don&apos;t have access to the HR module.
            </div>
          </Section>
        </div>
      </>
    );
  }
  const shifts = await loadShifts();
  return (
    <>
      <TopBar title="Shifts" subtitle={`${shifts.length} shift${shifts.length === 1 ? "" : "s"}`} />
      <div className="p-margin">
        <ShiftsEditor
          shifts={shifts.map((s) => ({
            id: s.id,
            code: s.code,
            name: s.name,
            startTime: s.startTime,
            endTime: s.endTime,
            graceMinutes: s.graceMinutes,
            halfDayCutoffTime: s.halfDayCutoffTime,
            active: s.active,
          }))}
          canEdit={canApproveHr(perms)}
        />
      </div>
    </>
  );
}
