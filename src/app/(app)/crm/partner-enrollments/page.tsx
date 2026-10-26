import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TopBar } from "@/components/TopBar";
import { todayIst } from "@/lib/lead-pulse-dates";
import { canTrackEnrollment } from "@/lib/partner-commissions/logic";
import { ENROLLMENT_INCLUDE, getAccess, getSettings, serializeEnrollment, trackableWhere } from "@/lib/partner-commissions/server";
import { PartnerEnrollmentsClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * Partner Enrollments — where the people who enroll candidates (every active
 * BDE for GCAN by default, and anyone with a personal grant, e.g. the OSCE/NCLEX
 * coordinator) add enrollments and record each course-fee installment as it is
 * paid. Finance invoices fully paid enrollments from its own page.
 *
 * Lists what this person may track: a coordinator sees every enrollment in their
 * programs; a BDE sees the ones they added and those whose CRM lead is assigned
 * to them.
 */
export default async function PartnerEnrollmentsPage() {
  const access = await getAccess();
  if (!access) redirect("/login");

  const [programs, rows, settings] = await Promise.all([
    prisma.commissionProgram.findMany({ where: { code: { in: access.programs }, isActive: true }, include: { partner: true } }),
    prisma.commissionEnrollment.findMany({ where: trackableWhere(access), include: ENROLLMENT_INCLUDE, orderBy: { createdAt: "desc" }, take: 1000 }),
    getSettings(),
  ]);

  return (
    <>
      <TopBar title="Partner Enrollments" subtitle={access.programs.length ? access.programs.join(" · ") : undefined} />
      <PartnerEnrollmentsClient
        today={todayIst()}
        userId={access.userId}
        allowed={access.programs}
        isFinance={access.isFinance}
        runDay={settings.runDay}
        programs={programs
          .filter((p) => p.partner.isActive)
          .map((p) => ({
            code: p.code,
            partnerName: p.partner.name,
            courseName: p.courseName,
            defaultFee: p.defaultFee == null ? null : Number(p.defaultFee),
            defaultPct: p.defaultPct == null ? null : Number(p.defaultPct),
            layout: p.partner.layout,
          }))}
        enrollments={rows.map((e) => ({
          ...serializeEnrollment(e),
          canRecord: canTrackEnrollment(access, { program: e.program, createdById: e.createdById, leadAssignedToId: e.lead?.assignedToId ?? null }),
        }))}
      />
    </>
  );
}
