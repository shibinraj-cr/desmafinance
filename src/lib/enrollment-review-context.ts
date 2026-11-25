/**
 * What Finance's enrollment review panel (src/components/finance/EnrollmentReview.tsx)
 * needs besides the enrollment: the Revenue categories, per bank whether its
 * payments can be invoiced in DesGro yet, and whether the viewer can open
 * Invoices. Shared by Verify enrollments and Approvals › Revenue.
 */
import { prisma } from "./prisma";
import { todayIst } from "./lead-pulse-dates";
import { setupGaps } from "./invoices/core";
import { getInvoiceAccess, loadSettings } from "./invoices/server";
import type { EnrollmentReviewContext } from "@/components/finance/EnrollmentReview";

export async function loadEnrollmentReviewContext(canApprove: boolean): Promise<EnrollmentReviewContext> {
  const [settings, categories, invoiceAccess] = await Promise.all([
    loadSettings(),
    prisma.category.findMany({
      where: { isActive: true, OR: [{ type: "Revenue" }, { type: "Both" }] },
      orderBy: { name: "asc" },
      select: { name: true, subItems: { where: { isActive: true }, orderBy: { name: "asc" }, select: { name: true } } },
    }),
    getInvoiceAccess(),
  ]);

  // Per bank, why its payments can't be invoiced in DesGro yet: "" when they can.
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

  return {
    today: todayIst(),
    canApprove,
    canInvoice: !!invoiceAccess?.isFinance,
    categories: categories.map((c) => ({ name: c.name, subItems: c.subItems.map((s) => s.name) })),
    invoiceBlock,
    invoiceStartsOn: settings.startsOn,
  };
}
