import Link from "next/link";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { todayIst } from "@/lib/lead-pulse-dates";
import { resolvePeriod } from "@/lib/sales-analysis";
import { loadSalesAnalysis } from "@/lib/sales-analysis-data";
import { SalesAnalysisView } from "./client";

export const dynamic = "force-dynamic";

export default async function SalesAnalysisPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!perms.isAdmin) {
    return (
      <>
        <TopBar title="Sales Analysis" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">
              You need admin access to view this page.
            </div>
          </Section>
        </div>
      </>
    );
  }

  const one = (k: string) => {
    const v = searchParams[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const range = resolvePeriod(one("period"), todayIst(), { from: one("from"), to: one("to") });
  // One query window covers the period and the equal-length one before it, so
  // every "vs previous" delta is computed client-side from the same facts.
  const payload = await loadSalesAnalysis({ from: range.prevFrom, to: range.to });

  return (
    <>
      <TopBar
        title="Sales Analysis"
        subtitle="Enrollments, booked value, collections and conversion — cut by any dimension"
        action={
          <Link href="/executive/dashboard" className="text-accent text-label-sm font-semibold hover:underline">
            ← CEO Dashboard
          </Link>
        }
      />
      <SalesAnalysisView payload={payload} range={range} />
    </>
  );
}
