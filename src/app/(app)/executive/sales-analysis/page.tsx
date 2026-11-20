import Link from "next/link";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { todayIst } from "@/lib/lead-pulse-dates";
import { resolvePeriod } from "@/lib/sales-analysis";
import { loadSalesAnalysis } from "@/lib/sales-analysis-data";
import { SalesAnalysisView } from "./client";
import { LeadQualityView } from "./quality";
import { MetaRoiView } from "./meta-roi";
import { buildMetaRoi } from "@/lib/meta-roi";
import { loadMetaRoi } from "@/lib/meta-roi-data";

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
  const view = one("view") === "quality" ? "quality" : one("view") === "meta" ? "meta" : "sales";
  // Switching tab keeps the period; each view keeps its own cut in the URL.
  const tabHref = (v: "sales" | "quality" | "meta") => {
    const p = new URLSearchParams();
    for (const k of ["period", "from", "to"]) {
      const val = one(k);
      if (val) p.set(k, val);
    }
    if (v !== "sales") p.set("view", v);
    const qs = p.toString();
    return `/executive/sales-analysis${qs ? `?${qs}` : ""}`;
  };
  // One query window covers the period and the equal-length one before it, so
  // every "vs previous" delta is computed client-side from the same facts.
  // Meta ROI reads its own months and ships only the summary to the browser.
  const payload = view === "meta" ? null : await loadSalesAnalysis({ from: range.prevFrom, to: range.to });
  const metaRoi = view === "meta" ? buildMetaRoi(await loadMetaRoi(todayIst())) : null;

  return (
    <>
      <TopBar
        title="Sales Analysis"
        subtitle={
          view === "quality"
            ? "Lead quality as rated by the BDEs — by source, campaign and consultant"
            : view === "meta"
              ? "Meta ad spend against what Meta candidates paid — by month, by intake month and by campaign"
              : "Enrollments, booked value, collections and conversion — cut by any dimension"
        }
        action={
          <Link href="/executive/dashboard" className="text-accent text-label-sm font-semibold hover:underline">
            ← CEO Dashboard
          </Link>
        }
      />
      <div className="px-margin pt-md">
        <div role="tablist" className="inline-flex rounded-lg border border-outline-variant overflow-hidden">
          {(
            [
              { key: "sales", label: "Sales", icon: "query_stats" },
              { key: "quality", label: "Lead Quality", icon: "grade" },
              { key: "meta", label: "Meta ROI", icon: "campaign" },
            ] as const
          ).map((t) => (
            <Link
              key={t.key}
              href={tabHref(t.key)}
              role="tab"
              aria-selected={view === t.key}
              className={
                "inline-flex items-center gap-xs px-md h-9 text-label-sm font-semibold transition " +
                (view === t.key
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low")
              }
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                {t.icon}
              </span>
              {t.label}
            </Link>
          ))}
        </div>
      </div>
      {metaRoi ? (
        <MetaRoiView report={metaRoi} />
      ) : !payload ? null : view === "quality" ? (
        <LeadQualityView payload={payload} range={range} />
      ) : (
        <SalesAnalysisView payload={payload} range={range} />
      )}
    </>
  );
}
