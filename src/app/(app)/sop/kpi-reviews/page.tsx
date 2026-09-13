import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TopBar } from "@/components/TopBar";
import { loadSopAccess } from "@/lib/sop/access";
import { visibleSopWhere } from "@/lib/sop/queries";
import { NoAccess } from "../_no-access";
import { KpiReviewsClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * KPI Reviews (§9) — record performance against published SOPs.
 *
 * Scoped to the PUBLISHED version of each SOP. Measuring a draft would produce
 * a number attached to a document nobody is following, and the whole point of
 * recording an actual is that it describes the process as it was actually run.
 */
export default async function SopKpiReviewsPage() {
  const access = await loadSopAccess();
  if (!access) redirect("/login");

  const canRecordAny = access.isSopAdmin || !!access.employeeId;
  if (!canRecordAny) {
    return (
      <NoAccess
        title="KPI Reviews"
        message="Recording KPI results needs an employee record linked to your login, because results are attributed to the KPI or process owner."
        cta={{ href: "/sop/library", label: "Go to the SOP Library" }}
      />
    );
  }

  // Only KPIs on the live version of an SOP the viewer can see, and — unless
  // they are a SOP admin — only ones they are actually responsible for.
  const kpis = await prisma.sopKpi.findMany({
    where: {
      version: { currentOf: { is: visibleSopWhere(access) } },
      // A non-admin sees only the KPIs they are answerable for: ones they own
      // directly, and ones on an SOP they are the process owner of. The
      // sentinel keeps the clause well-typed for a login with no employee
      // record — it simply matches nothing.
      ...(access.isSopAdmin
        ? {}
        : {
            OR: [
              { kpiOwnerEmployeeId: access.employeeId ?? "__none__" },
              { version: { is: { ownerEmployeeId: access.employeeId ?? "__none__" } } },
            ],
          }),
    },
    orderBy: [{ version: { sop: { sopNumber: "asc" } } }, { seq: "asc" }],
    include: {
      kpiOwnerEmployee: { select: { name: true } },
      version: {
        select: {
          id: true,
          versionLabel: true,
          ownerEmployee: { select: { name: true } },
          sop: {
            select: { id: true, sopNumber: true, title: true, department: { select: { name: true } } },
          },
        },
      },
      reviews: {
        orderBy: { periodEnd: "desc" },
        take: 6,
        include: { reviewedBy: { select: { username: true } } },
      },
    },
    take: 300,
  });

  return (
    <>
      <TopBar title="KPI Reviews" subtitle="Record performance against published SOPs" />
      <div className="p-margin">
        <KpiReviewsClient
          rows={kpis.map((k) => ({
            id: k.id,
            seq: k.seq,
            name: k.name,
            description: k.description,
            target: k.target,
            unit: k.unit,
            measurementMethod: k.measurementMethod,
            dataSource: k.dataSource,
            reviewFrequency: k.reviewFrequency,
            kpiOwnerEmployeeId: k.kpiOwnerEmployeeId,
            kpiOwner: k.kpiOwnerEmployee?.name ?? k.version.ownerEmployee?.name ?? null,
            latestActual: k.latestActual,
            latestStatus: k.latestStatus,
            latestReviewedAt: k.latestReviewedAt?.toISOString() ?? null,
            sopId: k.version.sop.id,
            sopNumber: k.version.sop.sopNumber,
            sopTitle: k.version.sop.title,
            department: k.version.sop.department?.name ?? null,
            versionLabel: k.version.versionLabel,
            reviews: k.reviews.map((r) => ({
              id: r.id,
              periodStart: r.periodStart.toISOString().slice(0, 10),
              periodEnd: r.periodEnd.toISOString().slice(0, 10),
              actual: r.actual,
              status: r.status,
              notes: r.notes,
              reviewedBy: r.reviewedBy?.username ?? null,
              reviewedAt: r.reviewedAt.toISOString(),
            })),
          }))}
        />
      </div>
    </>
  );
}
