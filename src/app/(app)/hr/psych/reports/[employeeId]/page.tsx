import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { ReportClient } from "./client";
import { archetypes, type ArchetypeKey } from "@/lib/psych-archetypes";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: { params: { employeeId: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Report" />
        <div className="p-margin">
          <Section title="">
            <p className="py-lg text-center text-on-surface-variant">No access.</p>
          </Section>
        </div>
      </>
    );
  }

  const employee = await prisma.employee.findUnique({
    where: { id: params.employeeId },
    select: { id: true, name: true, empCode: true, designation: true, department: true },
  });
  if (!employee) notFound();

  const report = await prisma.psychReport.findFirst({
    where: { employeeId: params.employeeId },
    orderBy: { generatedAt: "desc" },
    include: { assignment: { select: { submittedAt: true, expiresAt: true, assignedAt: true } } },
  });

  if (!report) {
    return (
      <>
        <TopBar
          title={employee.name}
          subtitle={`${employee.empCode} · ${employee.designation ?? "—"}`}
          action={
            <Link href="/hr/psych/assignments" className="text-label-sm underline">
              ← Assignments
            </Link>
          }
        />
        <div className="p-margin">
          <Section title="">
            <p className="py-lg text-center text-on-surface-variant">
              No completed assessment yet.
            </p>
          </Section>
        </div>
      </>
    );
  }

  // Audit-log this admin view.
  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId ?? undefined,
      eventType: "PSYCH_VIEW_REPORT",
      entityType: "PsychReport",
      entityId: report.id,
      metadata: { employeeId: employee.id },
    },
  });

  const archetype = archetypes[report.profileType as ArchetypeKey] ?? null;

  return (
    <ReportClient
      employee={employee}
      report={{
        id: report.id,
        generatedAt: report.generatedAt.toISOString(),
        submittedAt: report.assignment.submittedAt?.toISOString() ?? report.generatedAt.toISOString(),
        oceanRaw: report.oceanRaw as Record<string, number>,
        oceanNormalized: report.oceanNormalized as Record<string, number>,
        oceanPercentile: report.oceanPercentile as Record<string, number>,
        attitudeIndex: report.attitudeIndex,
        attitudeClass: report.attitudeClass,
        profileType: report.profileType,
        profileLabel: report.profileLabel,
        riskFlags: report.riskFlags as Array<{
          code: string;
          label: string;
          severity: string;
          hrAction: string;
        }>,
        recommendations: report.recommendations as string[],
        validityPassed: report.validityPassed,
        validityNotes: report.validityNotes ?? null,
        durationSeconds: report.durationSeconds ?? null,
        suspiciousFlags: report.suspiciousFlags as string[],
      }}
      archetype={archetype}
    />
  );
}
