import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getHiringAccess } from "@/lib/hiring/access";
import { can } from "@/lib/hiring/rbac";
import { TALENT_POOL_STATES } from "@/lib/hiring/constants";
import { rankJobs, type MatchableJob } from "@/lib/hiring/ingest/match";
import { orderPool, POOL_SORTS, type PoolSort } from "@/lib/hiring/talent-pool";
import { TalentPoolClient } from "./client";

export const dynamic = "force-dynamic";

export default async function TalentPoolPage({
  searchParams,
}: {
  searchParams: { state?: string; job?: string; sort?: string; all?: string };
}) {
  const { userId, access } = await getHiringAccess();
  if (!userId || !access) redirect("/login");

  if (!can(access, "candidate:read")) {
    return (
      <>
        <TopBar title="Talent pool" subtitle="Hiring" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            The talent pool is visible to the hiring team.
          </div>
        </div>
      </>
    );
  }

  const state = (TALENT_POOL_STATES as readonly string[]).includes(searchParams.state ?? "")
    ? searchParams.state!
    : "";
  const showAll = searchParams.all === "1";

  const [rows, counts, openJobs] = await Promise.all([
    prisma.hiringTalentPool.findMany({
      where: state ? { state } : {},
      include: {
        candidate: {
          select: {
            id: true, fullName: true, email: true, phone: true,
            currentTitle: true, tags: true, totalExperienceYears: true,
          },
        },
        owner: { select: { username: true } },
      },
      orderBy: [{ nextTouchAt: "asc" }, { updatedAt: "desc" }],
      take: 500,
    }),
    prisma.hiringTalentPool.groupBy({ by: ["state"], _count: { _all: true } }),
    // One query for the page. `rankJobs` is pure and in-memory, so scoring 500
    // cards against the open roles costs nothing per card.
    prisma.hiringJob.findMany({
      where: { status: { in: ["live", "paused"] }, deletedAt: null },
      select: { id: true, title: true, mustHaves: true, niceToHaves: true, seniority: true },
      orderBy: { title: "asc" },
    }),
  ]);

  // A job filter only means something for a job that exists and is open.
  const jobId = openJobs.some((j) => j.id === searchParams.job) ? searchParams.job! : "";
  const sort: PoolSort = (POOL_SORTS as readonly string[]).includes(searchParams.sort ?? "")
    ? (searchParams.sort as PoolSort)
    // Picking a job is asking "who fits this?", so fit becomes the default order.
    : jobId
      ? "fit"
      : "due";

  const ranked = rows.map((p) => {
    const matches = rankJobs(
      {
        currentTitle: p.candidate.currentTitle,
        skills: p.candidate.tags,
        totalExperienceYears: p.candidate.totalExperienceYears
          ? Number(p.candidate.totalExperienceYears)
          : null,
      },
      openJobs as MatchableJob[],
    ).map((m) => ({ jobId: m.jobId, title: m.title, fit: m.fit }));
    const forJob = jobId ? (matches.find((m) => m.jobId === jobId)?.fit ?? 0) : null;
    return { p, matches, forJob, best: matches.reduce((n, m) => Math.max(n, m.fit), 0) };
  });

  // Filtering to a job hides the zeroes — but SAYS how many, because a criterion
  // phrased so no keyword can evidence it ("Language", "Degree") scores everyone
  // zero, and silently emptying the page would read as "nobody suits this role".
  const zeroes = jobId ? ranked.filter((r) => r.forJob === 0).length : 0;
  const visible = jobId && !showAll ? ranked.filter((r) => r.forJob! > 0) : ranked;

  const sorted = orderPool(
    visible.map((r) => ({
      ...r,
      fullName: r.p.candidate.fullName,
      nextTouchAt: r.p.nextTouchAt,
      updatedAt: r.p.updatedAt,
      createdAt: r.p.createdAt,
    })),
    sort,
    !!jobId,
  );

  return (
    <>
      <TopBar title="Talent pool" subtitle="Silver medallists and passive talent, kept warm" />
      <div className="p-margin">
        <TalentPoolClient
          prospects={sorted.map(({ p, matches, forJob }) => ({
            id: p.id,
            candidateId: p.candidate.id,
            fullName: p.candidate.fullName,
            email: p.candidate.email,
            phone: p.candidate.phone,
            currentTitle: p.candidate.currentTitle,
            tags: p.candidate.tags,
            state: p.state,
            interestAreas: p.interestAreas,
            lastTouchAt: p.lastTouchAt?.toISOString() ?? null,
            nextTouchAt: p.nextTouchAt?.toISOString() ?? null,
            ownerName: p.owner?.username ?? null,
            notesMd: p.notesMd,
            matches,
          }))}
          counts={Object.fromEntries(counts.map((c) => [c.state, c._count._all]))}
          activeState={state}
          jobs={openJobs.map((j) => ({ id: j.id, title: j.title }))}
          activeJobId={jobId}
          sort={sort}
          hiddenZeroCount={showAll ? 0 : zeroes}
          showingAll={showAll}
          canWrite={can(access, "candidate:write")}
          loadedAt={new Date().toISOString()}
        />
      </div>
    </>
  );
}
