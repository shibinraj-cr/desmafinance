import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { pfRuleStatus, toPfRule } from "@/lib/hr-pf";
import { StatutorySettingsClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * HR → Payroll → Statutory Settings → Provident Fund.
 *
 * Shows the effective-dated PF rule master the payroll engine selects from
 * by salary-period date. Future EPFO amendments are added HERE as a new
 * rule — never as a code change — and rules that have governed a payroll run
 * are immutable.
 */
export default async function StatutorySettingsPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Statutory Settings" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">No access.</div>
          </Section>
        </div>
      </>
    );
  }

  const rows = await prisma.hrPfRule.findMany({ orderBy: { effectiveFrom: "desc" } });
  const today = new Date();
  const rules = rows.map((r) => {
    const rule = toPfRule(r);
    return {
      id: r.id,
      code: r.code,
      wageCeiling: Number(r.wageCeiling),
      employeeRatePct: Number(r.employeeRatePct),
      employerRatePct: Number(r.employerRatePct),
      epsRatePct: Number(r.epsRatePct),
      epsApplicable: r.epsApplicable,
      higherWageAllowed: r.higherWageAllowed,
      effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
      effectiveTo: r.effectiveTo ? r.effectiveTo.toISOString().slice(0, 10) : null,
      notes: r.notes,
      status: pfRuleStatus(rule, today),
    };
  });

  return (
    <>
      <TopBar
        title="Statutory Settings · Provident Fund"
        subtitle="Effective-dated EPFO rules — payroll picks the rule by salary-period date"
      />
      <div className="p-margin">
        <StatutorySettingsClient rules={rules} canEdit={canApproveHr(perms)} />
      </div>
    </>
  );
}
