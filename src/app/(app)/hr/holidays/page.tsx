import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import { prisma } from "@/lib/prisma";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { HolidaysEditor } from "./client";

export const dynamic = "force-dynamic";

export default async function HrHolidaysPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Holiday Calendar" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">No access.</div>
          </Section>
        </div>
      </>
    );
  }
  const holidays = await prisma.hrHoliday.findMany({ orderBy: { date: "asc" } });
  return (
    <>
      <TopBar title="Holiday Calendar" subtitle={`${holidays.length} holiday${holidays.length === 1 ? "" : "s"}`} />
      <div className="p-margin">
        <HolidaysEditor
          holidays={holidays.map((h) => ({
            id: h.id,
            date: h.date.toISOString().slice(0, 10),
            label: h.label,
            paid: h.paid,
          }))}
          canEdit={canApproveHr(perms)}
        />
      </div>
    </>
  );
}
