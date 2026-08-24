import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { CRM_BDE_ENROLLMENT_PAGE } from "@/lib/crm-rbac";
import { getBdeEnrollmentData } from "@/lib/crm-bde-enrollment";
import { BdeEnrollmentClient } from "./client";

export const dynamic = "force-dynamic";

type SP = { [k: string]: string | string[] | undefined };

function str(sp: SP, k: string): string | undefined {
  const v = sp[k];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export default async function BdeEnrollmentPage({ searchParams }: { searchParams: SP }) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  const hasAccess = perms.isAdmin || canSeePage(perms, CRM_BDE_ENROLLMENT_PAGE);
  if (!hasAccess) {
    return (
      <>
        <TopBar title="BDE Enrollment" subtitle="CRM" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">
              This dashboard is restricted. Ask an administrator if you need enrolment &amp; conversion figures.
            </div>
          </Section>
        </div>
      </>
    );
  }

  const data = await getBdeEnrollmentData({
    monthValue: str(searchParams, "month") ?? "",
    bdeFilter: str(searchParams, "bde") ?? "all",
    selfUserId: userId,
  });

  return (
    <>
      <TopBar title="BDE Enrollment" subtitle="Enrolment & conversion · CRM" />
      <div className="p-margin">
        <BdeEnrollmentClient data={data} />
      </div>
    </>
  );
}
