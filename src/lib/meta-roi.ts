/**
 * Meta ROI: does Meta advertising pay back? Pure and client-safe; the facts
 * come from meta-roi-data.ts and the tab is Executive › Sales Analysis ›
 * Meta ROI. Phase 4 of the enrollment → invoice → reconciliation plan
 * (17 Nov 2026), with the director's decisions:
 *
 * Which candidates are Meta. A candidate is acquired by their earliest lead
 * (a re-enrollment lead carries the first channel in `originalSource`):
 *   - Meta: Meta lead forms (`meta`), the old "Insta / FB" import
 *     (`insta_fb`), WhatsApp-API leads (`wabis`: mostly click-to-WhatsApp
 *     ads, so they count in the headline), and any lead whose first message
 *     carried a Meta ad referral (`ctwa_clid` / `ad_source_type` in `extra`).
 *   - Possible Meta: Instagram DM leads (`insta`) with no ad recorded. Shown
 *     on their own line, never added to the headline.
 *   - Everything else is not Meta.
 *
 * Spend. The ledger's Meta advertising entries (Marketing › "Digital
 * Advertisement - Meta"), as paid: the ledger date is when the card was
 * charged, not when the ads ran.
 *
 * Revenue. Finance-approved ledger payments, net of GST, from Meta
 * candidates. Partner commissions are left out (only "Sales …" and
 * "Collection …" categories count). A candidate's first "Sales" payment is
 * the new sale; a later "Sales" payment is a repeat service; "Collection"
 * payments are collections. Refunds booked against a Meta candidate come off.
 *
 * Enrollments. Closed-won deals on their enrollment date (they count at
 * submit); a repeat enrollment never counts as a new one.
 */

export const META_SOURCE_CODES = ["meta", "insta_fb", "wabis"] as const;
export const POSSIBLE_META_SOURCE_CODES = ["insta"] as const;
export const REPEAT_SOURCE_CODE = "existing_candidate";
export const WA_API_SOURCE_CODE = "wabis";
/** Below this many enrollments a ratio is noise: "too few" instead. */
export const MIN_ENROLLMENTS_FOR_RATIO = 3;
/** Cohorts are compared at the same age: cash within this many days of each lead. */
export const COHORT_DAYS = [30, 90, 180] as const;
export type CohortDay = (typeof COHORT_DAYS)[number];
/** The campaign label when a lead carries none. */
export const NO_CAMPAIGN = "(not recorded)";

export type Channel = "meta" | "possible" | "other";

/** How a lead (or a deal's lead) came in. */
export type AcquisitionFacts = {
  sourceCode: string | null;
  /** Set on a re-enrollment lead: the channel the candidate first came from. */
  originalSourceCode: string | null;
  /** The lead's first message carried a Meta ad referral. */
  adEvidence: boolean;
};

export function channelOf(f: AcquisitionFacts): Channel {
  const code = f.originalSourceCode ?? f.sourceCode;
  if (code && (META_SOURCE_CODES as readonly string[]).includes(code)) return "meta";
  if (f.adEvidence) return "meta";
  if (code && (POSSIBLE_META_SOURCE_CODES as readonly string[]).includes(code)) return "possible";
  return "other";
}

/** A further service for an existing candidate, not a new one. */
export const isRepeat = (f: AcquisitionFacts): boolean => f.sourceCode === REPEAT_SOURCE_CODE || !!f.originalSourceCode;

/** A click-to-WhatsApp (or boosted post) referral recorded on the lead — see src/lib/wa/inbound.ts. */
export function hasAdEvidence(extra: { ctwaClid?: string | null; adSourceType?: string | null }): boolean {
  return !!extra.ctwaClid?.trim() || !!extra.adSourceType?.trim();
}

export type RoiLead = AcquisitionFacts & {
  id: string;
  partyId: string | null;
  /** IST day the lead came in. */
  day: string;
  campaign: string;
  /** The lead is enrolled. */
  won: boolean;
};
export type RoiPayment = { id: string; partyId: string; day: string; kind: "sale" | "collection"; net: number };
export type RoiRefund = { partyId: string; day: string; amount: number };
export type RoiSpend = { day: string; amount: number };
export type Verification = "verified" | "pending" | "none";
export type RoiEnrollment = AcquisitionFacts & { day: string; verification: Verification };

export type MetaRoiInput = {
  /** IST today, YYYY-MM-DD. */
  today: string;
  /** The months shown, YYYY-MM, oldest first. */
  months: string[];
  spend: RoiSpend[];
  /** Lead Pulse's hand-entered monthly Meta figure, for reference only. */
  manualSpend: Record<string, number>;
  /** Every candidate payment since the ledger began (to tell a first sale from a repeat). */
  payments: RoiPayment[];
  refunds: RoiRefund[];
  /** The window's Meta-ish leads, plus every lead of a candidate who paid. */
  leads: RoiLead[];
  /** A paying candidate with no lead at all: the source on their record. */
  partySourceCode: Record<string, string | null>;
  /** Closed-won deals dated in the window. */
  enrollments: RoiEnrollment[];
};

export type MonthRow = {
  month: string;
  spend: number;
  manualSpend: number | null;
  newSales: number;
  collections: number;
  repeatSales: number;
  refunds: number;
  /** New sales + collections + repeat sales − refunds. */
  cash: number;
  possibleCash: number;
  leads: number;
  costPerLead: number | null;
  newEnrollments: number;
  verifiedEnrollments: number;
  repeatEnrollments: number;
  possibleEnrollments: number;
  cashRoas: number | null;
  newSaleRoas: number | null;
  costPerEnrollment: number | null;
};

export type Payback = { kind: "paid_back"; month: string; months: number } | { kind: "not_yet"; recoveredPct: number } | null;

export type CohortRow = {
  month: string;
  leads: number;
  enrolled: number;
  spend: number;
  /** Cash within 30 / 90 / 180 days of each lead; null while the cohort is younger than that. */
  cashAt: Record<CohortDay, number | null>;
  roasAt: Record<CohortDay, number | null>;
  cashToDate: number;
  payback: Payback;
};

export type CampaignRow = {
  campaign: string;
  leads: number;
  enrolled: number;
  cash: number;
  /** Null when fewer than MIN_ENROLLMENTS_FOR_RATIO enrolled ("too few"). */
  cashPerEnrollment: number | null;
};

export type MetaRoiReport = {
  months: MonthRow[];
  total: Omit<MonthRow, "month" | "manualSpend">;
  cohorts: CohortRow[];
  campaigns: CampaignRow[];
  /** WA API leads in the window with no ad recorded (counted as Meta by decision). */
  waApiWithoutAd: number;
  /** The newest cohort old enough to read at 90 days. */
  latest90: CohortRow | null;
};

/** Revenue booked as a candidate's payment; anything else (partner commissions) is left out. */
export function paymentKind(category: string): "sale" | "collection" | null {
  if (/^sales\b/i.test(category)) return "sale";
  if (/^collection\b/i.test(category)) return "collection";
  return null;
}

/** The campaign a lead is grouped under: its sheet/form tab, else the WhatsApp ad it came from. */
export function campaignLabel(l: { campaign: string | null; adHeadline: string | null; adId: string | null; adEvidence: boolean }): string {
  const c = l.campaign?.trim();
  if (c) return c;
  if (l.adEvidence) {
    const name = l.adHeadline?.trim() || (l.adId?.trim() ? `id ${l.adId.trim()}` : "");
    return name ? `WhatsApp ad: ${name}` : "WhatsApp ad (unnamed)";
  }
  return NO_CAMPAIGN;
}

// ── helpers ─────────────────────────────────────────────────────────────────

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const ratio = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 100) / 100 : null);
export const monthOf = (day: string) => day.slice(0, 7);

function dayNumber(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}
function plusDays(day: string, n: number): string {
  return new Date((dayNumber(day) + n) * 86_400_000).toISOString().slice(0, 10);
}
export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
/** The months from `from` to `to` (YYYY-MM), oldest first. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

const byDayThenId = <T extends { day: string; id: string }>(a: T, b: T) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id);

// ── the report ──────────────────────────────────────────────────────────────

export function buildMetaRoi(input: MetaRoiInput): MetaRoiReport {
  const { today, months } = input;
  const inWindow = new Set(months);

  // Each candidate's acquisition: their earliest lead.
  const acquisition = new Map<string, RoiLead>();
  for (const l of [...input.leads].sort(byDayThenId)) {
    if (l.partyId && !acquisition.has(l.partyId)) acquisition.set(l.partyId, l);
  }
  const partyChannel = (partyId: string): Channel => {
    const l = acquisition.get(partyId);
    if (l) return channelOf(l);
    return channelOf({ sourceCode: input.partySourceCode[partyId] ?? null, originalSourceCode: null, adEvidence: false });
  };

  // A candidate's first "Sales" payment is the new sale; later ones are repeat services.
  const sawSale = new Set<string>();
  const classified = [...input.payments].sort(byDayThenId).map((p) => {
    let kind: "new" | "repeat" | "collection" = "collection";
    if (p.kind === "sale") {
      kind = sawSale.has(p.partyId) ? "repeat" : "new";
      sawSale.add(p.partyId);
    }
    return { ...p, cls: kind, channel: partyChannel(p.partyId) };
  });
  const refunds = input.refunds.map((r) => ({ ...r, channel: partyChannel(r.partyId) }));

  // ── by calendar month ──
  const blank = (): Omit<MonthRow, "month" | "manualSpend"> => ({
    spend: 0,
    newSales: 0,
    collections: 0,
    repeatSales: 0,
    refunds: 0,
    cash: 0,
    possibleCash: 0,
    leads: 0,
    costPerLead: null,
    newEnrollments: 0,
    verifiedEnrollments: 0,
    repeatEnrollments: 0,
    possibleEnrollments: 0,
    cashRoas: null,
    newSaleRoas: null,
    costPerEnrollment: null,
  });
  const rows = new Map(months.map((m) => [m, blank()]));
  const total = blank();
  const both = (month: string, fn: (r: Omit<MonthRow, "month" | "manualSpend">) => void) => {
    const r = rows.get(month);
    if (!r) return;
    fn(r);
    fn(total);
  };

  for (const s of input.spend) both(monthOf(s.day), (r) => (r.spend += s.amount));
  for (const p of classified) {
    if (p.channel === "possible") both(monthOf(p.day), (r) => (r.possibleCash += p.net));
    if (p.channel !== "meta") continue;
    both(monthOf(p.day), (r) => {
      if (p.cls === "new") r.newSales += p.net;
      else if (p.cls === "repeat") r.repeatSales += p.net;
      else r.collections += p.net;
    });
  }
  for (const f of refunds) {
    if (f.channel === "possible") both(monthOf(f.day), (r) => (r.possibleCash -= f.amount));
    if (f.channel === "meta") both(monthOf(f.day), (r) => (r.refunds += f.amount));
  }
  const windowLeads = input.leads.filter((l) => inWindow.has(monthOf(l.day)) && channelOf(l) === "meta" && !isRepeat(l));
  for (const l of windowLeads) both(monthOf(l.day), (r) => (r.leads += 1));
  for (const e of input.enrollments) {
    const ch = channelOf(e);
    both(monthOf(e.day), (r) => {
      if (ch === "possible" && !isRepeat(e)) r.possibleEnrollments += 1;
      if (ch !== "meta") return;
      if (isRepeat(e)) r.repeatEnrollments += 1;
      else {
        r.newEnrollments += 1;
        if (e.verification === "verified") r.verifiedEnrollments += 1;
      }
    });
  }
  const finish = <T extends Omit<MonthRow, "month" | "manualSpend">>(r: T): T => {
    for (const k of ["spend", "newSales", "collections", "repeatSales", "refunds", "possibleCash"] as const) r[k] = r2(r[k]);
    r.cash = r2(r.newSales + r.collections + r.repeatSales - r.refunds);
    r.cashRoas = ratio(r.cash, r.spend);
    r.newSaleRoas = ratio(r.newSales, r.spend);
    r.costPerEnrollment = r.newEnrollments > 0 && r.spend > 0 ? r2(r.spend / r.newEnrollments) : null;
    r.costPerLead = r.leads > 0 && r.spend > 0 ? r2(r.spend / r.leads) : null;
    return r;
  };
  const monthRows: MonthRow[] = months.map((m) => ({ month: m, manualSpend: input.manualSpend[m] ?? null, ...finish(rows.get(m)!) }));
  finish(total);

  // ── by the month the lead came in ──
  // A candidate's money belongs to their acquisition lead's cohort.
  const cashByParty = new Map<string, Array<{ day: string; amount: number }>>();
  const addCash = (partyId: string, day: string, amount: number) => {
    const list = cashByParty.get(partyId) ?? [];
    list.push({ day, amount });
    cashByParty.set(partyId, list);
  };
  for (const p of classified) addCash(p.partyId, p.day, p.net);
  for (const f of input.refunds) addCash(f.partyId, f.day, -f.amount);
  const acquiredBy = new Map<string, string>(); // lead id → party id
  for (const [partyId, l] of acquisition) acquiredBy.set(l.id, partyId);
  const cashOf = (leadId: string, upTo?: string) =>
    (cashByParty.get(acquiredBy.get(leadId) ?? "") ?? []).reduce((s, c) => (upTo === undefined || c.day <= upTo ? s + c.amount : s), 0);

  const todayMonth = monthOf(today);
  const cohorts: CohortRow[] = months.map((month) => {
    const members = windowLeads.filter((l) => monthOf(l.day) === month);
    const spend = monthRows.find((r) => r.month === month)!.spend;
    const cashAt = {} as Record<CohortDay, number | null>;
    const roasAt = {} as Record<CohortDay, number | null>;
    for (const d of COHORT_DAYS) {
      const old = plusDays(monthEnd(month), d) <= today;
      cashAt[d] = old ? r2(members.reduce((s, l) => s + cashOf(l.id, plusDays(l.day, d)), 0)) : null;
      roasAt[d] = cashAt[d] === null ? null : ratio(cashAt[d]!, spend);
    }
    const cashToDate = r2(members.reduce((s, l) => s + cashOf(l.id), 0));
    let payback: Payback = null;
    if (spend > 0) {
      payback = { kind: "not_yet", recoveredPct: Math.round((cashToDate / spend) * 100) };
      for (let k = 0, m = month; m <= todayMonth; k++, m = addMonths(month, k)) {
        const end = monthEnd(m);
        if (members.reduce((s, l) => s + cashOf(l.id, end), 0) >= spend) {
          payback = { kind: "paid_back", month: m, months: k };
          break;
        }
      }
    }
    return { month, leads: members.length, enrolled: members.filter((l) => l.won).length, spend, cashAt, roasAt, cashToDate, payback };
  });

  // ── by campaign (no campaign-level spend yet, so cash per enrollment, not ROAS) ──
  const groups = new Map<string, CampaignRow>();
  for (const l of windowLeads) {
    const g = groups.get(l.campaign) ?? { campaign: l.campaign, leads: 0, enrolled: 0, cash: 0, cashPerEnrollment: null };
    g.leads += 1;
    if (l.won) g.enrolled += 1;
    g.cash += cashOf(l.id);
    groups.set(l.campaign, g);
  }
  const campaigns = [...groups.values()]
    .map((g) => ({ ...g, cash: r2(g.cash), cashPerEnrollment: g.enrolled >= MIN_ENROLLMENTS_FOR_RATIO ? r2(g.cash / g.enrolled) : null }))
    .sort((a, b) => b.cash - a.cash || b.enrolled - a.enrolled || b.leads - a.leads || a.campaign.localeCompare(b.campaign));

  const waApiWithoutAd = windowLeads.filter((l) => (l.originalSourceCode ?? l.sourceCode) === WA_API_SOURCE_CODE && !l.adEvidence).length;
  const latest90 = [...cohorts].reverse().find((c) => c.cashAt[90] !== null && c.spend > 0) ?? null;

  return { months: monthRows, total, cohorts, campaigns, waApiWithoutAd, latest90 };
}

/** "2.45×", or "—" when there's no spend to divide by. */
export const fmtRoas = (v: number | null): string => (v === null ? "—" : `${v.toFixed(2)}×`);
