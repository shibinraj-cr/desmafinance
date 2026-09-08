import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getHiringAccess } from "@/lib/hiring/access";
import { can } from "@/lib/hiring/rbac";
import {
  buildFunnel,
  timeToHire,
  timeInStage,
  offerOutcomes,
  type AnalyticsEvent,
  type StageKey,
} from "@/lib/hiring/analytics";
import { agingCutoff } from "@/lib/hiring/jobs";
import { CANDIDATE_SOURCE_LABELS, type CandidateSource } from "@/lib/hiring/constants";
import { AnalyticsClient } from "./client";

export const dynamic = "force-dynamic";

/** Default window: the last 90 days, in whole IST days. */
function defaultRange(): { from: Date; to: Date } {
  const to = new Date();
  return { from: new Date(to.getTime() - 90 * 86_400_000), to };
}

export default async function HiringAnalyticsPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; tab?: string };
}) {
  const { userId, access } = await getHiringAccess();
  if (!userId || !access) redirect("/login");

  if (!can(access, "analytics:read")) {
    return (
      <>
        <TopBar title="Analytics" subtitle="Hiring" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            Hiring analytics are visible to the hiring team.
          </div>
        </div>
      </>
    );
  }

  const fallback = defaultRange();
  const from = searchParams.from ? new Date(`${searchParams.from}T00:00:00+05:30`) : fallback.from;
  const to = searchParams.to ? new Date(`${searchParams.to}T23:59:59+05:30`) : fallback.to;
  const tab = ["funnel", "sources", "partners", "custom"].includes(searchParams.tab ?? "")
    ? searchParams.tab!
    : "funnel";

  const [events, stages, wonStages, applications, partners, agingJobs] = await Promise.all([
    // EVERY number on the Funnel tab comes from these rows and nothing else.
    prisma.hiringApplicationEvent.findMany({
      where: { occurredAt: { gte: from, lte: to } },
      select: { applicationId: true, type: true, fromStage: true, toStage: true, occurredAt: true },
      orderBy: { occurredAt: "asc" },
      take: 20_000,
    }),
    prisma.hiringJobStage.findMany({
      where: { job: { deletedAt: null } },
      select: { name: true, kind: true, position: true },
    }),
    prisma.hiringJobStage.findMany({
      where: { kind: "won", job: { deletedAt: null } },
      select: { name: true },
    }),
    prisma.hiringApplication.findMany({
      where: { deletedAt: null, appliedAt: { gte: from, lte: to } },
      select: {
        status: true,
        candidate: { select: { source: true } },
      },
      take: 5000,
    }),
    prisma.hiringPartner.findMany({
      include: {
        submissions: {
          where: { submittedAt: { gte: from, lte: to } },
          select: {
            placementStatus: true,
            feePercentAtSubmission: true,
            application: {
              select: {
                status: true,
                offers: { where: { status: "accepted" }, select: { baseLakh: true } },
              },
            },
          },
        },
      },
    }),
    prisma.hiringJob.count({
      where: { status: "live", deletedAt: null, publishedAt: { lt: agingCutoff() } },
    }),
  ]);

  // Stage labels are per job, so the same label can appear at several
  // positions. Analytics group by position, and the label with the lowest
  // position wins as its canonical home.
  const byLabel = new Map<string, StageKey>();
  for (const s of stages) {
    const key = s.name.trim().toLowerCase();
    const existing = byLabel.get(key);
    if (!existing || s.position < existing.position) {
      byLabel.set(key, { position: s.position, kind: s.kind, label: s.name });
    }
  }
  const stageKeys = [...byLabel.values()];

  const analyticsEvents: AnalyticsEvent[] = events.map((e) => ({
    applicationId: e.applicationId,
    type: e.type,
    fromStage: e.fromStage,
    toStage: e.toStage,
    occurredAt: e.occurredAt,
  }));

  const sources = new Map<string, { applications: number; hires: number }>();
  for (const a of applications) {
    const key = a.candidate.source;
    if (!sources.has(key)) sources.set(key, { applications: 0, hires: 0 });
    const bucket = sources.get(key)!;
    bucket.applications++;
    if (a.status === "hired") bucket.hires++;
  }

  return (
    <>
      <TopBar title="Analytics" subtitle="Every figure computed from the activity log" />
      <div className="p-margin">
        <AnalyticsClient
          tab={tab}
          from={toIsoDay(from)}
          to={toIsoDay(to)}
          eventCount={events.length}
          funnel={buildFunnel(analyticsEvents, stageKeys)}
          timeToHire={timeToHire(analyticsEvents, new Set(wonStages.map((s) => s.name)))}
          timeInStage={timeInStage(analyticsEvents).slice(0, 8)}
          offers={offerOutcomes(analyticsEvents)}
          agingJobs={agingJobs}
          sources={[...sources.entries()]
            .map(([key, v]) => ({
              key,
              label: CANDIDATE_SOURCE_LABELS[key as CandidateSource] ?? key,
              ...v,
              hireRatePct: v.applications === 0 ? null : Math.round((v.hires / v.applications) * 100),
            }))
            .sort((a, b) => b.applications - a.applications)}
          partners={partners
            .map((p) => {
              const submitted = p.submissions.length;
              const placed = p.submissions.filter((s) => s.placementStatus === "placed").length;
              // Fee is the agreed percentage of the placed candidate's base.
              const fees = p.submissions.reduce((sum, s) => {
                const base = s.application?.offers[0]?.baseLakh;
                if (!base || s.placementStatus !== "placed") return sum;
                return sum + (Number(base) * Number(s.feePercentAtSubmission ?? 0)) / 100;
              }, 0);
              return {
                id: p.id,
                agencyName: p.agencyName,
                submitted,
                placed,
                fillRatePct: submitted === 0 ? null : Math.round((placed / submitted) * 100),
                feesLakh: Math.round(fees * 100) / 100,
                costPerHireLakh: placed === 0 ? null : Math.round((fees / placed) * 100) / 100,
              };
            })
            .filter((p) => p.submitted > 0)
            .sort((a, b) => b.placed - a.placed)}
          loadedAt={new Date().toISOString()}
        />
      </div>
    </>
  );
}

function toIsoDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
