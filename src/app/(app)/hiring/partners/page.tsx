import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getHiringAccess } from "@/lib/hiring/access";
import { can } from "@/lib/hiring/rbac";
import { PartnersClient } from "./client";

export const dynamic = "force-dynamic";

export default async function PartnersPage() {
  const { userId, access } = await getHiringAccess();
  if (!userId || !access) redirect("/login");

  if (!can(access, "sourcing:manage")) {
    return (
      <>
        <TopBar title="Sourcing partners" subtitle="Hiring" />
        <div className="p-margin">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-on-surface-variant">
            Sourcing partners carry fees, so they are kept to the Owner and HR Manager tiers.
          </div>
        </div>
      </>
    );
  }

  const [partners, jobs] = await Promise.all([
    prisma.hiringPartner.findMany({
      include: {
        jobAccess: { select: { jobId: true } },
        submissions: {
          select: {
            placementStatus: true,
            submittedAt: true,
            application: { select: { status: true, hiredAt: true } },
          },
        },
      },
      orderBy: [{ status: "asc" }, { agencyName: "asc" }],
    }),
    prisma.hiringJob.findMany({
      where: { deletedAt: null, status: { in: ["live", "paused"] } },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    }),
  ]);

  const rows = partners.map((p) => {
    const submitted = p.submissions.length;
    const placed = p.submissions.filter((s) => s.placementStatus === "placed").length;
    const inPipeline = p.submissions.filter((s) => s.application?.status === "active").length;
    // Average days from submission to hire, over placements only.
    const spans = p.submissions
      .filter((s) => s.application?.hiredAt)
      .map((s) => (s.application!.hiredAt!.getTime() - s.submittedAt.getTime()) / 86_400_000);
    return {
      id: p.id,
      agencyName: p.agencyName,
      primaryContactName: p.primaryContactName,
      contactEmail: p.contactEmail,
      focusAreas: p.focusAreas,
      feePercent: p.feePercent == null ? null : Number(p.feePercent),
      status: p.status,
      grantedJobIds: p.jobAccess.map((a) => a.jobId),
      submitted,
      inPipeline,
      placed,
      fillRate: submitted === 0 ? null : Math.round((placed / submitted) * 100),
      avgDays: spans.length ? Math.round(spans.reduce((a, b) => a + b, 0) / spans.length) : null,
    };
  });

  return (
    <>
      <TopBar title="Sourcing partners" subtitle="External recruiters, scoped to the reqs you grant" />
      <div className="p-margin">
        <PartnersClient partners={rows} jobs={jobs} loadedAt={new Date().toISOString()} />
      </div>
    </>
  );
}
