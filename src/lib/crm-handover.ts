/**
 * Lead Handovers — leads the Marketing Admin gives a BDE outside DesGro (a
 * YouTube comment, an Instagram message, a personal WhatsApp, a phone call, a
 * walk-in, a referral).
 * The BDE must create each one in the CRM by the cutoff (crm-cutoff.ts).
 *
 *   H1  On save, a phone that already belongs to a lead → `duplicate`, linked
 *       to that lead. Otherwise `pending`.
 *   H2  A lead created for that BDE with the same phone → `created`, linked, and
 *       the lead's source becomes the handover's channel.
 *   H3  Still pending at the cutoff → `overdue` (it can still be created or
 *       rejected; `isLate` stays set).
 *
 * Phones are matched on the normalised E.164 number every lead dedupe uses.
 * Pure: the DB side is crm-handover-data.ts.
 */
import type { Prisma } from "@prisma/client";
import { normalizePhone } from "./crm";
import { toPrismaDate } from "./lead-pulse-dates";
import { MARKETING_ADMIN_ROLE_NAME } from "./crm-uncontacted-alarm";

/** Where a handover came from, and the lead source a lead created from it gets. */
export const HANDOVER_CHANNELS = [
  { code: "youtube", label: "YouTube", sourceCode: "youtube", sourceLabel: "YouTube" },
  // The same "Insta" source Instagram DM leads get (src/lib/ig/ingest.ts).
  { code: "instagram", label: "Instagram", sourceCode: "insta", sourceLabel: "Insta" },
  { code: "whatsapp_outside", label: "WhatsApp (personal)", sourceCode: "whatsapp_personal", sourceLabel: "WhatsApp (personal)" },
  { code: "phone", label: "Phone call", sourceCode: "phone_direct", sourceLabel: "Phone (direct)" },
  { code: "walk_in", label: "Walk-in", sourceCode: "walk_in", sourceLabel: "Walk-in" },
  { code: "referral", label: "Referral", sourceCode: "candidate_referral", sourceLabel: "Candidate Referral" },
  { code: "other", label: "Other", sourceCode: "other", sourceLabel: "Other" },
] as const;
export type HandoverChannel = (typeof HANDOVER_CHANNELS)[number]["code"];
export const HANDOVER_CHANNEL_CODES = HANDOVER_CHANNELS.map((c) => c.code) as [HandoverChannel, ...HandoverChannel[]];

export function handoverChannel(code: string) {
  return HANDOVER_CHANNELS.find((c) => c.code === code) ?? null;
}

/** How a lead from this channel is grouped in the daily lead report. */
export function handoverGroupLabel(code: string): string {
  return `Handover – ${handoverChannel(code)?.label ?? code}`;
}

export const HANDOVER_REJECT_REASONS = [
  { code: "invalid_number", label: "Invalid number" },
  { code: "not_nurse_lead", label: "Not a nurse lead" },
  { code: "other", label: "Other" },
] as const;
export type HandoverRejectReason = (typeof HANDOVER_REJECT_REASONS)[number]["code"];
export const HANDOVER_REJECT_REASON_CODES = HANDOVER_REJECT_REASONS.map((r) => r.code) as [
  HandoverRejectReason,
  ...HandoverRejectReason[],
];

export const HANDOVER_STATUSES = ["pending", "created", "duplicate", "rejected", "overdue"] as const;
export type HandoverStatus = (typeof HANDOVER_STATUSES)[number];
/** Statuses still waiting on the BDE. */
export const OPEN_HANDOVER_STATUSES: HandoverStatus[] = ["pending", "overdue"];

export function isOpenHandover(status: string): boolean {
  return (OPEN_HANDOVER_STATUSES as string[]).includes(status);
}

/** Most rows one save may carry (the bulk paste grid). */
export const MAX_HANDOVER_ROWS = 200;

// ── Who may do what ──────────────────────────────────────────────────────────

export type HandoverAccess = {
  /** Log, reopen and cancel handovers: the Marketing Admin (and system admins). */
  canManage: boolean;
  /** "all" = every BDE's handovers; "own" = the viewer's; null = none. */
  viewScope: "all" | "own" | null;
};

/**
 * The Marketing Admin is the "Marketing Admin" role or an active Lead Pulse
 * supervisor — the same group the uncontacted alarm and re-inquiry notices use.
 * CRM managers (CRM admin tier, team lead) can read every handover; a BDE sees
 * their own.
 */
export function handoverAccess(input: {
  isAdmin: boolean;
  roleName: string | null | undefined;
  lpRole: { role: string; active: boolean } | null;
  canManageCrm: boolean;
  isCrmTeamLead: boolean;
  isBde: boolean;
}): HandoverAccess {
  const canManage =
    input.isAdmin ||
    input.roleName === MARKETING_ADMIN_ROLE_NAME ||
    (!!input.lpRole?.active && input.lpRole.role === "supervisor");
  const viewAll = canManage || input.canManageCrm || input.isCrmTeamLead;
  return { canManage, viewScope: viewAll ? "all" : input.isBde ? "own" : null };
}

export type HandoverFilters = {
  /** IST day the handovers were given (YYYY-MM-DD). */
  date?: string;
  /** Also include every still-open handover, whatever day it was given. */
  withOpen?: boolean;
  statuses?: string[];
  channels?: string[];
  bdeIds?: string[];
};

/**
 * The list query for a viewer. A BDE only ever gets their own handovers, so a
 * `bdeIds` filter is ignored for them rather than trusted.
 */
export function handoverListWhere(
  access: HandoverAccess,
  userId: string,
  f: HandoverFilters,
): Prisma.CrmLeadHandoverWhereInput | null {
  if (!access.viewScope) return null;
  const and: Prisma.CrmLeadHandoverWhereInput[] = [];
  if (access.viewScope === "own") and.push({ assignedBdeId: userId });
  else if (f.bdeIds?.length) and.push({ assignedBdeId: { in: f.bdeIds } });
  if (f.statuses?.length) and.push({ status: { in: f.statuses } });
  if (f.channels?.length) and.push({ channel: { in: f.channels } });
  if (f.date) {
    const day: Prisma.CrmLeadHandoverWhereInput = { handoverDate: toPrismaDate(f.date) };
    and.push(f.withOpen ? { OR: [day, { status: { in: OPEN_HANDOVER_STATUSES } }] } : day);
  } else if (f.withOpen) {
    and.push({ status: { in: OPEN_HANDOVER_STATUSES } });
  }
  return { AND: and };
}

/** The assigned BDE rejects; the Marketing Admin may cancel one logged by mistake. */
export function canRejectHandover(access: HandoverAccess, userId: string, h: { assignedBdeId: string }): boolean {
  return access.canManage || h.assignedBdeId === userId;
}

// ── Bulk paste ───────────────────────────────────────────────────────────────

export type PastedHandoverRow = { leadName: string | null; phone: string };
export type PasteError = { line: number; text: string; reason: string };

/**
 * Parse the bulk paste grid: one lead per line, "name, phone" or "name<TAB>phone"
 * (as copied from a sheet), either order, or a bare phone number. Lines without
 * a usable number come back as errors rather than being dropped silently.
 */
export function parseHandoverPaste(text: string): { rows: PastedHandoverRow[]; errors: PasteError[] } {
  const rows: PastedHandoverRow[] = [];
  const errors: PasteError[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const cells = line.split(/\t|,|;/).map((c) => c.trim()).filter(Boolean);
    const phoneIdx = cells.findIndex((c) => (c.match(/\d/g) ?? []).length >= 8 && /^[+\d\s()\-.]+$/.test(c));
    if (phoneIdx === -1) {
      errors.push({ line: i + 1, text: line, reason: "No phone number" });
      return;
    }
    const phone = cells[phoneIdx];
    if (!normalizePhone(phone)) {
      errors.push({ line: i + 1, text: line, reason: "Not a valid phone number" });
      return;
    }
    const name = cells.find((_, j) => j !== phoneIdx) ?? null;
    rows.push({ leadName: name, phone });
  });
  return { rows, errors };
}

// ── H1: what each new row becomes ────────────────────────────────────────────

export type HandoverRowPlan =
  | { kind: "pending"; phoneE164: string }
  | { kind: "duplicate"; phoneE164: string; leadId: string }
  | { kind: "error"; reason: string };

/**
 * Decide each row of a save (H1). `leadByPhone` maps a normalised number to the
 * existing lead that owns it (the oldest, as every dedupe picks); `openPhones`
 * holds numbers already waiting in another open handover.
 */
export function planHandoverRows(
  rows: { phone: string }[],
  leadByPhone: ReadonlyMap<string, string>,
  openPhones: ReadonlySet<string>,
): HandoverRowPlan[] {
  const seen = new Set<string>();
  return rows.map((r) => {
    const phoneE164 = normalizePhone(r.phone);
    if (!phoneE164) return { kind: "error", reason: "Not a valid phone number" };
    if (seen.has(phoneE164)) return { kind: "error", reason: "Repeated in this list" };
    seen.add(phoneE164);
    const leadId = leadByPhone.get(phoneE164);
    if (leadId) return { kind: "duplicate", phoneE164, leadId };
    if (openPhones.has(phoneE164)) return { kind: "error", reason: "Already handed over and still open" };
    return { kind: "pending", phoneE164 };
  });
}

/**
 * H2 for a lead that already existed when the handover was saved is H1's job;
 * a lead created after it is the BDE doing the work. Used by the safety-net
 * pass that links leads arriving by other routes (WhatsApp, Voxbay, imports).
 */
export function linkStatusFor(leadCreatedAt: Date, handoverCreatedAt: Date): "created" | "duplicate" {
  return leadCreatedAt.getTime() >= handoverCreatedAt.getTime() ? "created" : "duplicate";
}
