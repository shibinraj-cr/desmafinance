import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getHiringAccess } from "@/lib/hiring/access";
import { can } from "@/lib/hiring/rbac";
import { isAiEnabled } from "@/lib/anthropic";
import { getCreditsState } from "@/lib/hiring/ai/credits";
import { WizardClient } from "./client";

export const dynamic = "force-dynamic";

export default async function NewJobPage() {
  const { userId, access } = await getHiringAccess();
  if (!userId || !access) redirect("/login");
  if (!can(access, "job:write")) redirect("/hiring/jobs");

  const [locations, roles, users, departments, credits] = await Promise.all([
    prisma.hiringLocation.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.hiringJobRole.findMany({
      where: { isActive: true },
      select: { id: true, title: true, department: true, defaultSeniority: true },
      orderBy: { title: "asc" },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, username: true },
      orderBy: { username: "asc" },
    }),
    prisma.hiringJob.findMany({
      where: { deletedAt: null },
      select: { department: true },
      distinct: ["department"],
      orderBy: { department: "asc" },
    }),
    getCreditsState(),
  ]);

  return (
    <>
      <TopBar title="New job" subtitle="Five steps to a live requisition" />
      <div className="p-margin">
        <WizardClient
          locations={locations}
          jobRoles={roles}
          users={users}
          departments={departments.map((d) => d.department)}
          currentUserId={userId}
          aiEnabled={isAiEnabled()}
          creditsRemaining={credits.remaining}
        />
      </div>
    </>
  );
}
