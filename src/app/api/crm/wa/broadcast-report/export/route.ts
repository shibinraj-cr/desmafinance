import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { canViewAllConversations } from "@/lib/wa/access";
import { loadBroadcastReport } from "@/lib/wa/broadcast-report-data";
import {
  DEFAULT_REPLY_WINDOW_DAYS,
  NO_OWNER,
  REPLY_WINDOW_OPTIONS,
  applyFilter,
  formatDuration,
  percent,
  resolveRange,
  sessionOpen,
  summariseByCampaign,
  summariseByOwner,
  withinWindow,
  worklist,
} from "@/lib/wa/broadcast-report";
import { listParam } from "@/lib/filter-params";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // xlsx + Buffer
export const maxDuration = 60;

/**
 * GET /api/crm/wa/broadcast-report/export — the Broadcast Report as an .xlsx,
 * for exactly the selection on screen (range, campaigns, owners, reply window).
 * Same loader and same rules as the page, so the file and the screen agree.
 *
 * Three sheets: every reply (waiting first, longest-waiting at the top), and the
 * by-campaign and by-owner tables. Scoped like the page — a consultant's file
 * holds only the leads they own.
 */
export const GET = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) throw forbidden();
  const seesEveryone = canViewAllConversations(access);

  const url = new URL(req.url);
  const q = url.searchParams;
  const range = resolveRange(q.get("range") ?? undefined, q.get("from") ?? undefined, q.get("to") ?? undefined, new Date());
  const w = Number(q.get("window"));
  const windowDays = (REPLY_WINDOW_OPTIONS as readonly number[]).includes(w) ? w : DEFAULT_REPLY_WINDOW_DAYS;

  const data = await loadBroadcastReport({ from: range.from, to: range.to, ownerScope: seesEveryone ? null : userId });
  const filter = {
    campaignIds: listParam(q.getAll("campaign")),
    ownerKeys: seesEveryone ? listParam(q.getAll("owner")) : [],
  };
  const sliced = applyFilter(data, filter);
  const now = data.generatedAt;
  const person = (id: string | null) => (id ? data.people[id] ?? "Unknown user" : "No owner");
  const campaignName = new Map(data.campaigns.map((c) => [c.id, c.name]));
  const when = (ts: number | null) =>
    ts === null ? "" : new Date(ts).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

  const replyRows = worklist(
    sliced.replies.filter((r) => withinWindow(r, windowDays)),
    "all",
  ).map((r) => ({
    Candidate: r.candidateName,
    Phone: r.phone,
    Campaign: campaignName.get(r.campaignId) ?? "",
    "Campaign sent": when(r.sentAt),
    "First reply": r.firstText ?? "",
    "Replied at": when(r.firstReplyAt),
    "Latest message": r.lastText ?? r.firstText ?? "",
    "Latest message at": when(r.lastInboundAt),
    Owner: person(r.ownerId),
    Status: r.state === "waiting" ? "Needs reply" : r.state === "opted_out" ? "Opted out" : "Answered",
    "Waiting for": r.state === "waiting" ? formatDuration(now - r.lastInboundAt) : "",
    "24h window": sessionOpen(r, now) ? "Open" : "Closed",
    "First response": r.firstResponseAt !== null ? formatDuration(r.firstResponseAt - r.firstReplyAt) : "",
    "Responded by": r.firstResponseBy ? person(r.firstResponseBy) : "",
    "Answered via": r.answeredVia === "call" ? "Call" : r.answeredVia === "whatsapp" ? "WhatsApp" : "",
    "Stage now": r.stageNow ?? "",
    "Stage change": r.move ? `${r.move.from} → ${r.move.to}${r.move.auto ? " (auto)" : ""}` : "",
    "Owner change": r.ownerChange ? `${person(r.ownerChange.fromId)} → ${person(r.ownerChange.toId)}` : "",
  }));

  const campaigns = data.campaigns.filter((c) => !filter.campaignIds.length || filter.campaignIds.includes(c.id));
  const campaignRows = summariseByCampaign(campaigns, sliced.groups, sliced.replies, windowDays, now).map(({ key, summary: s }) => ({
    Campaign: campaignName.get(key) ?? "",
    "Started sending": when(data.campaigns.find((c) => c.id === key)?.startedAt ?? null),
    Sent: s.sent,
    Delivered: s.delivered,
    Read: s.read,
    Failed: s.failed,
    Skipped: s.skipped,
    Replied: s.replied,
    "Reply rate": percent(s.replied, s.delivered),
    Answered: s.answered,
    "Opted out": s.optedOut,
    "Needs reply": s.waiting,
    "Answered %": percent(s.handled, s.replied),
    "Stage changed": s.stageMoved,
    "New owner": s.ownerChanged,
    "Median first response": formatDuration(s.medianFirstResponseMs),
  }));

  const ownerRows = summariseByOwner(sliced.groups, sliced.replies, windowDays, now)
    .sort((a, b) => b.summary.waiting - a.summary.waiting)
    .map(({ key, summary: s }) => ({
      Owner: key === NO_OWNER ? "No owner" : person(key),
      Sent: s.sent,
      Replied: s.replied,
      Answered: s.answered,
      "Opted out": s.optedOut,
      "Needs reply": s.waiting,
      "Answered %": percent(s.handled, s.replied),
      "Median first response": formatDuration(s.medianFirstResponseMs),
      "Oldest waiting": s.waiting ? formatDuration(s.oldestWaitingMs) : "",
    }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(replyRows), "Replies");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(campaignRows), "By campaign");
  if (seesEveryone) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ownerRows), "By owner");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="broadcast-replies-${stamp}.xlsx"`,
      "cache-control": "no-store",
    },
  });
});
