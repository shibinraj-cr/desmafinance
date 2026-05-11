import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { loadPartyDetail } from "@/lib/party-data";
import { TopBar } from "@/components/TopBar";
import { PartyProfile } from "./client";

export const dynamic = "force-dynamic";

/**
 * Party detail page (Candidate or Vendor). Open to any authenticated
 * user — same UI is reused at `/finance/parties/[id]` (see
 * `(finance)/parties/[id]/page.tsx`).
 */
export default async function PartyDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");

  const services = await prisma.service.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const sources = await prisma.leadPulseSource.findMany({
    orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
    select: { id: true, code: true, label: true, active: true },
  });
  const party = await loadPartyDetail(params.id);
  if (!party) notFound();

  // Transactions linked to this party (newest first). Used for the
  // ledger panel + per-service "paid so far" tally.
  const transactions = await prisma.transaction.findMany({
    where: { partyId: party.id, deletedAt: null },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  // Compute "paid so far" per service. We attribute Revenue
  // transactions to a PartyService when the transaction's subItem
  // resolves (via SubCategory.serviceId) to the same service. This
  // leverages the Services master link added in migrate-services.
  const subItemNames = Array.from(new Set(transactions.map((t) => t.subItem)));
  const matchingSubItems = await prisma.subCategory.findMany({
    where: { name: { in: subItemNames } },
    select: { name: true, serviceId: true, service: { select: { id: true, name: true } } },
  });
  const subItemServiceMap = new Map<string, string | null>();
  for (const s of matchingSubItems) {
    subItemServiceMap.set(s.name, s.serviceId ?? null);
  }
  const paidByService = new Map<string, number>();
  let totalPaid = 0;
  let totalRefunded = 0;
  for (const t of transactions) {
    const v = Number(t.amount.toString());
    if (t.type === "Revenue") {
      totalPaid += v;
      const svcId = subItemServiceMap.get(t.subItem) ?? null;
      if (svcId) {
        paidByService.set(svcId, (paidByService.get(svcId) ?? 0) + v);
      }
    } else {
      totalRefunded += v;
    }
  }
  const totalQuoted = party.partyServices.reduce(
    (sum, ps) => sum + Number(ps.totalAmount.toString()),
    0,
  );

  return (
    <>
      <TopBar
        title={party.name}
        subtitle={`${party.group} · ${party.txTypes} · ${party.isActive ? "Active" : "Inactive"}`}
      />
      <div className="p-margin">
        <PartyProfile
          party={{
            id: party.id,
            name: party.name,
            group: party.group as "Candidate" | "Vendor",
            txTypes: party.txTypes as "Revenue" | "Expense" | "Both",
            email: party.email,
            phone: party.phone,
            notes: party.notes,
            isActive: party.isActive,
            sourceId: party.sourceId,
            sourceLabel: party.source?.label ?? null,
            partyServices: party.partyServices.map((ps) => ({
              id: ps.id,
              serviceId: ps.serviceId,
              serviceName: ps.service.name,
              serviceActive: ps.service.isActive,
              totalAmount: Number(ps.totalAmount.toString()),
              notes: ps.notes,
              paidSoFar: paidByService.get(ps.serviceId) ?? 0,
            })),
          }}
          totals={{ totalQuoted, totalPaid, totalRefunded, balanceRemaining: totalQuoted - totalPaid }}
          services={services}
          sources={sources}
          transactions={transactions.map((t) => ({
            id: t.id,
            date: t.date.toISOString().slice(0, 10),
            type: t.type,
            category: t.category,
            subItem: t.subItem,
            description: t.description,
            paymentMode: t.paymentMode,
            amount: Number(t.amount.toString()),
          }))}
        />
      </div>
    </>
  );
}
