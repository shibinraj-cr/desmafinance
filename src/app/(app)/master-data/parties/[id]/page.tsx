import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { CANDIDATE_PAYMENT_PREFIXES } from "@/lib/finance-historical";
import { loadPartyDetail } from "@/lib/party-data";
import { TopBar } from "@/components/TopBar";
import { PartyProfile } from "./client";
import { PartyCollectionPlans } from "@/components/PartyCollectionPlans";

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
  // Active L2 BDEs — populate the "Closed by" dropdown on Candidates
  // so the service-conversion matrix can attribute each closed deal
  // to the right BDE.
  const l2Bdes = await prisma.leadPulseRole.findMany({
    where: { active: true, role: "l2" },
    orderBy: [{ displayName: "asc" }],
    include: { user: { select: { id: true, username: true } } },
  });
  const party = await loadPartyDetail(params.id);
  if (!party) notFound();

  // Transactions linked to this party (newest first). Used for the
  // ledger panel + per-service "paid so far" tally.
  // This includes payments from before DesGro (isHistorical): they are left
  // out of every report but are exactly what a candidate's balance needs.
  const transactions = await prisma.transaction.findMany({
    where: { partyId: party.id, deletedAt: null },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  // Finance users (whoever may enter transactions) can record a candidate's
  // payments from before DesGro here; they go through the normal approval.
  const canRecordPastPayments =
    party.group === "Candidate" && canSeePage(perms, "/finance/daily-tracker");
  const [paymentSubItems, pendingCreates, ownDrafts] = canRecordPastPayments
    ? await Promise.all([
        // Every Sales / Collection sub-item, with the service it books to,
        // so the form can turn "service + first payment/instalment" into
        // the right ledger line.
        prisma.subCategory.findMany({
          where: {
            isActive: true,
            category: {
              isActive: true,
              type: { in: ["Revenue", "Both"] },
              OR: CANDIDATE_PAYMENT_PREFIXES.map((p) => ({ name: { startsWith: p } })),
            },
          },
          select: { name: true, serviceId: true, category: { select: { name: true } } },
          orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
        }),
        // Entries for this candidate still waiting for a manager, so nobody
        // records the same payment twice.
        prisma.pendingApproval.findMany({
          where: { status: "pending", kind: "create", proposed: { path: ["partyId"], equals: party.id } },
          orderBy: { createdAt: "desc" },
          select: { id: true, proposed: true, submittedBy: { select: { username: true } } },
        }),
        prisma.transactionDraft.findMany({
          where: { partyId: party.id, submittedById: userId },
          orderBy: { createdAt: "desc" },
          select: { id: true, date: true, subItem: true, amount: true },
        }),
      ])
    : [[], [], []];
  const awaiting = [
    ...pendingCreates.map((p) => {
      const d = (p.proposed ?? {}) as { date?: string; subItem?: string; amount?: number | string };
      return {
        id: p.id,
        date: typeof d.date === "string" ? d.date.slice(0, 10) : "",
        subItem: d.subItem ?? "",
        amount: Number(d.amount ?? 0),
        status: "pending" as const,
        by: p.submittedBy?.username ?? null,
      };
    }),
    ...ownDrafts.map((d) => ({
      id: d.id,
      date: d.date.toISOString().slice(0, 10),
      subItem: d.subItem,
      amount: Number(d.amount.toString()),
      status: "draft" as const,
      by: null,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

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
  let paidBeforeDesgro = 0;
  let totalRefunded = 0;
  for (const t of transactions) {
    const v = Number(t.amount.toString());
    if (t.type === "Revenue") {
      totalPaid += v;
      if (t.isHistorical) paidBeforeDesgro += v;
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
      <div className="p-margin space-y-lg">
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
            assignedL2BdeId: party.assignedL2BdeId ?? null,
            assignedL2BdeUsername: party.assignedL2Bde?.username ?? null,
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
          totals={{
            totalQuoted,
            totalPaid,
            paidBeforeDesgro,
            totalRefunded,
            balanceRemaining: totalQuoted - totalPaid,
          }}
          services={services}
          sources={sources}
          l2Bdes={l2Bdes.map((r) => ({
            id: r.user.id,
            username: r.user.username,
            displayName: r.displayName,
          }))}
          transactions={transactions.map((t) => ({
            id: t.id,
            date: t.date.toISOString().slice(0, 10),
            type: t.type,
            category: t.category,
            subItem: t.subItem,
            description: t.description,
            paymentMode: t.paymentMode,
            amount: Number(t.amount.toString()),
            isHistorical: t.isHistorical,
          }))}
          pastPayments={
            canRecordPastPayments
              ? {
                  options: paymentSubItems.map((s) => ({
                    category: s.category.name,
                    subItem: s.name,
                    serviceId: s.serviceId,
                  })),
                  awaiting,
                }
              : null
          }
        />
        {party.group === "Candidate" ? (
          <PartyCollectionPlans partyId={party.id} />
        ) : null}
      </div>
    </>
  );
}
