import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { ENROLLMENT_TABS, getEnrollmentAccess, listEnrollments, type EnrollmentTab } from "@/lib/crm-enrollment";
import { loadEnrollmentReviewContext } from "@/lib/enrollment-review-context";
import { EnrollmentsClient, type EnrollmentsPageData } from "./client";

export const dynamic = "force-dynamic";

/**
 * Finance › Verify enrollments: every enrollment a BDE submits waits here
 * until Finance checks the first payment against the bank. An approver
 * approves it into the ledger; anyone else submits it, and it waits for the
 * Finance Manager in Approvals › Revenue (src/lib/crm-enrollment.ts).
 */
export default async function EnrollmentsPage({ searchParams }: { searchParams?: { tab?: string } }) {
  const access = await getEnrollmentAccess();
  if (!access) redirect("/login");
  if (!access.canView) redirect("/finance/overview");
  const tab = (ENROLLMENT_TABS as string[]).includes(searchParams?.tab ?? "") ? (searchParams!.tab as EnrollmentTab) : "verify";

  const [list, ctx] = await Promise.all([listEnrollments(tab), loadEnrollmentReviewContext(access.canApprove)]);
  const data: EnrollmentsPageData = { ...ctx, tab, rows: list.rows, counts: list.counts };

  return (
    <>
      <TopBar
        title="Verify enrollments"
        subtitle={
          access.canApprove
            ? "Check each new enrollment's first payment against the bank, then approve it into the ledger"
            : "Check each new enrollment's first payment against the bank, then submit it for approval"
        }
      />
      <EnrollmentsClient data={data} />
    </>
  );
}
