/**
 * Loads the three fact sets behind /executive/sales-analysis for a window
 * (`from` → `to`, inclusive IST days — the caller passes the previous period's
 * start as `from` so the deltas come for free). See `sales-analysis.ts` for the
 * engine and the meaning of each fact.
 *
 * Attribution rules, decided once here so every cut agrees:
 *   - Enrollment BDE / source / service = the closed-won deal's own owner,
 *     source and service (what the Lead Pulse dashboards count); the lead
 *     supplies everything else (qualification, country, campaign, …).
 *   - Collection BDE = the owner of the candidate's most recent closed-won
 *     deal, else the candidate's assigned L2 BDE, else the lead's assignee.
 *     Collection service = the finance sub-item's service, else the lead's.
 *   - Lead BDE = the current assignee.
 */
import { prisma } from "./prisma";
import {
  STORED_DIMS,
  FACT_COLLECTION,
  FACT_ENROLLMENT,
  FACT_LEAD,
  UNKNOWN,
  closeSpeedBucket,
  encodeFact,
  istDay,
  utcDay,
  type Dicts,
  type StoredDim,
  type WireFact,
} from "./sales-analysis";

export type SalesAnalysisPayload = {
  dicts: Dicts;
  facts: WireFact[];
};

/** Interns labels per dimension; -1 is reserved for "not applicable". */
class Dictionary {
  private readonly maps = new Map<StoredDim, Map<string, number>>();
  readonly dicts = Object.fromEntries(STORED_DIMS.map((d) => [d, [] as string[]])) as Dicts;

  id(dim: StoredDim, label: string | null | undefined): number {
    const text = label?.trim() || UNKNOWN;
    let m = this.maps.get(dim);
    if (!m) this.maps.set(dim, (m = new Map()));
    let i = m.get(text);
    if (i === undefined) {
      i = this.dicts[dim].length;
      this.dicts[dim].push(text);
      m.set(text, i);
    }
    return i;
  }
}

const NA = -1;

/** Title-case free-text values so "india" and "India" land in one bucket. */
function tidy(v: string | null | undefined): string | null {
  const t = v?.trim();
  if (!t) return null;
  return t
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function revenueCategory(category: string): string {
  if (/^sales\b/i.test(category)) return "Sales (new booking)";
  if (/^collection\b/i.test(category)) return "Collection (instalment)";
  return category || UNKNOWN;
}

function market(expDom: string | null): string {
  if (expDom === "EXP") return "Export";
  if (expDom === "DOM") return "Domestic";
  return UNKNOWN;
}

export async function loadSalesAnalysis(opts: { from: string; to: string }): Promise<SalesAnalysisPayload> {
  const fromDate = new Date(`${opts.from}T00:00:00.000Z`);
  const toDate = new Date(`${opts.to}T00:00:00.000Z`);
  const toExclusive = new Date(toDate.getTime() + 86_400_000);
  // Lead.createdAt is an instant; the window is IST days.
  const istFrom = new Date(fromDate.getTime() - 330 * 60_000);
  const istTo = new Date(toExclusive.getTime() - 330 * 60_000);

  const leadSelect = {
    createdAt: true,
    sourceId: true,
    originalSourceId: true,
    assignedToId: true,
    serviceId: true,
    country: true,
    studyDestination: true,
    campaign: true,
    temperature: true,
    expectedValue: true,
    qualification: { select: { label: true } },
    qualificationOther: true,
  } as const;

  const [sources, services, users, roles, enrollments, revenue, leads] = await Promise.all([
    prisma.leadPulseSource.findMany({ select: { id: true, code: true, label: true } }),
    prisma.service.findMany({ select: { id: true, name: true, weight: true, group: { select: { name: true } } } }),
    prisma.user.findMany({ select: { id: true, username: true } }),
    prisma.leadPulseRole.findMany({ select: { userId: true, displayName: true } }),
    prisma.leadPulsePipeline.findMany({
      where: { status: "closed_won", closedDate: { gte: fromDate, lte: toDate } },
      select: {
        closedDate: true,
        userId: true,
        sourceId: true,
        serviceId: true,
        partyId: true,
        expectedFirstInstallment: true,
        leadLink: { select: leadSelect },
      },
    }),
    prisma.transaction.findMany({
      where: { type: "Revenue", deletedAt: null, date: { gte: fromDate, lt: toExclusive } },
      select: { date: true, category: true, subItem: true, paymentMode: true, expDom: true, amount: true, partyId: true },
    }),
    prisma.lead.findMany({
      where: { createdAt: { gte: istFrom, lt: istTo }, status: { code: { not: "duplicate" } } },
      select: leadSelect,
    }),
  ]);

  // ── Candidate-level lookups for the money side ──
  const partyIds = [
    ...new Set([...enrollments.map((e) => e.partyId), ...revenue.map((r) => r.partyId)].filter((x): x is string => !!x)),
  ];
  const [partyServices, parties, partyLeads, partyDeals, subItems] = await Promise.all([
    partyIds.length
      ? prisma.partyService.findMany({ where: { partyId: { in: partyIds } }, select: { partyId: true, serviceId: true, totalAmount: true } })
      : Promise.resolve([]),
    partyIds.length
      ? prisma.party.findMany({ where: { id: { in: partyIds } }, select: { id: true, sourceId: true, assignedL2BdeId: true } })
      : Promise.resolve([]),
    partyIds.length
      ? prisma.lead.findMany({ where: { partyId: { in: partyIds } }, orderBy: { createdAt: "desc" }, select: { ...leadSelect, partyId: true } })
      : Promise.resolve([]),
    partyIds.length
      ? prisma.leadPulsePipeline.findMany({
          where: { partyId: { in: partyIds }, status: "closed_won" },
          orderBy: { closedDate: "desc" },
          select: { partyId: true, userId: true, sourceId: true },
        })
      : Promise.resolve([]),
    prisma.subCategory.findMany({ where: { serviceId: { not: null } }, select: { name: true, serviceId: true, category: { select: { name: true } } } }),
  ]);

  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const serviceById = new Map(services.map((s) => [s.id, s]));
  const roleName = new Map(roles.map((r) => [r.userId, r.displayName]));
  const userName = new Map(users.map((u) => [u.id, roleName.get(u.id) ?? u.username]));
  const packageValue = new Map(partyServices.map((p) => [`${p.partyId}:${p.serviceId}`, Number(p.totalAmount)]));
  const partyById = new Map(parties.map((p) => [p.id, p]));
  const leadByParty = new Map<string, (typeof partyLeads)[number]>();
  for (const l of partyLeads) if (l.partyId && !leadByParty.has(l.partyId)) leadByParty.set(l.partyId, l);
  const dealByParty = new Map<string, (typeof partyDeals)[number]>();
  for (const d of partyDeals) if (d.partyId && !dealByParty.has(d.partyId)) dealByParty.set(d.partyId, d);
  const serviceBySubItem = new Map(subItems.map((s) => [`${s.category.name}::${s.name}`, s.serviceId!]));
  const existingCandidateIds = new Set(sources.filter((s) => s.code === "existing_candidate").map((s) => s.id));

  const dict = new Dictionary();
  const slot = (dim: StoredDim) => STORED_DIMS.indexOf(dim);
  const blank = () => STORED_DIMS.map(() => NA);

  type LeadAttrs = Pick<(typeof leads)[number], keyof typeof leadSelect>;

  /** Fill the dims every fact type can know from a lead. */
  const fillLeadDims = (dims: number[], lead: LeadAttrs | null | undefined) => {
    const qual = lead?.qualification?.label;
    dims[slot("qualification")] = dict.id(
      "qualification",
      qual && /^others?$/i.test(qual) && lead?.qualificationOther ? `Others: ${tidy(lead.qualificationOther)}` : qual,
    );
    dims[slot("country")] = dict.id("country", tidy(lead?.country));
    dims[slot("destination")] = dict.id("destination", tidy(lead?.studyDestination));
    dims[slot("campaign")] = dict.id("campaign", lead?.campaign);
    dims[slot("temperature")] = dict.id("temperature", tidy(lead?.temperature));
  };

  const fillSource = (dims: number[], sourceId: string | null | undefined, originalSourceId: string | null | undefined) => {
    dims[slot("source")] = dict.id("source", sourceId ? sourceById.get(sourceId)?.label : null);
    const repeat = !!originalSourceId || (!!sourceId && existingCandidateIds.has(sourceId));
    dims[slot("originalSource")] = dict.id("originalSource", sourceById.get(originalSourceId ?? sourceId ?? "")?.label);
    dims[slot("customerType")] = dict.id("customerType", repeat ? "Repeat (existing candidate)" : "New candidate");
  };

  const fillService = (dims: number[], serviceId: string | null | undefined) => {
    const svc = serviceId ? serviceById.get(serviceId) : undefined;
    dims[slot("service")] = dict.id("service", svc?.name);
    dims[slot("serviceGroup")] = dict.id("serviceGroup", svc ? (svc.group?.name ?? svc.name) : null);
  };

  const facts: WireFact[] = [];

  // ── Enrollments ──
  for (const e of enrollments) {
    if (!e.closedDate) continue;
    const dims = blank();
    const lead = e.leadLink;
    fillSource(dims, e.sourceId, lead?.originalSourceId);
    fillService(dims, e.serviceId);
    dims[slot("bde")] = dict.id("bde", userName.get(e.userId));
    fillLeadDims(dims, lead);
    const day = utcDay(e.closedDate);
    dims[slot("closeSpeed")] = lead ? dict.id("closeSpeed", closeSpeedBucket(Math.max(0, day - istDay(lead.createdAt)))) : dict.id("closeSpeed", UNKNOWN);
    const pkg = e.partyId ? packageValue.get(`${e.partyId}:${e.serviceId}`) : undefined;
    const booked = pkg && pkg > 0 ? pkg : Number(lead?.expectedValue ?? 0) || Number(e.expectedFirstInstallment);
    facts.push(
      encodeFact({
        kind: FACT_ENROLLMENT,
        day,
        dims,
        weight: serviceById.get(e.serviceId)?.weight ?? 1,
        booked,
        amount: 0,
      }),
    );
  }

  // ── Collections ──
  for (const r of revenue) {
    const dims = blank();
    const party = r.partyId ? partyById.get(r.partyId) : undefined;
    const lead = r.partyId ? leadByParty.get(r.partyId) : undefined;
    const deal = r.partyId ? dealByParty.get(r.partyId) : undefined;
    fillSource(dims, deal?.sourceId ?? lead?.sourceId ?? party?.sourceId, lead?.originalSourceId);
    fillService(dims, serviceBySubItem.get(`${r.category}::${r.subItem}`) ?? lead?.serviceId);
    const bdeId = deal?.userId ?? party?.assignedL2BdeId ?? lead?.assignedToId;
    dims[slot("bde")] = dict.id("bde", bdeId ? userName.get(bdeId) : null);
    fillLeadDims(dims, lead);
    dims[slot("revenueCategory")] = dict.id("revenueCategory", revenueCategory(r.category));
    dims[slot("paymentMode")] = dict.id("paymentMode", r.paymentMode);
    dims[slot("market")] = dict.id("market", market(r.expDom));
    facts.push(encodeFact({ kind: FACT_COLLECTION, day: utcDay(r.date), dims, weight: 0, booked: 0, amount: Number(r.amount) }));
  }

  // ── Leads ──
  for (const l of leads) {
    const dims = blank();
    fillSource(dims, l.sourceId, l.originalSourceId);
    fillService(dims, l.serviceId);
    dims[slot("bde")] = dict.id("bde", l.assignedToId ? userName.get(l.assignedToId) : "Unassigned");
    fillLeadDims(dims, l);
    facts.push(encodeFact({ kind: FACT_LEAD, day: istDay(l.createdAt), dims, weight: 0, booked: 0, amount: 0 }));
  }

  return { dicts: dict.dicts, facts };
}
