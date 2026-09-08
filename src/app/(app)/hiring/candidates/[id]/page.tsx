import { redirect, notFound } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getHiringAccess } from "@/lib/hiring/access";
import { can } from "@/lib/hiring/rbac";
import { rankJobs, type MatchableJob } from "@/lib/hiring/ingest/match";
import { TALENT_POOL_STATE_LABELS, type TalentPoolState } from "@/lib/hiring/constants";
import { CandidateProfileClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * The candidate PROFILE — the person, not an application of theirs.
 *
 * `/hiring/candidates` lists applications, and its drawer is keyed on one. That
 * left everybody in the talent pool with no page at all: an imported résumé
 * creates a candidate and no application, so a recruiter could see the name on
 * a pool card and had nowhere to click. This is that page.
 */
export default async function CandidateProfilePage({ params }: { params: { id: string } }) {
  const { userId, access } = await getHiringAccess();
  if (!userId || !access) redirect("/login");
  if (!can(access, "candidate:read")) {
    return (
      <>
        <TopBar title="Candidate" subtitle="Hiring" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            Candidate records are visible to the hiring team.
          </div>
        </div>
      </>
    );
  }

  const candidate = await prisma.hiringCandidate.findFirst({
    where: { id: params.id, deletedAt: null },
    include: {
      owner: { select: { username: true } },
      createdBy: { select: { username: true } },
      talentPool: true,
      applications: {
        orderBy: { appliedAt: "desc" },
        select: {
          id: true,
          status: true,
          aiScore: true,
          appliedAt: true,
          job: { select: { id: true, title: true } },
          stage: { select: { name: true } },
        },
      },
      notes: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, bodyMd: true, createdAt: true, author: { select: { username: true } } },
      },
      talentPoolEvents: {
        orderBy: { occurredAt: "desc" },
        take: 200,
        select: {
          id: true, type: true, fromState: true, toState: true, note: true,
          occurredAt: true, actor: { select: { username: true } },
        },
      },
    },
  });
  if (!candidate) notFound();

  // Rank against everything still open. `rankJobs` is the free deterministic
  // matcher, NOT the AI rubric — the client labels it accordingly.
  const openJobs = await prisma.hiringJob.findMany({
    where: { status: { in: ["live", "paused"] }, deletedAt: null },
    select: { id: true, title: true, mustHaves: true, niceToHaves: true, seniority: true, status: true },
    orderBy: { title: "asc" },
  });

  const matches = rankJobs(
    {
      currentTitle: candidate.currentTitle,
      skills: candidate.tags,
      totalExperienceYears: candidate.totalExperienceYears
        ? Number(candidate.totalExperienceYears)
        : null,
    },
    openJobs as MatchableJob[],
  );
  const jobStatus = new Map(openJobs.map((j) => [j.id, j.status]));
  const appliedJobIds = new Set(candidate.applications.map((a) => a.job.id));

  return (
    <>
      <TopBar title={candidate.fullName} subtitle="Candidate profile" />
      <div className="p-margin">
        <CandidateProfileClient
          candidate={{
            id: candidate.id,
            fullName: candidate.fullName,
            email: candidate.email,
            phone: candidate.phone,
            currentTitle: candidate.currentTitle,
            currentEmployer: candidate.currentEmployer,
            locationText: candidate.locationText,
            totalExperienceYears: candidate.totalExperienceYears
              ? Number(candidate.totalExperienceYears)
              : null,
            noticePeriodDays: candidate.noticePeriodDays,
            currentCtcLakh: candidate.currentCtcLakh ? Number(candidate.currentCtcLakh) : null,
            expectedCtcLakh: candidate.expectedCtcLakh ? Number(candidate.expectedCtcLakh) : null,
            resumeUrl: candidate.resumeUrl,
            portfolioUrl: candidate.portfolioUrl,
            linkedinUrl: candidate.linkedinUrl,
            tags: candidate.tags,
            source: candidate.source,
            sourceDetail: candidate.sourceDetail,
            ownerName: candidate.owner?.username ?? null,
            createdByName: candidate.createdBy?.username ?? null,
            consentAt: candidate.consentAt?.toISOString() ?? null,
            dataRetentionUntil: candidate.dataRetentionUntil?.toISOString() ?? null,
            createdAt: candidate.createdAt.toISOString(),
            poolState: candidate.talentPool?.state ?? null,
          }}
          applications={candidate.applications.map((a) => ({
            id: a.id,
            jobId: a.job.id,
            jobTitle: a.job.title,
            stageName: a.stage?.name ?? null,
            status: a.status,
            aiScore: a.aiScore,
            appliedAt: a.appliedAt.toISOString(),
          }))}
          matches={matches.map((m) => ({
            ...m,
            jobStatus: jobStatus.get(m.jobId) ?? "live",
            alreadyApplied: appliedJobIds.has(m.jobId),
          }))}
          notes={candidate.notes.map((n) => ({
            id: n.id,
            bodyMd: n.bodyMd,
            authorName: n.author?.username ?? null,
            createdAt: n.createdAt.toISOString(),
          }))}
          activity={candidate.talentPoolEvents.map((e) => ({
            id: e.id,
            type: e.type,
            fromLabel: e.fromState
              ? (TALENT_POOL_STATE_LABELS[e.fromState as TalentPoolState] ?? e.fromState)
              : null,
            toLabel: e.toState
              ? (TALENT_POOL_STATE_LABELS[e.toState as TalentPoolState] ?? e.toState)
              : null,
            note: e.note,
            actorName: e.actor?.username ?? null,
            occurredAt: e.occurredAt.toISOString(),
          }))}
          hasOpenJobs={openJobs.length > 0}
        />
      </div>
    </>
  );
}
