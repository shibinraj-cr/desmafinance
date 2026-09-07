import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getHiringAccess } from "@/lib/hiring/access";
import { can } from "@/lib/hiring/rbac";
import { getCreditsState, FEATURE_COSTS } from "@/lib/hiring/ai/credits";
import { isAiEnabled } from "@/lib/anthropic";
import { IngestClient } from "./client";

export const dynamic = "force-dynamic";

export default async function ResumeIngestPage({
  searchParams,
}: {
  searchParams: { batch?: string };
}) {
  const { userId, access } = await getHiringAccess();
  if (!userId || !access) redirect("/login");

  if (!can(access, "candidate:write")) {
    return (
      <>
        <TopBar title="Import résumés" subtitle="Hiring" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            Importing résumés creates candidate records, so it is available to the hiring team.
          </div>
        </div>
      </>
    );
  }

  const [jobs, batches, credits] = await Promise.all([
    prisma.hiringJob.findMany({
      where: { deletedAt: null, status: { in: ["live", "paused"] } },
      select: { id: true, title: true, department: true },
      orderBy: { title: "asc" },
    }),
    prisma.hiringIngestBatch.findMany({
      include: { job: { select: { title: true } }, createdBy: { select: { username: true } } },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
    getCreditsState(),
  ]);

  return (
    <>
      <TopBar
        title="Import résumés"
        subtitle="Read a folder of CVs into candidate profiles — without putting anyone in the funnel"
      />
      <div className="p-margin">
        <IngestClient
          jobs={jobs}
          batches={batches.map((b) => ({
            id: b.id,
            jobTitle: b.job.title,
            origin: b.origin,
            status: b.status,
            fileCount: b.fileCount,
            parsedCount: b.parsedCount,
            skippedCount: b.skippedCount,
            failedCount: b.failedCount,
            createdByName: b.createdBy?.username ?? null,
            createdAt: b.createdAt.toISOString(),
          }))}
          openBatchId={searchParams.batch ?? null}
          aiEnabled={isAiEnabled()}
          creditsRemaining={credits.remaining}
          parseCost={FEATURE_COSTS.resume_parse}
          scoreCost={FEATURE_COSTS.rubric_score}
          loadedAt={new Date().toISOString()}
        />
      </div>
    </>
  );
}
