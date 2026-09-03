import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getHiringAccess } from "@/lib/hiring/access";
import { can } from "@/lib/hiring/rbac";
import {
  buildCandidateWhere,
  candidateOrderBy,
  applicationListInclude,
  serializeApplicationRow,
  sortRows,
} from "@/lib/hiring/candidates";
import { CandidatesClient } from "./client";

export const dynamic = "force-dynamic";

export default async function HiringCandidatesPage({
  searchParams,
}: {
  searchParams: {
    status?: string; jobId?: string; stageId?: string; ownerId?: string;
    minScore?: string; source?: string; q?: string; sort?: string; stageTab?: string;
  };
}) {
  const { userId, access } = await getHiringAccess();
  if (!userId || !access) redirect("/login");

  if (!can(access, "candidate:read")) {
    return (
      <>
        <TopBar title="Candidates" subtitle="Hiring" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            Candidates are visible to the hiring team. You are signed in as{" "}
            <strong className="text-on-surface">{access.roleLabel}</strong>.
          </div>
        </div>
      </>
    );
  }

  const minScore = searchParams.minScore ? Number(searchParams.minScore) : null;
  const where = buildCandidateWhere({
    status: searchParams.status,
    jobId: searchParams.jobId,
    stageId: searchParams.stageId,
    ownerId: searchParams.ownerId,
    minScore: Number.isFinite(minScore) ? minScore : null,
    source: searchParams.source,
    q: searchParams.q,
  });

  // The stage tabs (Applied / Shortlisted / …) match on stage NAME across every
  // req, because per-job stages are renameable and a global tab can only be a
  // best-effort grouping. The kind-based filters above are the exact ones.
  const stageTab = searchParams.stageTab ?? "";
  if (stageTab) where.stage = { name: { equals: stageTab, mode: "insensitive" } };

  const [rows, jobs, owners, views] = await Promise.all([
    prisma.hiringApplication.findMany({
      where,
      include: applicationListInclude,
      orderBy: candidateOrderBy(searchParams.sort),
      take: 500,
    }),
    prisma.hiringJob.findMany({
      where: { deletedAt: null },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, username: true },
      orderBy: { username: "asc" },
    }),
    prisma.hiringSavedView.findMany({
      where: { rail: "candidates", OR: [{ userId }, { isShared: true }] },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <>
      <TopBar
        title="Candidates"
        subtitle="Searchable across every requisition · AI scores, skills, source attribution"
      />
      <div className="p-margin">
        <CandidatesClient
          applications={sortRows(rows.map((r) => serializeApplicationRow(r)), searchParams.sort)}
          jobs={jobs}
          owners={owners}
          savedViews={views.map((v) => ({
            id: v.id,
            name: v.name,
            filters: v.filters as Record<string, string>,
            isShared: v.isShared,
          }))}
          filters={{
            status: searchParams.status ?? "active",
            jobId: searchParams.jobId ?? "",
            ownerId: searchParams.ownerId ?? "",
            minScore: searchParams.minScore ?? "",
            source: searchParams.source ?? "",
            q: searchParams.q ?? "",
            sort: searchParams.sort ?? "score_desc",
            stageTab,
          }}
          canWrite={can(access, "candidate:write")}
          canMove={can(access, "candidate:move")}
          loadedAt={new Date().toISOString()}
        />
      </div>
    </>
  );
}
