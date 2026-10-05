import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { deriveBreakdown, suggestProfessionalTax, isTraineeDesignation, effectiveDesignation } from "@/lib/hr-salary-engine";
import { SalaryStructuresClient } from "./client";

export const dynamic = "force-dynamic";

export default async function SalaryStructuresPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Salary Structures" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">No access.</div>
          </Section>
        </div>
      </>
    );
  }

  const now = new Date();
  const todayDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [employees, activePf] = await Promise.all([
    prisma.employee.findMany({
      where: { active: true },
      orderBy: { empCode: "asc" },
      include: {
        designationRef: true,
        salaryStructures: { orderBy: { effectiveFrom: "desc" }, take: 1 },
      },
    }),
    // Statutory PF rule in force today — this page previews CURRENT monthly
    // figures, so it uses today's ceiling/rates (payroll itself resolves the
    // rule per salary-period date).
    prisma.hrPfRule.findFirst({
      where: {
        effectiveFrom: { lte: todayDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: todayDate } }],
      },
      orderBy: { effectiveFrom: "desc" },
    }),
  ]);
  const pfCeil = activePf ? Number(activePf.wageCeiling) : 15000;
  const pfEeRate = (activePf ? Number(activePf.employeeRatePct) : 12) / 100;
  const pfErRate = (activePf ? Number(activePf.employerRatePct) : 12) / 100;

  const rows = employees.map((e) => {
    const cur = e.salaryStructures[0];
    // Trainees are paid on basic only — mirror the engine override so the
    // planning view's money columns match the actual payout.
    const isTrainee =
      isTraineeDesignation(effectiveDesignation(e));
    if (!cur) {
      return {
        id: e.id,
        empCode: e.empCode,
        name: e.name,
        designation: e.designation,
        effectiveFrom: null as string | null,
        basic: 0,
        hraPct: 40,
        conveyancePct: 20,
        medicalPct: 25,
        specialPct: 15,
        gross: 0,
        esiApplicable: true,
        pfApplicable: true,
        professionalTax: 125,
        esiEmployee: 0,
        pfEmployee: 0,
        esiEmployer: 0,
        pfEmployer: 0,
        netTakeHome: 0,
        ctc: 0,
        hasStructure: false,
      };
    }
    const basic = Number(cur.basic);
    const breakdown = deriveBreakdown(basic, {
      hraPct: isTrainee ? 0 : Number(cur.hraPct),
      conveyancePct: isTrainee ? 0 : Number(cur.conveyancePct),
      medicalPct: isTrainee ? 0 : Number(cur.medicalPct),
      specialPct: isTrainee ? 0 : Number(cur.specialPct),
    });
    const esiApplicable = !isTrainee && cur.esiApplicable;
    const pfApplicable = !isTrainee && cur.pfApplicable;
    const esiEmp = esiApplicable ? Math.round(breakdown.gross * 0.0075) : 0;
    // PF under the statutory rule active today; "actual"-basis members
    // contribute on full PF wages (never auto-capped), VPF is employee-only.
    const pfBase = cur.pfBasis === "actual" ? basic : Math.min(basic, pfCeil);
    const vpfPct = cur.pfVoluntaryPct == null ? 0 : Number(cur.pfVoluntaryPct);
    const pfEmp = pfApplicable
      ? Math.round(pfBase * pfEeRate) + (vpfPct > 0 ? Math.round((pfBase * vpfPct) / 100) : 0)
      : 0;
    // Employer-side contributions
    const esiEmployer = esiApplicable ? Math.round(breakdown.gross * 0.0375) : 0;
    const pfEmployer = pfApplicable ? Math.round(pfBase * pfErRate) : 0;
    const professionalTax = isTrainee ? 0 : Number(cur.professionalTax);
    return {
      id: e.id,
      empCode: e.empCode,
      name: e.name,
      designation: e.designation,
      effectiveFrom: cur.effectiveFrom.toISOString().slice(0, 10),
      basic,
      hraPct: isTrainee ? 0 : Number(cur.hraPct),
      conveyancePct: isTrainee ? 0 : Number(cur.conveyancePct),
      medicalPct: isTrainee ? 0 : Number(cur.medicalPct),
      specialPct: isTrainee ? 0 : Number(cur.specialPct),
      gross: breakdown.gross,
      esiApplicable,
      pfApplicable,
      professionalTax,
      esiEmployee: esiEmp,
      pfEmployee: pfEmp,
      esiEmployer,
      pfEmployer,
      netTakeHome: breakdown.gross - esiEmp - pfEmp - professionalTax,
      ctc: breakdown.gross + pfEmployer + esiEmployer,
      hasStructure: true,
    };
  });

  const totalGross = rows.reduce((s, r) => s + r.gross, 0);
  const totalNet = rows.reduce((s, r) => s + r.netTakeHome, 0);
  const totalCtc = rows.reduce((s, r) => s + r.ctc, 0);
  const missing = rows.filter((r) => !r.hasStructure).length;

  return (
    <>
      <TopBar
        title="Salary Structures"
        subtitle={`${rows.length} active employees · Gross ₹${Math.round(totalGross).toLocaleString("en-IN")} · Net ₹${Math.round(totalNet).toLocaleString("en-IN")} · CTC ₹${Math.round(totalCtc).toLocaleString("en-IN")}${missing ? ` · ${missing} missing` : ""}`}
      />
      <div className="p-margin">
        <SalaryStructuresClient rows={rows} canEdit={canApproveHr(perms)} />
      </div>
    </>
  );
}
