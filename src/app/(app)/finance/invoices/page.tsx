import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { todayIst } from "@/lib/lead-pulse-dates";
import { gstStateOfGstin } from "@/lib/invoices/gst-states";
import { setupGaps } from "@/lib/invoices/core";
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

export default async function InvoicesPage({ searchParams }: { searchParams?: { tab?: string } }) {
  const access = await getInvoiceAccess();
  if (!access) redirect("/login");
  if (!access.isFinance) redirect("/finance/overview");

  const today = todayIst();
  const month = today.slice(0, 7);
  const [toInvoice, settings, upcoming, issued] = await Promise.all([
    listToInvoice(),
    loadSettings(),
    upcomingNumbers(),
    listInvoices({ month }),
  ]);
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
    gapsByBank,
    issuerStateCode: gstStateOfGstin(dipl?.gstin)?.code ?? null,
    lutArn: dipl?.lutArn ?? null,
  };
  const tab = (TABS as readonly string[]).includes(searchParams?.tab ?? "") ? searchParams!.tab! : "to-invoice";

  return (
    <>
      <TopBar title="Invoices" subtitle="GST invoices for candidate payments · Axis · HDFC · Wio" />
      <InvoicesClient data={data} initialTab={tab} page={INVOICES_PAGE} />
    </>
  );
}
