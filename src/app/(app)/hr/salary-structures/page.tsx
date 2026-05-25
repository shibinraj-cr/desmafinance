import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { deriveBreakdown, suggestProfessionalTax } from "@/lib/hr-salary-engine";
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

  const employees = await prisma.employee.findMany({
    where: { active: true },
    orderBy: { empCode: "asc" },
    include: {
      salaryStructures: { orderBy: { effectiveFrom: "desc" }, take: 1 },
    },
  });

  const rows = employees.map((e) => {
    const cur = e.salaryStructures[0];
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
      hraPct: Number(cur.hraPct),
      conveyancePct: Number(cur.conveyancePct),
      medicalPct: Number(cur.medicalPct),
      specialPct: Number(cur.specialPct),
    });
    const esiEmp = cur.esiApplicable ? Math.round(breakdown.gross * 0.0075) : 0;
    // PF capped at ₹15,000 wage ceiling → max ₹1,800.
    const pfEmp = cur.pfApplicable ? Math.round(Math.min(basic, 15000) * 0.12) : 0;
    // Employer-side contributions
    const esiEmployer = cur.esiApplicable ? Math.round(breakdown.gross * 0.0375) : 0;
    const pfEmployer = cur.pfApplicable ? Math.round(Math.min(basic, 15000) * 0.12) : 0;
    return {
      id: e.id,
      empCode: e.empCode,
      name: e.name,
      designation: e.designation,
      effectiveFrom: cur.effectiveFrom.toISOString().slice(0, 10),
      basic,
      hraPct: Number(cur.hraPct),
      conveyancePct: Number(cur.conveyancePct),
      medicalPct: Number(cur.medicalPct),
      specialPct: Number(cur.specialPct),
      gross: breakdown.gross,
      esiApplicable: cur.esiApplicable,
      pfApplicable: cur.pfApplicable,
      professionalTax: Number(cur.professionalTax),
      esiEmployee: esiEmp,
      pfEmployee: pfEmp,
      esiEmployer,
      pfEmployer,
      netTakeHome: breakdown.gross - esiEmp - pfEmp - Number(cur.professionalTax),
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
