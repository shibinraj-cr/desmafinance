/**
 * The team daily lead report as spreadsheet rows — one array per sheet, built
 * pure so the export route only has to write them. Times are IST.
 */
import { HANDOVER_REJECT_REASONS, handoverChannel } from "./crm-handover";
import type { HandoverRow } from "./crm-handover-data";
import type { TeamLeadReport } from "./crm-lead-report-data";

const IST = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "Asia/Kolkata",
});
const istTime = (iso: string | null) => (iso ? IST.format(new Date(iso)) : "");

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  created: "Created",
  duplicate: "Duplicate",
  rejected: "Rejected",
  overdue: "Overdue",
};

export function handoverStatusLabel(h: Pick<HandoverRow, "status">): string {
  return STATUS_LABELS[h.status] ?? h.status;
}

export type SheetRows = Record<string, string | number>[];

export function teamReportSheets(r: TeamLeadReport): { name: string; rows: SheetRows }[] {
  const byBde: SheetRows = r.rows.map((b) => ({
    BDE: b.name,
    Received: b.totals.received,
    "Carried in": b.totals.carriedIn,
    Contacted: b.totals.contacted,
    Missed: b.totals.missed,
    "of which contacted late": b.totals.late,
    Pending: b.totals.pending,
    "Due next working day": b.totals.dueLater,
    "Handovers given": b.handovers.given,
    "Handovers created": b.handovers.created,
    "Handovers duplicate": b.handovers.duplicate,
    "Handovers rejected": b.handovers.rejected,
    "Handovers overdue": b.handovers.overdue,
    Report: b.submission?.locked ? (b.submission.status === "reviewed" ? "Reviewed" : "Generated") : "Not generated yet",
  }));
  byBde.push({
    BDE: "Team",
    Received: r.totals.received,
    "Carried in": r.totals.carriedIn,
    Contacted: r.totals.contacted,
    Missed: r.totals.missed,
    "of which contacted late": r.totals.late,
    Pending: r.totals.pending,
    "Due next working day": r.totals.dueLater,
    "Handovers given": r.handoverTotals.given,
    "Handovers created": r.handoverTotals.created,
    "Handovers duplicate": r.handoverTotals.duplicate,
    "Handovers rejected": r.handoverTotals.rejected,
    "Handovers overdue": r.handoverTotals.overdue,
    Report: `${r.rows.filter((b) => b.submission?.locked).length} / ${r.rows.length} generated`,
  });

  const bySource: SheetRows = r.rows.flatMap((b) =>
    b.sources.map((s) => ({
      BDE: b.name,
      Source: s.label,
      Received: s.received,
      "Carried in": s.carriedIn,
      Contacted: s.contacted,
      Missed: s.missed,
      "of which contacted late": s.late,
      Pending: s.pending,
      "Due next working day": s.dueLater,
    })),
  );

  const missed: SheetRows = r.missed.map((m) => ({
    Lead: m.candidateName,
    Source: m.sourceLabel,
    BDE: m.bdeName,
    Assigned: istTime(m.assignedAt),
    Due: istTime(m.dueAt),
    "Contacted late at": istTime(m.contactedLateAt),
  }));

  const handovers: SheetRows = r.handovers.map((h) => ({
    "Given on": h.handoverDate,
    Source: handoverChannel(h.channel)?.label ?? h.channel,
    Name: h.leadName ?? "",
    Phone: h.phone,
    BDE: h.assignedBde.name,
    Status: handoverStatusLabel(h),
    Late: h.isLate ? "Yes" : "",
    Lead: h.linkedLead?.candidateName ?? "",
    "Reject reason": HANDOVER_REJECT_REASONS.find((x) => x.code === h.rejectReason)?.label ?? "",
    Note: [h.note, h.rejectNote].filter(Boolean).join(" · "),
  }));

  return [
    { name: "By BDE", rows: byBde },
    { name: "By source", rows: bySource },
    { name: "Missed leads", rows: missed },
    { name: "Handovers", rows: handovers },
  ];
}
