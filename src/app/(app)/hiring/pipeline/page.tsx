import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getHiringAccess } from "@/lib/hiring/access";
import { can } from "@/lib/hiring/rbac";
import { applicationListInclude, serializeApplicationRow } from "@/lib/hiring/candidates";
import { buildBoardColumns } from "@/lib/hiring/board";
import { PipelineClient } from "./client";

export const dynamic = "force-dynamic";

export default async function HiringPipelinePage({
  searchParams,
}: {
  searchParams: { jobId?: string; ownerId?: string; department?: string };
}) {
  const { userId, access } = await getHiringAccess();
  if (!userId || !access) redirect("/login");

  if (!can(access, "candidate:read")) {
    return (
      <>
        <TopBar title="Pipeline" subtitle="Hiring" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            The pipeline is visible to the hiring team.
          </div>
        </div>
      </>
    );
  }

  // The board spans every requisition that is still taking candidates.
  const jobWhere = {
    deletedAt: null,
    status: { in: ["live", "paused"] },
    ...(searchParams.jobId ? { id: searchParams.jobId } : {}),
    ...(searchParams.department ? { department: searchParams.department } : {}),
    ...(searchParams.ownerId ? { ownerId: searchParams.ownerId } : {}),
  };

  const jobs = await prisma.hiringJob.findMany({
    where: jobWhere,
    select: {
      id: true,
      title: true,
      department: true,
      stages: { orderBy: { position: "asc" }, select: { id: true, name: true, kind: true, position: true } },
    },
    orderBy: { title: "asc" },
  });

  const stages = jobs.flatMap((j) => j.stages.map((s) => ({ ...s, jobId: j.id })));
  const jobIds = jobs.map((j) => j.id);

  const [rows, owners, departments] = await Promise.all([
    jobIds.length
      ? prisma.hiringApplication.findMany({
          where: { jobId: { in: jobIds }, deletedAt: null, status: { in: ["active", "on_hold"] } },
          include: applicationListInclude,
          orderBy: [{ aiScore: "desc" }],
          take: 1000,
        })
      : Promise.resolve([]),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, username: true },
      orderBy: { username: "asc" },
    }),
    prisma.hiringJob.findMany({
      where: { deletedAt: null, status: { in: ["live", "paused"] } },
      select: { department: true },
      distinct: ["department"],
      orderBy: { department: "asc" },
    }),
  ]);

  return (
    <>
      <TopBar title="Pipeline" subtitle="Every active candidate, across every open requisition" />
      <div className="p-margin">
        <PipelineClient
          columns={buildBoardColumns(stages)}
          stages={stages}
          cards={rows.map((r) => serializeApplicationRow(r))}
          jobs={jobs.map((j) => ({ id: j.id, title: j.title }))}
          owners={owners}
          departments={departments.map((d) => d.department)}
          filters={{
            jobId: searchParams.jobId ?? "",
            ownerId: searchParams.ownerId ?? "",
            department: searchParams.department ?? "",
          }}
          canMove={can(access, "candidate:move")}
          canWrite={can(access, "candidate:write")}
          loadedAt={new Date().toISOString()}
        />
      </div>
    </>
  );
}
