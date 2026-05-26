import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { SandwichPolicyClient } from "./client";

export const dynamic = "force-dynamic";

export default async function SandwichPolicyPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Sandwich Leave Policy" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">No access.</div>
          </Section>
        </div>
      </>
    );
  }
  const [policies, departments] = await Promise.all([
    prisma.hrSandwichPolicy.findMany({
      include: { department: { select: { name: true } } },
      orderBy: [{ departmentId: "asc" }],
    }),
    prisma.hrDepartment.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  return (
    <>
      <TopBar
        title="Sandwich Leave Policy"
        subtitle="Holidays / week-offs bracketed by leave count as leave"
      />
      <div className="p-margin space-y-lg">
        <SandwichPolicyClient
          canEdit={canApproveHr(perms)}
          policies={policies.map((p) => ({
            id: p.id,
            departmentId: p.departmentId,
            departmentName: p.department?.name ?? null,
            enabled: p.enabled,
            includeHolidays: p.includeHolidays,
            includeWeekOffs: p.includeWeekOffs,
            maxGapDays: p.maxGapDays,
            notes: p.notes,
          }))}
          departments={departments}
        />
      </div>
    </>
  );
}
