import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getHiringAccess } from "@/lib/hiring/access";
import { can } from "@/lib/hiring/rbac";
import {
  interviewInclude,
  serializeInterview,
  computeInterviewKpis,
  calendarToken,
  istDayBounds,
} from "@/lib/hiring/interviews";
import { isAiEnabled } from "@/lib/anthropic";
import { InterviewsClient } from "./client";

export const dynamic = "force-dynamic";

export default async function HiringInterviewsPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const { userId, access } = await getHiringAccess();
  if (!userId || !access) redirect("/login");

  if (!can(access, "interview:manage")) {
    return (
      <>
        <TopBar title="Interviews" subtitle="Hiring" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            Interview scheduling is available to recruiters and the hiring team. If you are on a
            panel, your interviews are on your calendar feed and your scorecard is on the
            candidate&rsquo;s drawer.
          </div>
        </div>
      </>
    );
  }

  const tab = ["schedule", "awaiting", "transcripts", "templates"].includes(searchParams.tab ?? "")
    ? searchParams.tab!
    : "schedule";

  const { start } = istDayBounds();

  const [rows, kpis, templates, users, openApplications] = await Promise.all([
    prisma.hiringInterview.findMany({
      where:
        tab === "awaiting"
          ? { status: "completed", scorecards: { none: {} } }
          : tab === "transcripts"
            ? { OR: [{ recordingUrl: { not: null } }, { transcriptText: { not: null } }] }
            : // The schedule shows from the start of today forward, plus anything
              // still marked scheduled in the past — an interview nobody closed
              // out is exactly what a scheduling view should keep showing.
              { OR: [{ scheduledAt: { gte: start } }, { status: "scheduled" }] },
      include: interviewInclude,
      orderBy: { scheduledAt: tab === "schedule" ? "asc" : "desc" },
      take: 300,
    }),
    computeInterviewKpis(),
    prisma.hiringInterviewTemplate.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, username: true },
      orderBy: { username: "asc" },
    }),
    // Candidates who can actually be booked: still in play, on a live req.
    prisma.hiringApplication.findMany({
      where: { deletedAt: null, status: "active", job: { status: { in: ["live", "paused"] }, deletedAt: null } },
      select: {
        id: true,
        candidate: { select: { fullName: true } },
        job: { select: { title: true } },
        stage: { select: { name: true } },
      },
      orderBy: { aiScore: "desc" },
      take: 300,
    }),
  ]);

  return (
    <>
      <TopBar title="Interviews" subtitle="Scheduling, scorecards, prep packets" />
      <div className="p-margin">
        <InterviewsClient
          tab={tab}
          interviews={rows.map((r) => serializeInterview(r))}
          kpis={kpis}
          templates={templates.map((t) => ({
            id: t.id,
            name: t.name,
            kind: t.kind,
            durationMin: t.durationMin,
            questionSet: Array.isArray(t.questionSet) ? (t.questionSet as string[]) : [],
            isDefaultForStage: t.isDefaultForStage,
          }))}
          users={users}
          bookable={openApplications.map((a) => ({
            id: a.id,
            label: `${a.candidate.fullName} · ${a.job.title}${a.stage ? ` · ${a.stage.name}` : ""}`,
          }))}
          calendarUrl={`/api/hiring/calendar/${userId}/${calendarToken(userId)}`}
          aiEnabled={isAiEnabled()}
          currentUserId={userId}
          loadedAt={new Date().toISOString()}
        />
      </div>
    </>
  );
}
