import { redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { Tabs } from "../_tabs";
import { MyDraftsClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * /finance/approvals/my-drafts — visible only to users with
 * User.draftFirst=true (currently Ganga). Lists their TransactionDraft
 * rows in an editable, Excel-style table; each row can be edited,
 * submitted for approval, or discarded. Bulk submit is available
 * across selected rows.
 */
export default async function MyDraftsPage() {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) redirect("/login");
  if (!perms.draftFirst) {
    // Anyone without the flag has nothing to do here.
    redirect("/finance/approvals/pending");
  }

  const [drafts, masters, counts] = await Promise.all([
    prisma.transactionDraft.findMany({
      where: { submittedById: userId },
      orderBy: [{ createdAt: "desc" }],
      include: { party: { select: { id: true, name: true, group: true } } },
    }),
    Promise.all([
      prisma.category.findMany({
        orderBy: [{ type: "asc" }, { name: "asc" }],
        where: { isActive: true },
        include: {
          subItems: {
            where: { isActive: true },
            orderBy: { name: "asc" },
            select: { id: true, name: true },
          },
        },
      }),
      prisma.party.findMany({
        orderBy: [{ group: "asc" }, { name: "asc" }],
        where: { isActive: true },
        select: { id: true, name: true, group: true, txTypes: true },
      }),
    ]),
    Promise.all([
      prisma.pendingApproval.count({ where: { submittedById: userId, status: "pending" } }),
      prisma.pendingApproval.count({ where: { submittedById: userId, status: "approved" } }),
      prisma.pendingApproval.count({ where: { submittedById: userId, status: "rejected" } }),
    ]),
  ]);

  const [categories, parties] = masters;
  const [pendingCount, approvedCount, rejectedCount] = counts;

  return (
    <>
      <TopBar
        title="Approvals"
        subtitle={`${drafts.length} draft${drafts.length === 1 ? "" : "s"} · review and submit for approval`}
      />
      <div className="p-margin space-y-lg">
        <Tabs
          active="my-drafts"
          counts={{ pending: pendingCount, approved: approvedCount, rejected: rejectedCount }}
          myDrafts={{ count: drafts.length }}
        />
        <MyDraftsClient
          drafts={drafts.map((d) => ({
            id: d.id,
            date: d.date.toISOString().slice(0, 10),
            month: d.month,
            type: d.type,
            category: d.category,
            subItem: d.subItem,
            description: d.description,
            paymentMode: d.paymentMode,
            amount: Number(d.amount.toString()),
            flow: d.flow,
            partyId: d.partyId,
            partyName: d.party?.name ?? null,
            partyGroup: d.party?.group ?? null,
            createdAt: d.createdAt.toISOString(),
          }))}
          categories={categories.map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            subItems: c.subItems,
          }))}
          parties={parties}
        />
      </div>
    </>
  );
}
