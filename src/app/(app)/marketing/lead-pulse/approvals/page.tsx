import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import { prisma } from "@/lib/prisma";
import { ApprovalsClient, type QueueItem } from "./client";

export const dynamic = "force-dynamic";

export default async function DailyEntryApprovalsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  const access = await getLeadPulseAccess(userId, perms);
  if (!access.canSupervise) {
    return (
      <div className="px-[24px] py-[40px] max-w-2xl mx-auto">
        <div
          className="rounded-[12px] p-[24px] border"
          style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
        >
          <p style={{ color: "var(--lp-on-surface-variant)" }}>
            Only supervisors and admins can review daily-entry submissions.
          </p>
        </div>
      </div>
    );
  }

  const status =
    searchParams.status === "approved" ||
    searchParams.status === "rejected" ||
    searchParams.status === "submitted"
      ? searchParams.status
      : "submitted";

  // Pre-load the queue so the client component renders without a
  // round-trip on mount. The client refetches after each action.
  const metas = await prisma.leadPulseDailyMeta.findMany({
    where: { status },
    orderBy: [{ entryDate: "desc" }, { submittedAt: "desc" }],
    include: {
      user: {
        select: {
          id: true,
          username: true,
          leadPulseRole: { select: { displayName: true, role: true } },
        },
      },
      reviewedBy: { select: { id: true, username: true } },
    },
    take: 200,
  });
  const entries = await prisma.leadPulseDailyEntry.findMany({
    where: {
      OR: metas.map((m) => ({ userId: m.userId, entryDate: m.entryDate })),
    },
    include: { source: { select: { id: true, label: true, code: true } } },
  });
  const counts = await Promise.all([
    prisma.leadPulseDailyMeta.count({ where: { status: "submitted" } }),
    prisma.leadPulseDailyMeta.count({ where: { status: "approved" } }),
    prisma.leadPulseDailyMeta.count({ where: { status: "rejected" } }),
  ]);

  const items: QueueItem[] = metas.map((m) => {
    const dateStr = m.entryDate.toISOString().slice(0, 10);
    const rows = entries.filter(
      (e) => e.userId === m.userId && e.entryDate.toISOString().slice(0, 10) === dateStr,
    );
    return {
      key: `${m.userId}|${dateStr}`,
      userId: m.userId,
      date: dateStr,
      displayName: m.user.leadPulseRole?.displayName ?? m.user.username,
      role: m.user.leadPulseRole?.role ?? "—",
      submittedAt: m.submittedAt?.toISOString() ?? null,
      reviewedAt: m.reviewedAt?.toISOString() ?? null,
      reviewedBy: m.reviewedBy?.username ?? null,
      reviewNote: m.reviewNote,
      meta: {
        totalFollowups: m.totalFollowups,
        referredToDoc: m.referredToDoc,
        referredToAbroad: m.referredToAbroad,
        notes: m.notes,
      },
      rows: rows.map((r) => ({
        sourceCode: r.source.code,
        sourceLabel: r.source.label,
        roleAtEntry: r.roleAtEntry,
        leadsReceived: r.leadsReceived,
        connectedCalls: r.connectedCalls,
        disqualified: r.disqualified,
        transferredToL2: r.transferredToL2,
        receivedFromL1: r.receivedFromL1,
        directLeads: r.directLeads,
        connected: r.connected,
        quoteSent: r.quoteSent,
        closedWon: r.closedWon,
        closedLost: r.closedLost,
      })),
    };
  });

  return (
    <ApprovalsClient
      status={status}
      items={items}
      counts={{ submitted: counts[0], approved: counts[1], rejected: counts[2] }}
    />
  );
}
