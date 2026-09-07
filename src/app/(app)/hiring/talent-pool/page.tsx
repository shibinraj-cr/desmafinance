import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getHiringAccess } from "@/lib/hiring/access";
import { can } from "@/lib/hiring/rbac";
import { TALENT_POOL_STATES } from "@/lib/hiring/constants";
import { rankJobs, type MatchableJob } from "@/lib/hiring/ingest/match";
import { TalentPoolClient } from "./client";

export const dynamic = "force-dynamic";

export default async function TalentPoolPage({ searchParams }: { searchParams: { state?: string } }) {
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

  return (
    <>
      <TopBar title="Talent pool" subtitle="Silver medallists and passive talent, kept warm" />
      <div className="p-margin">
        <TalentPoolClient
          prospects={rows.map((p) => ({
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
            matches: rankJobs(
              {
                currentTitle: p.candidate.currentTitle,
                skills: p.candidate.tags,
                totalExperienceYears: p.candidate.totalExperienceYears
                  ? Number(p.candidate.totalExperienceYears)
                  : null,
              },
              openJobs as MatchableJob[],
            ).map((m) => ({ jobId: m.jobId, title: m.title, fit: m.fit })),
          }))}
          counts={Object.fromEntries(counts.map((c) => [c.state, c._count._all]))}
          activeState={state}
          canWrite={can(access, "candidate:write")}
          loadedAt={new Date().toISOString()}
        />
      </div>
    </>
  );
}
