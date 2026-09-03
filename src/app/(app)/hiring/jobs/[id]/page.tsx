import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getHiringAccess } from "@/lib/hiring/access";
import { can, canReviewJob } from "@/lib/hiring/rbac";
import { serializeJobRow, jobListInclude } from "@/lib/hiring/jobs";
import { validateJobForPublish, formatHiringDate } from "@/lib/hiring/core";
import { Markdown } from "@/components/hiring/Markdown";
import { RefreshBar } from "@/components/hiring/RefreshBar";
import { JobActions } from "./actions";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "applicants", label: "Applicants" },
  { key: "settings", label: "Settings" },
] as const;

export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tab?: string };
}) {
  const { userId, access } = await getHiringAccess();
  if (!userId || !access) redirect("/login");

  const job = await prisma.hiringJob.findFirst({
    where: { id: params.id, deletedAt: null },
    include: {
      ...jobListInclude,
      stages: { orderBy: { position: "asc" } },
      rubrics: { orderBy: { position: "asc" } },
      questions: { orderBy: { position: "asc" } },
    },
  });
  if (!job) notFound();

  // A hiring manager named on this req may review it even without job:read.
  if (!can(access, "job:read") && !canReviewJob(access, job)) {
    return (
      <>
        <TopBar title="Requisition" subtitle="Hiring" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            You do not have access to this requisition.
          </div>
        </div>
      </>
    );
  }

  const row = serializeJobRow(job);
  const tab = TABS.some((t) => t.key === searchParams.tab) ? searchParams.tab! : "overview";
  const readiness = validateJobForPublish({
    title: job.title,
    descriptionMd: job.descriptionMd,
    mustHaves: job.mustHaves,
    rubrics: job.rubrics,
  });

  const [applications, stageCounts] = await Promise.all([
    tab === "applicants"
      ? prisma.hiringApplication.findMany({
          where: { jobId: job.id, deletedAt: null },
          include: {
            candidate: { select: { id: true, fullName: true, email: true, phone: true, source: true } },
            stage: { select: { name: true, kind: true } },
          },
          orderBy: [{ aiScore: "desc" }, { appliedAt: "desc" }],
          take: 500,
        })
      : Promise.resolve([]),
    prisma.hiringApplication.groupBy({
      by: ["stageId"],
      where: { jobId: job.id, deletedAt: null, status: { not: "rejected" } },
      _count: { _all: true },
    }),
  ]);

  const countByStage = new Map(stageCounts.map((c) => [c.stageId, c._count._all]));
  const loadedAt = new Date().toISOString();

  return (
    <>
      <TopBar
        title={job.title}
        subtitle={`${job.department}${row.locationName ? ` · ${row.locationName}` : ""}`}
      />
      <div className="p-margin space-y-lg">
        <div className="flex flex-wrap items-center justify-between gap-md">
          <nav className="flex gap-xs" aria-label="Requisition sections">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={`/hiring/jobs/${job.id}?tab=${t.key}`}
                aria-current={tab === t.key ? "page" : undefined}
                className={
                  "h-8 inline-flex items-center px-md rounded-full text-label-sm border transition " +
                  (tab === t.key
                    ? "bg-primary text-on-primary border-primary"
                    : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low")
                }
              >
                {t.label}
              </Link>
            ))}
          </nav>
          <RefreshBar loadedAt={loadedAt} label={`${row.applicantCount} applicants`} />
        </div>

        <JobActions
          jobId={job.id}
          status={job.status}
          slug={job.slug}
          approvalRequired={job.approvalRequired}
          blockers={readiness.blockers}
          canWrite={can(access, "job:write")}
          canApprove={can(access, "team:manage")}
        />

        {tab === "overview" && (
          <div className="grid gap-lg lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-lg">
              <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
                <h2 className="text-h3 text-on-surface mb-md">Description</h2>
                {job.descriptionMd ? (
                  <Markdown source={job.descriptionMd} />
                ) : (
                  <p className="text-body-sm text-on-surface-variant">
                    No description yet — this req cannot go live without one.
                  </p>
                )}
              </section>

              <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
                <h2 className="text-h3 text-on-surface mb-md">Pipeline</h2>
                {job.stages.length === 0 ? (
                  <p className="text-body-sm text-on-surface-variant">This req has no stages.</p>
                ) : (
                  <ol className="flex flex-wrap gap-xs">
                    {job.stages.map((s) => (
                      <li
                        key={s.id}
                        className="rounded-lg border border-outline-variant px-md py-sm min-w-[7rem]"
                      >
                        <div className="text-label-sm text-on-surface-variant">{s.name}</div>
                        <div className="text-h3 text-on-surface tabular-nums">
                          {countByStage.get(s.id) ?? 0}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>

            <div className="space-y-lg">
              <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-sm">
                <h2 className="text-h3 text-on-surface">At a glance</h2>
                <Row label="Status" value={row.status.replace("_", " ")} />
                <Row label="Openings" value={String(job.openings)} />
                <Row label="Owner" value={row.ownerName ?? "Unassigned"} />
                <Row label="Hiring manager" value={row.hiringManagerName ?? "Nobody named"} />
                <Row label="Compensation" value={row.compLabel ?? "Not stated"} />
                <Row label="Published" value={formatHiringDate(job.publishedAt)} />
                <Row label="Days open" value={row.daysOpen == null ? "—" : String(row.daysOpen)} />
                {row.isAging && (
                  <p className="text-body-sm text-error">
                    Open more than 21 days — this shows in the Aging tab.
                  </p>
                )}
                {job.status === "closed" && job.closeReason && (
                  <Row label="Closed because" value={job.closeReason} />
                )}
              </section>

              <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
                <h2 className="text-h3 text-on-surface mb-sm">Must-haves</h2>
                {job.mustHaves.length === 0 ? (
                  <p className="text-body-sm text-on-surface-variant">
                    None set. Screening has nothing to read without them.
                  </p>
                ) : (
                  <ul className="space-y-xs text-body-md text-on-surface-variant list-disc pl-lg">
                    {job.mustHaves.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
                <h2 className="text-h3 text-on-surface mb-sm">Scoring rubric</h2>
                <ul className="space-y-xs">
                  {job.rubrics.map((r) => (
                    <li key={r.id} className="flex items-center justify-between text-body-md">
                      <span className="text-on-surface-variant">{r.criterion}</span>
                      <span className="text-on-surface tabular-nums">{r.weight}%</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        )}

        {tab === "applicants" && (
          <section className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-x-auto">
            {applications.length === 0 ? (
              <div className="p-xl text-center">
                <div className="text-body-lg text-on-surface mb-xs">No applicants yet</div>
                <p className="text-body-sm text-on-surface-variant max-w-prose mx-auto">
                  {job.status === "live" ? (
                    <>
                      This role is live at{" "}
                      <Link className="text-primary hover:underline" href={`/careers/desma/${job.slug}`}>
                        /careers/desma/{job.slug}
                      </Link>
                      . Applications land here the moment someone applies.
                    </>
                  ) : (
                    "Publish the req to start collecting applications."
                  )}
                </p>
              </div>
            ) : (
              <table className="w-full text-body-md">
                <thead className="text-left border-b border-outline-variant bg-surface-container-low">
                  <tr className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                    <th className="px-lg py-sm">Candidate</th>
                    <th className="px-md py-sm">Stage</th>
                    <th className="px-md py-sm text-right">Score</th>
                    <th className="px-md py-sm">Applied</th>
                    <th className="px-md py-sm">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((a) => (
                    <tr key={a.id} className="border-b border-outline-variant last:border-0">
                      <td className="px-lg py-sm">
                        <div className="text-on-surface font-medium">{a.candidate.fullName}</div>
                        <div className="text-caption text-on-surface-variant">
                          {a.candidate.email ?? a.candidate.phone ?? "no contact on file"}
                        </div>
                        {a.needsAttention && a.screenedOutReason && (
                          <div className="text-caption text-error mt-xs">⚑ {a.screenedOutReason}</div>
                        )}
                      </td>
                      <td className="px-md py-sm text-on-surface-variant">{a.stage?.name ?? "—"}</td>
                      <td className="px-md py-sm text-right tabular-nums">
                        {a.aiScore == null ? "—" : a.aiScore}
                      </td>
                      <td className="px-md py-sm text-on-surface-variant whitespace-nowrap">
                        {formatHiringDate(a.appliedAt)}
                      </td>
                      <td className="px-md py-sm text-on-surface-variant">{a.candidate.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {tab === "settings" && (
          <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-md">
            <h2 className="text-h3 text-on-surface">Application form</h2>
            <Row
              label="Résumé"
              value={
                job.resumeMode === "required"
                  ? "Required — a résumé or a portfolio link"
                  : job.resumeMode === "optional"
                    ? "Asked, but optional"
                    : "Not asked"
              }
            />
            <div>
              <div className="text-label-sm text-on-surface-variant uppercase tracking-wider mb-xs">
                Screening questions
              </div>
              {job.questions.length === 0 ? (
                <p className="text-body-sm text-on-surface-variant">None.</p>
              ) : (
                <ol className="list-decimal pl-lg space-y-xs text-body-md text-on-surface-variant">
                  {job.questions.map((q) => (
                    <li key={q.id}>
                      {q.prompt}
                      <span className="text-caption"> · {q.answerType}{q.required ? " · required" : ""}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <p className="text-caption text-on-surface-variant">
              Editing the form after a req is live changes what NEW applicants are asked; answers
              already collected are kept as they were given.
            </p>
          </section>
        )}
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-md">
      <span className="text-label-sm text-on-surface-variant uppercase tracking-wider">{label}</span>
      <span className="text-body-md text-on-surface text-right">{value}</span>
    </div>
  );
}
