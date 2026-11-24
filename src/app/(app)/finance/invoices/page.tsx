import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { todayIst } from "@/lib/lead-pulse-dates";
import { gstStateOfGstin } from "@/lib/invoices/gst-states";
import { fyCode, setupGaps } from "@/lib/invoices/core";
import {
  INVOICES_PAGE,
  getInvoiceAccess,
  listInvoices,
  listToInvoice,
  loadSettings,
  upcomingNumbers,
} from "@/lib/invoices/server";
import { InvoicesClient, type InvoicesPageData } from "./client";

export const dynamic = "force-dynamic";

const TABS = ["to-invoice", "issued", "not-invoiced", "settings"] as const;

export default async function InvoicesPage({ searchParams }: { searchParams?: { tab?: string; issue?: string } }) {
  const access = await getInvoiceAccess();
  if (!access) redirect("/login");
  if (!access.isFinance) redirect("/finance/overview");

  const today = todayIst();
  const month = today.slice(0, 7);
  const [toInvoice, settings, upcoming, issued] = await Promise.all([
    listToInvoice({ include: typeof searchParams?.issue === "string" ? searchParams.issue : null }),
    loadSettings(),
    upcomingNumbers(),
    listInvoices({ month }),
  ]);
  // The next number per series for every financial year a waiting payment
  // falls in (normally just this one), so To invoice can show each row's number.
  const fyDates = new Map<string, string>([[fyCode(today), today]]);
  for (const r of toInvoice.rows) if (!fyDates.has(fyCode(r.date))) fyDates.set(fyCode(r.date), r.date);
  const upcomingByFy = Object.fromEntries(
    await Promise.all([...fyDates].map(async ([fy, date]) => [fy, fy === fyCode(today) ? upcoming : await upcomingNumbers(date)] as const)),
  );
  const dipl = settings.entities.find((e) => e.code === "DIPL") ?? null;
  // What stops each bank's invoices, so the page can say it before anyone clicks.
  const gapsByBank = Object.fromEntries(
    settings.banks.map((b) => {
      const entity = settings.entities.find((e) => e.code === b.entityCode) ?? null;
      const series = settings.series.filter((s) => s.key.startsWith(b.entityCode));
      return [b.paymentMode, setupGaps(entity, b, series[0] ?? null)];
    }),
  );

  const data: InvoicesPageData = {
    today,
    month,
    canManage: access.canManage,
    toInvoice: toInvoice.rows,
    issued,
    settings,
    upcoming,
    upcomingByFy,
    gapsByBank,
    issuerStateCode: gstStateOfGstin(dipl?.gstin)?.code ?? null,
    lutArn: dipl?.lutArn ?? null,
  };
  // ?issue=<ledger entry id>: open that payment's Issue dialog (from Record
  // payment on a collection plan, or anywhere that links a payment here).
  const issue = typeof searchParams?.issue === "string" && searchParams.issue ? searchParams.issue : null;
  const tab = issue ? "to-invoice" : (TABS as readonly string[]).includes(searchParams?.tab ?? "") ? searchParams!.tab! : "to-invoice";

  return (
    <>
      <TopBar title="Invoices" subtitle="GST invoices for candidate payments · Axis · HDFC · Wio" />
      <InvoicesClient data={data} initialTab={tab} page={INVOICES_PAGE} openIssue={issue} />
    </>
  );
}
