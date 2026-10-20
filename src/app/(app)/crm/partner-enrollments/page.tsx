import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TopBar } from "@/components/TopBar";
import { todayIst } from "@/lib/lead-pulse-dates";
import { ENROLLMENT_INCLUDE, getAccess, serializeEnrollment } from "@/lib/partner-commissions/server";
import { PartnerEnrollmentsClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * Partner Enrollments — the narrow page for people who may only ADD
 * enrollments: every active BDE (GCAN by default) and anyone Finance has given
 * a personal grant (e.g. OSCE/NCLEX). They see the enrollments they added and
 * the fee status Finance records; invoices and money stay on the Finance page.
 */
export default async function PartnerEnrollmentsPage() {
  const access = await getAccess();
  if (!access) redirect("/login");

  const [programs, mine] = await Promise.all([
    prisma.commissionProgram.findMany({ where: { code: { in: access.programs }, isActive: true }, include: { partner: true } }),
    prisma.commissionEnrollment.findMany({ where: { createdById: access.userId }, include: ENROLLMENT_INCLUDE, orderBy: { createdAt: "desc" } }),
  ]);

  return (
    <>
      <TopBar title="Partner Enrollments" subtitle={access.programs.length ? access.programs.join(" · ") : undefined} />
      <PartnerEnrollmentsClient
        today={todayIst()}
        allowed={access.programs}
        isFinance={access.isFinance}
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
        enrollments={mine.map(serializeEnrollment)}
      />
    </>
  );
}
