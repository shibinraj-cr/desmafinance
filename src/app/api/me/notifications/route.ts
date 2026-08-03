import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { employeeForUser } from "@/lib/hr-me";

export const dynamic = "force-dynamic";

type Item = {
  id: string;
  source: "crm" | "hr";
  kind: string;
  title: string;
  body: string;
  linkUrl: string | null;
  leadId: string | null;
  createdAt: string;
  readAt: string | null;
};

/**
 * GET /api/me/notifications — the personal inbox: per-user CRM notifications
 * (lead assignments) merged with HR announcement receipts, newest first.
 * (Mark-read stays on the existing POST /api/crm|me/notifications/[id] routes.)
 */
export async function GET() {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const emp = await employeeForUser(userId);

  const crm = await prisma.crmNotification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const crmItems: Item[] = crm.map((n) => ({
    id: n.id,
    source: "crm",
    kind: n.kind,
    title: n.title,
    body: n.body,
    linkUrl: n.linkUrl,
    leadId: n.leadId,
    createdAt: n.createdAt.toISOString(),
    readAt: n.readAt ? n.readAt.toISOString() : null,
  }));

  let hrItems: Item[] = [];
  if (emp) {
    const receipts = await prisma.hrNotificationReceipt.findMany({
      where: { employeeId: emp.id },
      orderBy: { notification: { createdAt: "desc" } },
      take: 50,
      include: { notification: true },
    });
    hrItems = receipts.map((r) => ({
      id: r.notificationId,
      source: "hr",
      kind: r.notification.kind,
      title: r.notification.title,
      body: r.notification.body,
      linkUrl: r.notification.linkUrl,
      leadId: null,
      createdAt: r.notification.createdAt.toISOString(),
      readAt: r.readAt ? r.readAt.toISOString() : null,
    }));
  }

  const items = [...crmItems, ...hrItems].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
  const unread = items.filter((i) => !i.readAt).length;

  return NextResponse.json({ items, unread });
}
