import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  PARTNER_COOKIE,
  resolvePartnerSession,
  grantedJobIds,
  partnerJobWhere,
  partnerSubmissionWhere,
} from "@/lib/hiring/partner-scope";
import { compBandLabel, formatHiringDate } from "@/lib/hiring/core";
import { SubmitClient } from "./submit-client";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

/**
 * The sourcing-partner portal. A separate, stripped layout on purpose: this is
 * not the Desgro shell with things hidden, it is a different surface that can
 * only ever reach the scoped queries in partner-scope.ts.
 */
export default async function PartnerPortalPage() {
  const partnerId = await resolvePartnerSession(cookies().get(PARTNER_COOKIE)?.value);

  if (!partnerId) {
    return (
      <Shell>
        <h1 className="text-h2 text-on-surface">Sign in from your emailed link</h1>
        <p className="text-body-md text-on-surface-variant">
          The portal is opened by a link we email you. If yours has expired, reply to that email and
          we will send another.
        </p>
      </Shell>
    );
  }

  const partner = await prisma.hiringPartner.findUnique({
    where: { id: partnerId },
    select: { agencyName: true, feePercent: true, focusAreas: true },
  });
  const granted = await grantedJobIds(partnerId);

  // Both queries go through partner-scope; neither takes a caller-supplied
  // filter, so this page cannot ask for anything wider than it is allowed.
  const [jobs, submissions] = await Promise.all([
    prisma.hiringJob.findMany({
      where: partnerJobWhere(granted),
      select: {
        id: true,
        title: true,
        department: true,
        seniority: true,
        compMinLakh: true,
        compMaxLakh: true,
        compVisible: true,
        mustHaves: true,
        location: { select: { name: true } },
      },
      orderBy: { title: "asc" },
    }),
    prisma.hiringPartnerSubmission.findMany({
      where: partnerSubmissionWhere(partnerId, granted),
      select: {
        id: true,
        submittedAt: true,
        placementStatus: true,
        invoiceStatus: true,
        feePercentAtSubmission: true,
        candidate: { select: { fullName: true } },
        job: { select: { title: true } },
        application: { select: { status: true, stage: { select: { name: true } } } },
      },
      orderBy: { submittedAt: "desc" },
    }),
  ]);

  const placed = submissions.filter((s) => s.placementStatus === "placed").length;

  return (
    <Shell>
      <header className="space-y-xs">
        <h1 className="text-h1 text-on-surface">{partner?.agencyName ?? "Sourcing portal"}</h1>
        <p className="text-body-md text-on-surface-variant">
          {jobs.length} {jobs.length === 1 ? "role" : "roles"} open to you ·{" "}
          {submissions.length} submitted · {placed} placed
          {partner?.feePercent != null && ` · fee ${Number(partner.feePercent)}%`}
        </p>
      </header>

      <section className="space-y-sm">
        <h2 className="text-h3 text-on-surface">Roles open to you</h2>
        {jobs.length === 0 ? (
          <Empty>
            No roles have been opened to you yet. We grant access per requisition — when one is
            shared, it appears here with what it needs.
          </Empty>
        ) : (
          <ul className="space-y-sm">
            {jobs.map((j) => (
              <li key={j.id} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-md">
                <div className="flex flex-wrap items-baseline justify-between gap-sm">
                  <span className="text-body-lg font-semibold text-on-surface">{j.title}</span>
                  {j.compVisible && (
                    <span className="text-label-sm text-accent">
                      {compBandLabel(
                        j.compMinLakh == null ? null : Number(j.compMinLakh),
                        j.compMaxLakh == null ? null : Number(j.compMaxLakh),
                      )}
                    </span>
                  )}
                </div>
                <div className="text-body-sm text-on-surface-variant">
                  {j.department}
                  {j.location?.name ? ` · ${j.location.name}` : ""} · {j.seniority}
                </div>
                {j.mustHaves.length > 0 && (
                  <p className="text-caption text-on-surface-variant mt-xs">
                    Must have: {j.mustHaves.join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {jobs.length > 0 && <SubmitClient jobs={jobs.map((j) => ({ id: j.id, title: j.title }))} />}

      <section className="space-y-sm">
        <h2 className="text-h3 text-on-surface">Your submissions</h2>
        {submissions.length === 0 ? (
          <Empty>Nothing submitted yet. Use the form above to put a candidate forward.</Empty>
        ) : (
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-x-auto">
            <table className="w-full text-body-md">
              <thead className="text-left border-b border-outline-variant bg-surface-container-low">
                <tr className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                  <th className="px-lg py-sm">Candidate</th>
                  <th className="px-md py-sm">Role</th>
                  <th className="px-md py-sm">Stage</th>
                  <th className="px-md py-sm">Submitted</th>
                  <th className="px-md py-sm">Fee</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((s) => (
                  <tr key={s.id} className="border-b border-outline-variant last:border-0">
                    <td className="px-lg py-sm text-on-surface">{s.candidate.fullName}</td>
                    <td className="px-md py-sm text-on-surface-variant">{s.job.title}</td>
                    <td className="px-md py-sm text-on-surface-variant">
                      {s.application?.stage?.name ?? "Received"}
                      {s.application?.status === "rejected" && " · not progressing"}
                    </td>
                    <td className="px-md py-sm text-on-surface-variant whitespace-nowrap">
                      {formatHiringDate(s.submittedAt)}
                    </td>
                    <td className="px-md py-sm text-on-surface-variant">
                      {s.placementStatus === "placed"
                        ? `${s.feePercentAtSubmission == null ? "" : Number(s.feePercentAtSubmission) + "% · "}${s.invoiceStatus}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-caption text-on-surface-variant">
          The fee percentage is the one agreed when the candidate was submitted, and it does not
          change if the rate changes later. Fees become payable on offer acceptance.
        </p>
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-outline-variant bg-surface-container-lowest">
        <div className="mx-auto max-w-4xl px-md sm:px-lg py-md">
          <span className="text-h3 font-extrabold text-on-surface">DESMA International</span>
          <span className="ml-sm text-label-sm text-on-surface-variant">Sourcing partners</span>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-md sm:px-lg py-xl space-y-xl">{children}</main>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest p-lg text-body-sm text-on-surface-variant">
      {children}
    </div>
  );
}
