/**
 * Loads the rows behind CRM → Activity → Lead Quality (see
 * crm-lead-quality-report.ts for what is built from them). One query covers
 * the period, the equal-length period before it (for the deltas) and the
 * 8-week junk trend, so the page makes a single trip for its leads.
 */
import { prisma } from "./prisma";
import { buildCrmLeadQualityReport, trendWeekStarts, type LqFilters, type LqReport, type LqRow } from "./crm-lead-quality-report";

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;

/** Half-open instants for inclusive IST calendar days `fromYmd`..`toYmd`. */
export function istDayRange(fromYmd: string, toYmd: string): { from: Date; to: Date } {
  return {
    from: new Date(Date.parse(`${fromYmd}T00:00:00.000Z`) - IST_OFFSET_MS),
    to: new Date(Date.parse(`${toYmd}T00:00:00.000Z`) + DAY_MS - IST_OFFSET_MS),
  };
}

export async function loadCrmLeadQualityReport(opts: {
  range: { from: string; to: string; prevFrom: string; prevTo: string };
  filters: LqFilters;
  now?: Date;
}): Promise<LqReport> {
  const now = opts.now ?? new Date();
  const cur = istDayRange(opts.range.from, opts.range.to);
  const prev = istDayRange(opts.range.prevFrom, opts.range.prevTo);
  const weeks = trendWeekStarts(now);
  const trendFrom = new Date(weeks[0] * DAY_MS - IST_OFFSET_MS);
  const trendTo = new Date((weeks[weeks.length - 1] + 7) * DAY_MS - IST_OFFSET_MS);

  const from = new Date(Math.min(prev.from.getTime(), trendFrom.getTime()));
  const to = new Date(Math.max(cur.to.getTime(), trendTo.getTime()));

  const [leads, roles] = await Promise.all([
    prisma.lead.findMany({
      // Duplicates excluded, as on every lead count in the reports.
      where: { createdAt: { gte: from, lt: to }, status: { code: { not: "duplicate" } } },
      select: {
        id: true,
        candidateName: true,
        createdAt: true,
        sourceId: true,
        source: { select: { label: true } },
        campaign: true,
        serviceId: true,
        service: { select: { name: true } },
        assignedToId: true,
        assignedTo: { select: { username: true } },
        qualityRating: true,
        qualityDueAt: true,
        qualityReason: { select: { label: true } },
        status: { select: { code: true, kind: true } },
      },
    }),
    prisma.leadPulseRole.findMany({ select: { userId: true, displayName: true } }),
  ]);
  const displayName = new Map(roles.map((r) => [r.userId, r.displayName]));

  const rows: LqRow[] = leads.map((l) => ({
    id: l.id,
    candidateName: l.candidateName,
    createdAt: l.createdAt,
    sourceId: l.sourceId,
    source: l.source?.label ?? null,
    campaign: l.campaign,
    serviceId: l.serviceId,
    service: l.service?.name ?? null,
    assigneeId: l.assignedToId,
    assigneeName: l.assignedToId ? (displayName.get(l.assignedToId) ?? l.assignedTo?.username ?? null) : null,
    qualityRating: l.qualityRating,
    qualityDueAt: l.qualityDueAt,
    reason: l.qualityReason?.label ?? null,
    statusCode: l.status.code,
    statusKind: l.status.kind,
  }));

  return buildCrmLeadQualityReport(rows, {
    from: cur.from,
    to: cur.to,
    prevFrom: prev.from,
    prevTo: prev.to,
    now,
    filters: opts.filters,
  });
}
