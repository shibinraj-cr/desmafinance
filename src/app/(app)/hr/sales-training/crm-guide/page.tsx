import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr, isHrUser } from "@/lib/hr-rbac";
import { todayIst } from "@/lib/lead-pulse-dates";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { NoAccess, PublishPill } from "@/components/sales-training/ui";
import { CrmGuide } from "@/components/crm-guide/CrmGuide";
import { CRM_GUIDE_MODULE_ID, changesFor, crmGuideQuiz, crmGuideSections } from "@/lib/crm-guide";
import { loadCrmGuideFacts, syncCrmGuideQuiz } from "@/lib/crm-guide-data";
import { CreateGuideModuleButton } from "./client";

export const dynamic = "force-dynamic";

/** HR's copy of the CRM guide: every section, plus its knowledge-check module. */
export default async function HrCrmGuidePage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) return <NoAccess title="CRM Guide" />;

  const facts = await loadCrmGuideFacts();
  await syncCrmGuideQuiz(facts);
  const mod = await prisma.salesTrainingModule.findUnique({
    where: { id: CRM_GUIDE_MODULE_ID },
    select: { status: true, title: true, _count: { select: { questions: true } } },
  });
  const sections = crmGuideSections(facts);

  return (
    <>
      <TopBar title="CRM Guide" subtitle="How to use the CRM — for BDEs" />
      <div className="p-margin space-y-lg">
        <Section title="Training module">
          {mod ? (
            <div className="flex flex-col sm:flex-row sm:items-center gap-md">
              <div className="flex-1 text-body-md text-on-surface-variant">
                <p className="flex items-center gap-sm flex-wrap">
                  <span className="font-semibold text-on-surface">{mod.title}</span>
                  <PublishPill status={mod.status} />
                </p>
                <p className="mt-xs">
                  {mod._count.questions} questions, written from this guide and kept in step with it automatically.
                  {mod.status === "published"
                    ? " Enrolled learners see it in their Sales Training modules."
                    : " Publish it from the module page when you want enrolled learners to take it."}
                </p>
              </div>
              <Link
                href={`/hr/sales-training/modules/${CRM_GUIDE_MODULE_ID}`}
                className="px-md py-sm rounded border border-outline-variant text-on-surface text-label-sm hover:bg-surface-container inline-flex items-center gap-xs self-start"
              >
                Open module
                <span className="material-symbols-outlined text-[16px]">chevron_right</span>
              </Link>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center gap-md">
              <p className="flex-1 text-body-md text-on-surface-variant">
                Turn this guide into a Sales Training module with a {crmGuideQuiz(facts).length}-question quiz, so it counts on the
                scoreboard. The questions are written from the guide and update with it. The module starts as a draft.
              </p>
              {canApproveHr(perms) && <CreateGuideModuleButton />}
            </div>
          )}
        </Section>
        <CrmGuide sections={sections} changes={changesFor(sections)} today={todayIst()} />
      </div>
    </>
  );
}
