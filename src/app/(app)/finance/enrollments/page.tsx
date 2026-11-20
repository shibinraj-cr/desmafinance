import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { todayIst } from "@/lib/lead-pulse-dates";
import { setupGaps } from "@/lib/invoices/core";
import { loadSettings } from "@/lib/invoices/server";
import { getEnrollmentAccess, listEnrollments, type EnrollmentTab } from "@/lib/crm-enrollment";
import { EnrollmentsClient, type EnrollmentsPageData } from "./client";

export const dynamic = "force-dynamic";

const TABS: EnrollmentTab[] = ["verify", "sent-back", "not-received", "verified"];

/**
 * Finance › Verify enrollments: every enrollment a BDE submits waits here
 * until Finance checks the first payment against the bank and approves it
 * into the ledger (src/lib/crm-enrollment.ts).
 */
export default async function EnrollmentsPage({ searchParams }: { searchParams?: { tab?: string } }) {
  const access = await getEnrollmentAccess();
  if (!access) redirect("/login");
  if (!access.canView) redirect("/finance/overview");
  const tab = (TABS as string[]).includes(searchParams?.tab ?? "") ? (searchParams!.tab as EnrollmentTab) : "verify";

  const [list, settings, categories] = await Promise.all([
    listEnrollments(tab),
    loadSettings(),
    prisma.category.findMany({
      where: { isActive: true, OR: [{ type: "Revenue" }, { type: "Both" }] },
      orderBy: { name: "asc" },
      select: { name: true, subItems: { where: { isActive: true }, orderBy: { name: "asc" }, select: { name: true } } },
    }),
  ]);

  // Whether approving can issue the invoice too, per bank: "" when it can.
  const invoiceBlock: Record<string, string> = {};
  for (const b of settings.banks) {
    const entity = settings.entities.find((e) => e.code === b.entityCode) ?? null;
    const series = settings.series.find((s) => s.key.startsWith(b.entityCode)) ?? null;
    const gaps = setupGaps(entity, b, series);
    invoiceBlock[b.paymentMode] = !settings.startsOn
      ? "In-app invoicing hasn't started: Invoice settings has no start date."
      : !b.isActive
        ? "Invoicing is switched off for this bank."
        : gaps.length
          ? `Invoice settings aren't finished: ${gaps.join("; ")}.`
          : "";
  }

  const data: EnrollmentsPageData = {
    today: todayIst(),
    tab,
    rows: list.rows,
    counts: list.counts,
    canApprove: access.canApprove,
    categories: categories.map((c) => ({ name: c.name, subItems: c.subItems.map((s) => s.name) })),
    invoiceBlock,
    invoiceStartsOn: settings.startsOn,
    bankEntity: Object.fromEntries(settings.banks.map((b) => [b.paymentMode, b.entityCode])),
  };

  return (
    <>
      <TopBar title="Verify enrollments" subtitle="Check each new enrollment's first payment against the bank, then approve it into the ledger" />
      <EnrollmentsClient data={data} />
    </>
  );
}
