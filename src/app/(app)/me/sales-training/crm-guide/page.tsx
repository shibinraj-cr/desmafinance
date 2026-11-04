import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { getCrmAccess } from "@/lib/crm-rbac";
import { isHrUser } from "@/lib/hr-rbac";
import { employeeForUser } from "@/lib/hr-me";
import { todayIst } from "@/lib/lead-pulse-dates";
import { TopBar } from "@/components/TopBar";
import { NoAccess } from "@/components/sales-training/ui";
import { CrmGuide } from "@/components/crm-guide/CrmGuide";
import { activeLearner } from "@/lib/sales-training-db";
import { CRM_GUIDE_MODULE_ID, changesFor, crmGuideSections, visibleSections } from "@/lib/crm-guide";
import { loadCrmGuideFacts } from "@/lib/crm-guide-data";

export const dynamic = "force-dynamic";

/**
 * The BDE's CRM guide. Open to every CRM user — not only enrolled learners —
 * and trimmed to the pages this viewer can actually use.
 */
export default async function MyCrmGuidePage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads && !isHrUser(perms)) return <NoAccess title="CRM Guide" />;

  const canSee = (href: string) => canSeePage(perms, href);
  const [facts, emp] = await Promise.all([loadCrmGuideFacts(), employeeForUser(userId)]);
  const sections = visibleSections(crmGuideSections(facts, canSee), canSee);

  const learner = emp ? await activeLearner(emp.id) : null;
  const mod = learner
    ? await prisma.salesTrainingModule.findUnique({ where: { id: CRM_GUIDE_MODULE_ID }, select: { status: true, title: true } })
    : null;

  return (
    <>
      <TopBar title="CRM Guide" subtitle="Sales Consultant Training & Development" />
      <div className="p-margin">
        <CrmGuide
          sections={sections}
          changes={changesFor(sections)}
          today={todayIst()}
          quiz={
            mod?.status === "published"
              ? { href: `/me/sales-training/${CRM_GUIDE_MODULE_ID}`, label: `take the “${mod.title}” quiz when you've read the guide.` }
              : null
          }
        />
      </div>
    </>
  );
}
