import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // xlsx + Buffer

const MAX_ROWS = 50000; // safety cap — a broadcast is a few thousand at most

/**
 * GET /api/crm/wa/broadcasts/[id]/export — the WHOLE recipient list as an .xlsx.
 *
 * The on-screen report (…/[id] GET) pages at 500 and leads with failures; this is
 * the complete, number-by-number delivery record — one row per recipient with its
 * Meta delivery state (accepted → delivered → read, or failed/skipped) and the
 * handset timestamps — so the outcome can be reconciled or handed to a BDE.
 */
export const GET = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canBulkEmail) throw forbidden();

  const broadcast = await prisma.waBroadcast.findUnique({
    where: { id: params.id },
    select: { id: true, name: true },
  });
  if (!broadcast) throw notFound();

  const rows = await prisma.waBroadcastRecipient.findMany({
    where: { broadcastId: params.id },
    orderBy: [{ status: "asc" }, { id: "asc" }],
    take: MAX_ROWS,
    select: {
      phoneE164: true,
      status: true,
      skipReason: true,
      waStatus: true,
      waErrorCode: true,
      waErrorMessage: true,
      sentAt: true,
      deliveredAt: true,
      readAt: true,
      lead: { select: { candidateName: true } },
    },
  });

  const when = (d: Date | null) => (d ? new Date(d).toLocaleString("en-IN") : "");
  // The single honest per-number outcome: the async Meta state when we have one,
  // else the send-lifecycle status (skipped / pending / sent).
  const deliveryOf = (waStatus: string | null, status: string): string => {
    if (waStatus === "read") return "read";
    if (waStatus === "delivered") return "delivered";
    if (waStatus === "failed" || status === "failed") return "failed";
    if (status === "skipped") return "skipped";
    if (status === "pending") return "pending";
    if (status === "sending") return "sending"; // claimed by a drain, not yet confirmed
    if (waStatus === "sent" || status === "sent") return "accepted";
    return status;
  };

  const data = rows.map((r) => ({
    Candidate: r.lead?.candidateName ?? "",
    Phone: r.phoneE164,
    Delivery: deliveryOf(r.waStatus, r.status),
    "Skip reason": r.skipReason ?? "",
    "Error code": r.waErrorCode ?? "",
    Error: r.waErrorMessage ?? "",
    "Sent at": when(r.sentAt),
    "Delivered at": when(r.deliveredAt),
    "Read at": when(r.readAt),
  }));

  const header = ["Candidate", "Phone", "Delivery", "Skip reason", "Error code", "Error", "Sent at", "Delivered at", "Read at"];
  const ws = XLSX.utils.json_to_sheet(data, { header });
  ws["!cols"] = [{ wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 10 }, { wch: 40 }, { wch: 20 }, { wch: 20 }, { wch: 20 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Recipients");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const body = new Uint8Array(buf);

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="broadcast-${broadcast.id}-${stamp}.xlsx"`,
      "cache-control": "no-store",
    },
  });
});
