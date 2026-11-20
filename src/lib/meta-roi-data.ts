/**
 * The facts behind Executive › Sales Analysis › Meta ROI. Rules and maths are
 * in meta-roi.ts; this only reads, and turns rows into plain values (so no
 * lead `extra` JSON or names reach the browser).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { fromPrismaDate, istDateString, toPrismaDate } from "./lead-pulse-dates";
import { LEDGER_GO_LIVE_ISO } from "./finance-historical";
import { META_AD_CATEGORY, META_AD_SUBITEM } from "./lead-pulse-metrics";
import {
  META_SOURCE_CODES,
  POSSIBLE_META_SOURCE_CODES,
  addMonths,
  campaignLabel,
  hasAdEvidence,
  monthEnd,
  monthOf,
  monthRange,
  paymentKind,
  type MetaRoiInput,
  type RoiEnrollment,
  type RoiLead,
  type RoiPayment,
  type Verification,
} from "./meta-roi";

/** How many months the tab shows, at most (never before the ledger began). */
export const META_ROI_MONTHS = 12;
const REFUND_CATEGORY = "Refund";

type LeadRaw = {
  id: string;
  partyId: string | null;
  createdAt: Date;
  sourceCode: string | null;
  originalSourceCode: string | null;
  campaign: string | null;
  ctwaClid: string | null;
  adSourceType: string | null;
  adHeadline: string | null;
  adId: string | null;
  statusKind: string;
  uploaded: boolean;
  metaDate: string | null;
};

export async function loadMetaRoi(today: string): Promise<MetaRoiInput> {
  const goLive = monthOf(LEDGER_GO_LIVE_ISO);
  const last = monthOf(today);
  const first = [addMonths(last, -(META_ROI_MONTHS - 1)), goLive].sort().pop()!;
  const months = monthRange(first, last);
  const fromDay = `${first}-01`;
  const toDay = monthEnd(last);

  const [spendRows, manualRows, revenueRows, historicalRows, refundRows, deals] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        type: "Expense",
        category: META_AD_CATEGORY,
        subItem: META_AD_SUBITEM,
        deletedAt: null,
        isHistorical: false,
        date: { gte: toPrismaDate(fromDay), lt: toPrismaDate(addDaysIso(toDay, 1)) },
      },
      select: { date: true, amount: true },
    }),
    prisma.leadPulseMetaSpend.findMany({
      where: { OR: months.map((m) => ({ year: Number(m.slice(0, 4)), month: Number(m.slice(5, 7)) })) },
      select: { year: true, month: true, amount: true },
    }),
    // Every candidate payment since the ledger began: a candidate's first
    // "Sales" payment is the new sale, so the history before the window matters.
    prisma.transaction.findMany({
      where: { type: "Revenue", deletedAt: null, isHistorical: false, partyId: { not: null } },
      select: { id: true, date: true, category: true, amount: true, gstAmount: true, partyId: true },
    }),
    // Payments from before DesGro (isHistorical): never counted as money here,
    // only to know a candidate had bought before, so a later sale is a repeat.
    prisma.transaction.findMany({
      where: { type: "Revenue", deletedAt: null, isHistorical: true, partyId: { not: null } },
      select: { category: true, partyId: true },
    }),
    prisma.transaction.findMany({
      where: { type: "Expense", category: REFUND_CATEGORY, deletedAt: null, isHistorical: false, partyId: { not: null } },
      select: { date: true, amount: true, partyId: true },
    }),
    prisma.leadPulsePipeline.findMany({
      where: { status: "closed_won", closedDate: { gte: toPrismaDate(fromDay), lte: toPrismaDate(toDay) } },
      select: {
        id: true,
        partyId: true,
        closedDate: true,
        source: { select: { code: true } },
        leadLink: { select: { id: true, partyId: true } },
        enrollments: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
      },
    }),
  ]);

  const payments: RoiPayment[] = revenueRows.flatMap((r) => {
    const kind = paymentKind(r.category);
    if (!kind || !r.partyId) return [];
    // Net of GST, like every revenue figure (src/lib/finance-gst.ts).
    return [{ id: r.id, partyId: r.partyId, day: fromPrismaDate(r.date), kind, net: Number(r.amount) - Number(r.gstAmount), gross: Number(r.amount) }];
  });
  const priorSaleParties = [...new Set(historicalRows.flatMap((r) => (r.partyId && paymentKind(r.category) === "sale" ? [r.partyId] : [])))];
  const dealParty = (d: (typeof deals)[number]) => d.partyId ?? d.leadLink?.partyId ?? null;
  const dealPartyIds = [...new Set(deals.map(dealParty).filter((x): x is string => !!x))];
  const partyIds = [...new Set([...payments.map((p) => p.partyId), ...refundRows.map((r) => r.partyId!), ...dealPartyIds])];

  // The window's leads from Meta-ish sources or with a recorded ad, plus every
  // lead of a candidate who paid (their earliest lead is the acquisition).
  // Lead.createdAt is a UTC instant stored without a zone: compare in UTC.
  const fromInstant = new Date(`${fromDay}T00:00:00+05:30`);
  const codes = [...META_SOURCE_CODES, ...POSSIBLE_META_SOURCE_CODES];
  const dealLeadIds = deals.map((d) => d.leadLink?.id).filter((x): x is string => !!x);
  const leadRows = await prisma.$queryRaw<LeadRaw[]>(Prisma.sql`
    SELECT l.id, l."partyId", l."createdAt", s.code AS "sourceCode", os.code AS "originalSourceCode", l.campaign,
           l.extra->>'ctwa_clid' AS "ctwaClid", l.extra->>'ad_source_type' AS "adSourceType",
           l.extra->>'ad_headline' AS "adHeadline", l.extra->>'ad_id' AS "adId", st.kind AS "statusKind",
           (b."uploadedById" IS NOT NULL) AS uploaded, l.extra->>'Meta Date' AS "metaDate"
    FROM "Lead" l
    JOIN "CrmLeadStatus" st ON st.id = l."statusId"
    LEFT JOIN "LeadImportBatch" b ON b.id = l."importBatchId"
    LEFT JOIN "LeadPulseSource" s ON s.id = l."sourceId"
    LEFT JOIN "LeadPulseSource" os ON os.id = l."originalSourceId"
    WHERE st.code <> 'duplicate' AND (
      (l."createdAt" >= (${fromInstant}::timestamptz AT TIME ZONE 'UTC')
        AND (s.code = ANY(${codes}::text[]) OR os.code = ANY(${codes}::text[])
             OR (l.extra->>'ctwa_clid') IS NOT NULL OR (l.extra->>'ad_source_type') IS NOT NULL))
      OR l."partyId" = ANY(${partyIds}::text[])
      OR l.id = ANY(${dealLeadIds}::text[])
    )`);

  const leadById = new Map<string, RoiLead>();
  for (const r of leadRows) {
    const adEvidence = hasAdEvidence(r);
    // An uploaded lead is stamped with the upload's time: use Meta's own date
    // when the upload kept one, else keep it out of the lead counts (as Lead Pulse does).
    const metaInstant = r.uploaded && r.metaDate ? new Date(r.metaDate) : null;
    const dated = !!metaInstant && !isNaN(metaInstant.getTime());
    leadById.set(r.id, {
      id: r.id,
      partyId: r.partyId,
      day: istDateString(dated ? metaInstant! : r.createdAt),
      counted: !r.uploaded || dated,
      sourceCode: r.sourceCode,
      originalSourceCode: r.originalSourceCode,
      adEvidence,
      campaign: campaignLabel({ campaign: r.campaign, adHeadline: r.adHeadline, adId: r.adId, adEvidence }),
      won: r.statusKind === "won",
    });
  }

  // Each candidate's other won deals, to tell a further service from a first enrollment.
  const wins = dealPartyIds.length
    ? await prisma.leadPulsePipeline.findMany({
        where: { status: "closed_won", closedDate: { not: null }, OR: [{ partyId: { in: dealPartyIds } }, { leadLink: { partyId: { in: dealPartyIds } } }] },
        select: { id: true, partyId: true, closedDate: true, leadLink: { select: { partyId: true } } },
      })
    : [];
  const winsByParty = new Map<string, Array<{ id: string; day: string }>>();
  for (const w of wins) {
    const party = w.partyId ?? w.leadLink?.partyId;
    if (!party || !w.closedDate) continue;
    const list = winsByParty.get(party) ?? [];
    list.push({ id: w.id, day: fromPrismaDate(w.closedDate) });
    winsByParty.set(party, list);
  }

  const parties = partyIds.length
    ? await prisma.party.findMany({ where: { id: { in: partyIds } }, select: { id: true, source: { select: { code: true } } } })
    : [];

  const verification = (s: string | undefined): Verification => (s === undefined ? "none" : s === "verified" ? "verified" : "pending");
  const enrollments: RoiEnrollment[] = deals.flatMap((d) => {
    if (!d.closedDate) return [];
    const lead = d.leadLink ? leadById.get(d.leadLink.id) : undefined;
    const day = fromPrismaDate(d.closedDate);
    const party = dealParty(d);
    const earlierWin = !!party && (winsByParty.get(party) ?? []).some((w) => w.id !== d.id && (w.day < day || (w.day === day && w.id < d.id)));
    return [
      {
        day,
        partyId: party,
        earlierWin,
        // The lead says how the candidate came in; a deal without one has only its own source.
        sourceCode: lead?.sourceCode ?? d.source.code,
        originalSourceCode: lead?.originalSourceCode ?? null,
        adEvidence: lead?.adEvidence ?? false,
        verification: verification(d.enrollments[0]?.status),
      },
    ];
  });

  return {
    today,
    months,
    spend: spendRows.map((s) => ({ day: fromPrismaDate(s.date), amount: Number(s.amount) })),
    manualSpend: Object.fromEntries(manualRows.map((m) => [`${m.year}-${String(m.month).padStart(2, "0")}`, m.amount])),
    payments,
    priorSaleParties,
    refunds: refundRows.map((r) => ({ partyId: r.partyId!, day: fromPrismaDate(r.date), amount: Number(r.amount) })),
    leads: [...leadById.values()],
    partySourceCode: Object.fromEntries(parties.map((p) => [p.id, p.source?.code ?? null])),
    enrollments,
  };
}

function addDaysIso(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
