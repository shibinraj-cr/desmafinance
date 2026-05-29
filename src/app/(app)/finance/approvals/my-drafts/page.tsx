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
  // Admins also see this screen for oversight — they get the full list
  // of every draft-first user's pending drafts. Anyone else without the
  // flag has nothing to do here.
  if (!perms.draftFirst && !perms.isAdmin) {
    redirect("/finance/approvals/pending");
  }
  const isAdminViewer = perms.isAdmin && !perms.draftFirst;

  const [drafts, masters, counts] = await Promise.all([
    prisma.transactionDraft.findMany({
      where: isAdminViewer ? {} : { submittedById: userId },
      orderBy: [{ createdAt: "desc" }],
      include: {
        party: { select: { id: true, name: true, group: true } },
        submittedBy: { select: { id: true, username: true } },
      },
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
      prisma.pendingApproval.count({
        where: { ...(isAdminViewer ? {} : { submittedById: userId }), status: "pending" },
      }),
      prisma.pendingApproval.count({
        where: { ...(isAdminViewer ? {} : { submittedById: userId }), status: "approved" },
      }),
      prisma.pendingApproval.count({
        where: { ...(isAdminViewer ? {} : { submittedById: userId }), status: "rejected" },
      }),
    ]),
  ]);

  const [categories, parties] = masters;
  const [pendingCount, approvedCount, rejectedCount] = counts;

  return (
    <>
      <TopBar
        title="Approvals"
        subtitle={
          isAdminViewer
            ? `${drafts.length} draft${drafts.length === 1 ? "" : "s"} across all users · admin oversight`
            : `${drafts.length} draft${drafts.length === 1 ? "" : "s"} · review and submit for approval`
        }
      />
      <div className="p-margin space-y-lg">
        <Tabs
          active="my-drafts"
          counts={{ pending: pendingCount, approved: approvedCount, rejected: rejectedCount }}
          myDrafts={{ count: drafts.length }}
        />
        <MyDraftsClient
          isAdminViewer={isAdminViewer}
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
            expDom: d.expDom,
            partyId: d.partyId,
            partyName: d.party?.name ?? null,
            partyGroup: d.party?.group ?? null,
            submittedByUsername: d.submittedBy?.username ?? null,
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
