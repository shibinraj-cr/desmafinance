import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./prisma";
import type { Permissions } from "./rbac";
import { canSeePage, isAdmin } from "./rbac";
import { getCurrentUserAndPermissions } from "./permissions";
import { badRequest, conflict, unauthorized, forbidden } from "./http-error";
import { fromPrismaDate, toPrismaDate } from "./lead-pulse-dates";
import { LEDGER_FIRST_FY, currentFy } from "./fiscal-year";
import {
  CAMPAIGN_TYPES,
  MARKETING_CATEGORY,
  MKT_PLANNER_HREF,
  attributeLedgerRow,
  campaignMoney,
  commitmentMonth,
  countsAsPlanned,
  displayStatus,
  fyFirstDay,
  fyLastDay,
  fyMonthOfDay,
  fyProgress,
  paceOf,
  pctOf,
  planToDate,
  prorateBudget,
  subItemChannelMap,
  type Attribution,
  type CampaignMoney,
  type CampaignStatus,
  type CampaignSummaryDto,
  type CampaignType,
  type CampaignWindow,
  type ChannelDto,
  type Pace,
} from "./mkt-planner-shared";

/**
 * Marketing & Branding Planner — server helpers. The pure vocabulary and maths
 * live in ./mkt-planner-shared (client-safe); this module re-exports them.
 */
export * from "./mkt-planner-shared";

/**
 * Same access pattern as the Media Planner: not adminOnly, gated by an explicit
 * page grant so the Marketing Admin role can plan without full admin. Deciding
 * money — approving campaigns and reallocations, editing the allocation grid,
 * mapping channels — stays with Admins (`canDecideMarketingBudget`).
 */
export function canUseMarketingPlanner(perms: Permissions | null | undefined): boolean {
  if (!perms) return false;
  return isAdmin(perms) || canSeePage(perms, MKT_PLANNER_HREF);
}

export function canDecideMarketingBudget(perms: Permissions | null | undefined): boolean {
  return isAdmin(perms);
}

/**
 * Fiscal years the planner offers, newest first: the ledger's first year up to
 * the NEXT one, because next year's budget gets planned before it starts.
 */
export function plannerFys(now: Date = new Date()): number[] {
  const out: number[] = [];
  for (let y = currentFy(now) + 1; y >= LEDGER_FIRST_FY; y--) out.push(y);
  return out;
}

/** Reads `?fy=`, falling back to the running fiscal year. */
export function parsePlannerFy(raw: string | undefined, now: Date = new Date()): number {
  const n = Number(raw);
  return Number.isInteger(n) && plannerFys(now).includes(n) ? n : currentFy(now);
}

/** API guard: the caller's id and whether they hold budget authority. */
export async function requirePlannerApi(): Promise<{ userId: string; admin: boolean }> {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!canUseMarketingPlanner(perms)) throw forbidden();
  return { userId, admin: canDecideMarketingBudget(perms) };
}

/** API guard for the budget-authority actions. */
export async function requirePlannerAdmin(): Promise<{ userId: string }> {
  const { userId, admin } = await requirePlannerApi();
  if (!admin) throw forbidden();
  return { userId };
}

/** Append a line to a campaign's activity trail. Never fails the caller. */
export async function logCampaignEvent(campaignId: string, userId: string | null, text: string): Promise<void> {
  try {
    await prisma.mktCampaignEvent.create({ data: { campaignId, userId, text } });
  } catch (e) {
    console.error("[mkt-planner] failed to log campaign event:", e);
  }
}

/** Active Admins — the people who decide campaign approvals and reallocations. */
export async function plannerApproverIds(): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { isActive: true, roleRef: { is: { isAdmin: true } } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * In-app notification to each recipient except the actor (nobody needs telling
 * about their own click). Best-effort: a failed write never fails the action.
 */
export async function notifyPlanner(
  recipients: (string | null | undefined)[],
  actorId: string | null,
  n: { kind: string; title: string; body: string; linkUrl: string },
): Promise<void> {
  const ids = Array.from(new Set(recipients.filter((id): id is string => !!id && id !== actorId)));
  if (!ids.length) return;
  try {
    await prisma.crmNotification.createMany({ data: ids.map((userId) => ({ userId, ...n })) });
  } catch (e) {
    console.error("[mkt-planner] failed to write notifications:", e);
  }
}

// ── Campaign input ─────────────────────────────────────────────────────────

export const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
/** Whole rupees, up to ₹100 crore — far beyond any single marketing line. */
export const rupees = z.number().int().min(0).max(1_000_000_000);

const optText = (max: number) => z.string().trim().max(max).nullable().optional();

export const campaignFieldsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(CAMPAIGN_TYPES),
  channelId: z.string().min(1).nullable().optional(),
  ownerId: z.string().min(1).nullable().optional(),
  startDate: z.string().regex(DATE_RX).nullable().optional(),
  endDate: z.string().regex(DATE_RX).nullable().optional(),
  budget: rupees.optional(),
  code: optText(80),
  brief: optText(4000),
  audience: optText(300),
  services: optText(300),
  targetLeads: z.number().int().min(0).max(10_000_000).nullable().optional(),
  targetEnrollments: z.number().int().min(0).max(10_000_000).nullable().optional(),
});
export type CampaignFields = z.infer<typeof campaignFieldsSchema>;

/** Blank text means "clear it". */
export function blankToNull(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  return v && v.trim() ? v.trim() : null;
}

/**
 * Cross-field and cross-table checks for a campaign write: the end can't come
 * before the start, the channel and owner must exist (owner active), and the
 * CRM campaign code can't already belong to another campaign — compared
 * case-insensitively, the same way leads are matched to it.
 */
export async function checkCampaignRefs(
  merged: { startDate: string | null; endDate: string | null },
  data: Partial<CampaignFields>,
  selfId?: string,
): Promise<void> {
  if (merged.endDate && !merged.startDate) {
    throw badRequest("Set a start date before an end date.", "bad_dates");
  }
  if (merged.startDate && merged.endDate && merged.endDate < merged.startDate) {
    throw badRequest("The end date is before the start date.", "bad_dates");
  }
  if (data.channelId) {
    const ch = await prisma.mktChannel.findUnique({ where: { id: data.channelId }, select: { id: true } });
    if (!ch) throw badRequest("That channel no longer exists.", "bad_channel");
  }
  if (data.ownerId) {
    const u = await prisma.user.findUnique({ where: { id: data.ownerId }, select: { isActive: true } });
    if (!u?.isActive) throw badRequest("The selected owner is not an active user.", "bad_owner");
  }
  const code = blankToNull(data.code);
  if (code) {
    const clash = await prisma.mktCampaign.findFirst({
      where: { code: { equals: code, mode: "insensitive" }, ...(selfId ? { id: { not: selfId } } : {}) },
      select: { name: true },
    });
    if (clash) throw conflict(`The CRM campaign code "${code}" is already used by "${clash.name}".`, "code_taken");
  }
}

// ── Channels & allocations ─────────────────────────────────────────────────

export async function loadChannels(): Promise<ChannelDto[]> {
  const rows = await prisma.mktChannel.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    sortOrder: c.sortOrder,
    ledgerSubItems: c.ledgerSubItems,
    leadSourceIds: c.leadSourceIds,
    active: c.active,
  }));
}

/** channelId → twelve monthly amounts (Apr … Mar) for one FY. */
export async function loadAllocations(fy: number): Promise<Record<string, number[]>> {
  const rows = await prisma.mktBudgetAllocation.findMany({ where: { fy } });
  const out: Record<string, number[]> = {};
  for (const r of rows) {
    if (r.monthIdx < 0 || r.monthIdx > 11) continue;
    (out[r.channelId] ??= Array(12).fill(0))[r.monthIdx] = r.amount;
  }
  return out;
}

// ── Ledger ─────────────────────────────────────────────────────────────────

export type LedgerRowDto = {
  id: string;
  date: string;
  subItem: string;
  description: string | null;
  paymentMode: string;
  partyName: string | null;
  amount: number;
  tag: { campaignId: string | null; lineId: string | null } | null;
  attr: Attribution;
};

/** Marketing expense rows dated inside [from, to], newest first. Ledger rows are finance's; read-only here. */
async function loadLedgerRows(from: string, to: string): Promise<Omit<LedgerRowDto, "attr">[]> {
  const rows = await prisma.transaction.findMany({
    where: {
      type: "Expense",
      category: MARKETING_CATEGORY,
      deletedAt: null,
      date: { gte: toPrismaDate(from), lte: toPrismaDate(to) },
    },
    select: {
      id: true,
      date: true,
      subItem: true,
      description: true,
      paymentMode: true,
      amount: true,
      party: { select: { name: true } },
      mktSpendTag: { select: { campaignId: true, lineId: true } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    date: fromPrismaDate(r.date),
    subItem: r.subItem,
    description: r.description,
    paymentMode: r.paymentMode,
    partyName: r.party?.name ?? null,
    amount: Math.round(Number(r.amount.toString())),
    tag: r.mktSpendTag ? { campaignId: r.mktSpendTag.campaignId, lineId: r.mktSpendTag.lineId } : null,
  }));
}

/** Approved/done campaigns whose dates touch [from, to] — the auto-attribution candidates. */
async function loadAttributionWindows(from: string, to: string): Promise<CampaignWindow[]> {
  const rows = await prisma.mktCampaign.findMany({
    where: {
      status: { in: ["approved", "done"] },
      startDate: { not: null, lte: toPrismaDate(to) },
      OR: [{ endDate: { gte: toPrismaDate(from) } }, { endDate: null, startDate: { gte: toPrismaDate(from) } }],
    },
    select: { id: true, channelId: true, status: true, startDate: true, endDate: true },
  });
  return rows.map((c) => ({
    id: c.id,
    channelId: c.channelId,
    status: c.status,
    startDate: c.startDate ? fromPrismaDate(c.startDate) : null,
    endDate: c.endDate ? fromPrismaDate(c.endDate) : null,
  }));
}

/** Ledger rows in a window, each attributed to a channel and (maybe) a campaign. */
export async function loadAttributedLedger(
  from: string,
  to: string,
  channels: ChannelDto[],
): Promise<LedgerRowDto[]> {
  const [rows, windows] = await Promise.all([loadLedgerRows(from, to), loadAttributionWindows(from, to)]);
  const map = subItemChannelMap(channels);
  return rows.map((r) => ({ ...r, attr: attributeLedgerRow(r, map, windows) }));
}

// ── Campaigns ──────────────────────────────────────────────────────────────

const campaignSummarySelect = {
  id: true,
  name: true,
  type: true,
  status: true,
  channelId: true,
  channel: { select: { name: true } },
  ownerId: true,
  owner: { select: { username: true } },
  startDate: true,
  endDate: true,
  budget: true,
  code: true,
} satisfies Prisma.MktCampaignSelect;

type CampaignSummaryRow = Prisma.MktCampaignGetPayload<{ select: typeof campaignSummarySelect }>;

export function toCampaignSummary(c: CampaignSummaryRow, today: string): CampaignSummaryDto {
  const startDate = c.startDate ? fromPrismaDate(c.startDate) : null;
  const endDate = c.endDate ? fromPrismaDate(c.endDate) : null;
  return {
    id: c.id,
    name: c.name,
    type: c.type as CampaignType,
    status: c.status as CampaignStatus,
    display: displayStatus(c.status, startDate, endDate, today),
    channelId: c.channelId,
    channelName: c.channel?.name ?? null,
    ownerId: c.ownerId,
    ownerName: c.owner?.username ?? null,
    startDate,
    endDate,
    budget: c.budget,
    code: c.code,
  };
}

/**
 * Campaigns relevant to one FY: anything whose dates touch it, every undated
 * idea, and anything awaiting approval (an approver needs to see the request
 * whatever its dates).
 */
export async function loadFyCampaigns(fy: number, today: string): Promise<CampaignSummaryDto[]> {
  const from = toPrismaDate(fyFirstDay(fy));
  const to = toPrismaDate(fyLastDay(fy));
  const rows = await prisma.mktCampaign.findMany({
    where: {
      OR: [
        { startDate: null },
        { status: "awaiting" },
        { startDate: { lte: to }, OR: [{ endDate: { gte: from } }, { endDate: null, startDate: { gte: from } }] },
      ],
    },
    select: campaignSummarySelect,
    orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((c) => toCampaignSummary(c, today));
}

/**
 * Money position for each campaign, from its lines, commitments and the
 * payments attributed to it. `ledger` must already hold the window's attributed
 * rows; payments tagged to these campaigns but dated outside the window are
 * fetched here so a campaign straddling the FY boundary still adds up.
 */
async function moneyForCampaigns(
  ids: string[],
  budgets: Map<string, number>,
  ledger: LedgerRowDto[],
  window: { from: string; to: string },
): Promise<{ money: Map<string, CampaignMoney>; dueMonthByKey: Map<string, string | null> }> {
  const money = new Map<string, CampaignMoney>();
  const dueMonthByKey = new Map<string, string | null>();
  if (!ids.length) return { money, dueMonthByKey };

  const [lines, commitments, outside] = await Promise.all([
    prisma.mktBudgetLine.findMany({ where: { campaignId: { in: ids } }, select: { id: true, campaignId: true, planned: true } }),
    prisma.mktCommitment.findMany({
      where: { campaignId: { in: ids }, status: "open" },
      select: { campaignId: true, lineId: true, amount: true, status: true, dueDate: true },
    }),
    prisma.mktSpendTag.findMany({
      where: {
        campaignId: { in: ids },
        transaction: {
          deletedAt: null,
          OR: [{ date: { lt: toPrismaDate(window.from) } }, { date: { gt: toPrismaDate(window.to) } }],
        },
      },
      select: { campaignId: true, lineId: true, transaction: { select: { amount: true } } },
    }),
  ]);

  const payments = new Map<string, { lineId: string | null; amount: number }[]>();
  for (const r of ledger) {
    if (!r.attr.campaignId) continue;
    (payments.get(r.attr.campaignId) ?? payments.set(r.attr.campaignId, []).get(r.attr.campaignId)!).push({
      lineId: r.attr.lineId,
      amount: r.amount,
    });
  }
  for (const t of outside) {
    if (!t.campaignId) continue;
    (payments.get(t.campaignId) ?? payments.set(t.campaignId, []).get(t.campaignId)!).push({
      lineId: t.lineId,
      amount: Math.round(Number(t.transaction.amount.toString())),
    });
  }

  for (const id of ids) {
    const cs = commitments.filter((c) => c.campaignId === id);
    money.set(
      id,
      campaignMoney({
        budget: budgets.get(id) ?? 0,
        lines: lines.filter((l) => l.campaignId === id),
        commitments: cs,
        payments: payments.get(id) ?? [],
      }),
    );
    // The month a line's unpaid commitment lands in: its latest open due date.
    for (const c of cs) {
      const key = `${id}|${c.lineId ?? ""}`;
      const due = c.dueDate ? fromPrismaDate(c.dueDate) : null;
      const prev = dueMonthByKey.get(key);
      if (prev === undefined || (due && (!prev || due > prev))) dueMonthByKey.set(key, due);
    }
  }
  return { money, dueMonthByKey };
}

// ── CRM return ─────────────────────────────────────────────────────────────

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Leads created (IST) inside an FY and closed-won pipelines closed inside it, per lead source. */
async function leadReturnBySource(
  fy: number,
  sourceIds: string[],
): Promise<{ leads: Map<string, number>; enrolled: Map<string, number> }> {
  const leads = new Map<string, number>();
  const enrolled = new Map<string, number>();
  if (!sourceIds.length) return { leads, enrolled };
  const from = new Date(Date.UTC(fy, 3, 1) - IST_OFFSET_MS);
  const to = new Date(Date.UTC(fy + 1, 3, 1) - IST_OFFSET_MS);
  const [leadRows, wonRows] = await Promise.all([
    prisma.lead.groupBy({
      by: ["sourceId"],
      where: { createdAt: { gte: from, lt: to }, sourceId: { in: sourceIds }, status: { code: { not: "duplicate" } } },
      _count: { _all: true },
    }),
    prisma.leadPulsePipeline.groupBy({
      by: ["sourceId"],
      where: {
        status: "closed_won",
        closedDate: { gte: toPrismaDate(fyFirstDay(fy)), lte: toPrismaDate(fyLastDay(fy)) },
        sourceId: { in: sourceIds },
      },
      _count: { _all: true },
    }),
  ]);
  for (const r of leadRows) if (r.sourceId) leads.set(r.sourceId, r._count._all);
  for (const r of wonRows) enrolled.set(r.sourceId, r._count._all);
  return { leads, enrolled };
}

/** CRM leads carrying a campaign code, and how many of them enrolled. */
export async function campaignLeadReturn(code: string | null): Promise<{ leads: number; enrolled: number } | null> {
  if (!code) return null;
  const match = { campaign: { equals: code, mode: "insensitive" as const } };
  const [leads, enrolled] = await Promise.all([
    prisma.lead.count({ where: { ...match, status: { code: { not: "duplicate" } } } }),
    prisma.lead.count({ where: { ...match, pipeline: { status: "closed_won" } } }),
  ]);
  return { leads, enrolled };
}

// ── FY snapshot ────────────────────────────────────────────────────────────

export const UNMAPPED_CHANNEL_ID = "__unmapped__";

export type ChannelRowDto = {
  id: string;
  name: string;
  ledgerSubItems: string[];
  hasLeadSources: boolean;
  budget: number;
  monthly: number[];
  spentMonthly: number[];
  spent: number;
  committed: number;
  left: number;
  spentPct: number;
  commPct: number;
  planToDate: number;
  pace: Pace;
  leads: number | null;
  enrolled: number | null;
};

export type FySnapshot = {
  fy: number;
  today: string;
  progress: ReturnType<typeof fyProgress>;
  channels: ChannelDto[];
  channelRows: ChannelRowDto[];
  planMonthly: number[];
  spentMonthly: number[];
  committedMonthly: number[];
  totals: { budget: number; spent: number; committed: number; available: number };
  ledger: LedgerRowDto[];
  campaigns: CampaignSummaryDto[];
  money: Record<string, { paid: number; committedUnpaid: number; uncommitted: number; over: number }>;
  lineNames: Record<string, string>;
  leadTotals: { leads: number; enrolled: number; anyMapped: boolean };
};

/**
 * Everything the Overview, Planner and Budget pages read for one FY, computed
 * once: allocations, ledger spend by channel and month, unpaid commitments by
 * the month they fall due, pace, and CRM return per channel.
 */
export async function loadFySnapshot(fy: number, today: string): Promise<FySnapshot> {
  const from = fyFirstDay(fy);
  const to = fyLastDay(fy);
  const channels = await loadChannels();
  const [alloc, ledger, campaigns] = await Promise.all([
    loadAllocations(fy),
    loadAttributedLedger(from, to, channels),
    loadFyCampaigns(fy, today),
  ]);
  const progress = fyProgress(fy, today);

  // Commitments live on campaigns of any date; take every campaign that still
  // holds an open one, plus this FY's, so nothing promised drops off the chart.
  const withOpen = await prisma.mktCommitment.findMany({
    where: { status: "open", campaign: { status: { not: "cancelled" } } },
    select: { campaignId: true },
    distinct: ["campaignId"],
  });
  const extraIds = withOpen.map((c) => c.campaignId).filter((id) => !campaigns.some((c) => c.id === id));
  const extra = extraIds.length
    ? await prisma.mktCampaign.findMany({ where: { id: { in: extraIds } }, select: campaignSummarySelect })
    : [];
  const allCampaigns = [...campaigns, ...extra.map((c) => toCampaignSummary(c, today))];
  const live = allCampaigns.filter((c) => c.status !== "cancelled");

  const { money, dueMonthByKey } = await moneyForCampaigns(
    live.map((c) => c.id),
    new Map(live.map((c) => [c.id, c.budget])),
    ledger,
    { from, to },
  );

  const lineIds = new Set<string>();
  for (const r of ledger) if (r.attr.lineId) lineIds.add(r.attr.lineId);
  const lineRows = lineIds.size
    ? await prisma.mktBudgetLine.findMany({ where: { id: { in: Array.from(lineIds) } }, select: { id: true, label: true } })
    : [];

  // Spend by channel × month from the ledger (sub-item mapping is the truth).
  const spentBy = new Map<string, number[]>();
  const spentMonthly = Array(12).fill(0) as number[];
  for (const r of ledger) {
    const m = fyMonthOfDay(r.date);
    spentMonthly[m] += r.amount;
    const key = r.attr.channelId ?? UNMAPPED_CHANNEL_ID;
    (spentBy.get(key) ?? spentBy.set(key, Array(12).fill(0)).get(key)!)[m] += r.amount;
  }

  // Unpaid commitments by channel and by the month they are due.
  const committedBy = new Map<string, number>();
  const committedMonthly = Array(12).fill(0) as number[];
  const campaignChannel = new Map(live.map((c) => [c.id, c.channelId]));
  money.forEach((m, campaignId) => {
    m.byLine.forEach((v, lineId) => {
      if (v.unpaid <= 0) return;
      const due = dueMonthByKey.get(`${campaignId}|${lineId ?? ""}`) ?? null;
      const month = commitmentMonth(due, fy, today);
      if (month === null) return;
      committedMonthly[month] += v.unpaid;
      const ch = campaignChannel.get(campaignId) ?? UNMAPPED_CHANNEL_ID;
      committedBy.set(ch, (committedBy.get(ch) ?? 0) + v.unpaid);
    });
  });

  const sourceIds = Array.from(new Set(channels.flatMap((c) => c.leadSourceIds)));
  const ret = await leadReturnBySource(fy, sourceIds);

  const planMonthly = Array(12).fill(0) as number[];
  const channelRows: ChannelRowDto[] = [];
  const rowFor = (id: string, name: string, subItems: string[], srcIds: string[]): ChannelRowDto => {
    const monthly = alloc[id] ?? Array(12).fill(0);
    const sMonthly = spentBy.get(id) ?? Array(12).fill(0);
    const budget = monthly.reduce((a: number, b: number) => a + b, 0);
    const spent = sMonthly.reduce((a: number, b: number) => a + b, 0);
    const committed = committedBy.get(id) ?? 0;
    const ptd = planToDate(monthly, progress);
    let leads: number | null = null;
    let enrolled: number | null = null;
    if (srcIds.length) {
      leads = srcIds.reduce((a, s) => a + (ret.leads.get(s) ?? 0), 0);
      enrolled = srcIds.reduce((a, s) => a + (ret.enrolled.get(s) ?? 0), 0);
    }
    return {
      id,
      name,
      ledgerSubItems: subItems,
      hasLeadSources: srcIds.length > 0,
      budget,
      monthly,
      spentMonthly: sMonthly,
      spent,
      committed,
      left: budget - spent - committed,
      spentPct: pctOf(spent, budget),
      commPct: pctOf(committed, budget),
      planToDate: ptd,
      pace: paceOf({ budget, spent, committed, planToDate: ptd }),
      leads,
      enrolled,
    };
  };
  for (const ch of channels) {
    const row = rowFor(ch.id, ch.name, ch.ledgerSubItems, ch.leadSourceIds);
    // An inactive channel with nothing against it this year has nothing to say.
    if (!ch.active && row.budget === 0 && row.spent === 0 && row.committed === 0) continue;
    row.monthly.forEach((v, i) => (planMonthly[i] += v));
    channelRows.push(row);
  }
  if (spentBy.has(UNMAPPED_CHANNEL_ID) || committedBy.has(UNMAPPED_CHANNEL_ID)) {
    channelRows.push(rowFor(UNMAPPED_CHANNEL_ID, "Not mapped to a channel", [], []));
  }

  const budget = planMonthly.reduce((a, b) => a + b, 0);
  const spent = spentMonthly.reduce((a, b) => a + b, 0);
  const committed = committedMonthly.reduce((a, b) => a + b, 0);
  const leadTotals = {
    leads: Array.from(ret.leads.values()).reduce((a, b) => a + b, 0),
    enrolled: Array.from(ret.enrolled.values()).reduce((a, b) => a + b, 0),
    anyMapped: sourceIds.length > 0,
  };

  const moneyOut: FySnapshot["money"] = {};
  money.forEach((m, id) => {
    moneyOut[id] = { paid: m.paid, committedUnpaid: m.committedUnpaid, uncommitted: m.uncommitted, over: m.over };
  });

  return {
    fy,
    today,
    progress,
    channels,
    channelRows,
    planMonthly,
    spentMonthly,
    committedMonthly,
    totals: { budget, spent, committed, available: budget - spent - committed },
    ledger,
    campaigns: allCampaigns,
    money: moneyOut,
    lineNames: Object.fromEntries(lineRows.map((l) => [l.id, l.label])),
    leadTotals,
  };
}

/** Planned (non-idea, non-cancelled) campaign budgets prorated into a date range, by status. */
export function plannedInRange(
  campaigns: CampaignSummaryDto[],
  rangeStart: string,
  rangeEnd: string,
): { committedLike: number; awaiting: number; draft: number } {
  const out = { committedLike: 0, awaiting: 0, draft: 0 };
  for (const c of campaigns) {
    if (!countsAsPlanned(c.status)) continue;
    const v = prorateBudget(c.budget, c.startDate, c.endDate, rangeStart, rangeEnd);
    if (!v) continue;
    if (c.status === "awaiting") out.awaiting += v;
    else if (c.status === "draft") out.draft += v;
    else out.committedLike += v;
  }
  return out;
}
