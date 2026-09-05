import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getHiringAccess } from "@/lib/hiring/access";
import { can } from "@/lib/hiring/rbac";
import { buildJobWhere, jobListInclude, serializeJobRow, computeJobKpis } from "@/lib/hiring/jobs";
import { JobsClient } from "./client";

export const dynamic = "force-dynamic";

export default async function HiringJobsPage({
  searchParams,
}: {
  searchParams: { tab?: string; department?: string; ownerId?: string; locationId?: string; q?: string };
}) {
  const { userId, access } = await getHiringAccess();
  if (!userId || !access) redirect("/login");

  if (!can(access, "job:read")) {
    return (
      <>
        <TopBar title="Jobs" subtitle="Hiring" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            Requisitions are visible to the hiring team. You are signed in as{" "}
            <strong className="text-on-surface">{access.roleLabel}</strong> — ask an Owner or HR
            Manager to add you on Hiring → Roles &amp; Access.
          </div>
        </div>
      </>
    );
  }

  const where = buildJobWhere({
    tab: searchParams.tab,
    department: searchParams.department,
    ownerId: searchParams.ownerId,
    locationId: searchParams.locationId,
    q: searchParams.q,
  });

  const [rows, kpis, locations, owners, departments, views] = await Promise.all([
    prisma.hiringJob.findMany({
      where,
      include: jobListInclude,
      orderBy: [{ createdAt: "desc" }],
      take: 500,
    }),
    computeJobKpis(),
    prisma.hiringLocation.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
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
    prisma.hiringSavedView.findMany({
      where: { rail: "jobs", OR: [{ userId }, { isShared: true }] },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <>
      <TopBar title="Jobs" subtitle="Requisitions across the company" />
      <div className="p-margin">
        <JobsClient
          jobs={rows.map(serializeJobRow)}
          kpis={kpis}
          locations={locations}
          owners={owners}
          departments={departments.map((d) => d.department)}
          savedViews={views.map((v) => ({
            id: v.id,
            name: v.name,
            filters: v.filters as Record<string, string>,
            isShared: v.isShared,
            mine: v.userId === userId,
          }))}
          filters={{
            tab: searchParams.tab ?? "all",
            department: searchParams.department ?? "",
            ownerId: searchParams.ownerId ?? "",
            locationId: searchParams.locationId ?? "",
            q: searchParams.q ?? "",
          }}
          canWrite={can(access, "job:write")}
          canApprove={can(access, "team:manage")}
          loadedAt={new Date().toISOString()}
        />
      </div>
    </>
  );
}
