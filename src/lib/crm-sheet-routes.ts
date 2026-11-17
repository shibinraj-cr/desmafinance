// Tab routing for the lead spreadsheets: "every lead from THIS tab goes to THAT
// consultant". An admin sets the rules on CRM → Settings → Lead capture; the
// sheet ingest applies them to each batch it takes in.
//
// A rule names ONE tab exactly (the tab name is what the Apps Script sends as
// `campaign`). Matching ignores case and runs of whitespace, because Meta's tab
// names carry stray double spaces that nobody types back faithfully.
import { prisma } from "./prisma";
import { getSetting, SHEET_LEADS_ROUTES_KEY } from "./app-settings";
import { assignLeadTo } from "./crm-assign";
import { recordLeadActivity } from "./crm-activity";
import { logger } from "./logger";

export type SheetRoute = {
  /** SHEET_SOURCES key the rule applies to ("meta", "website"). */
  source: string;
  /** The tab name, as the admin entered it. Compared via `campaignKey`. */
  campaign: string;
  /** Consultant (active L1/L2) who receives the tab's leads. */
  assigneeUserId: string;
  /** Service to set on a routed lead whose service is still blank; null = leave it. */
  serviceId: string | null;
};

export const MAX_SHEET_ROUTES = 50;

/** The comparable form of a tab name: trimmed, single-spaced, lower-case. */
export function campaignKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Read the stored rules. Tolerant by design: a malformed value or entry is
 * dropped, never thrown, because this runs inside the sheet webhook and a
 * throw there would stall the tab's import (the Apps Script retries the same
 * rows forever). The first rule for a source + tab wins.
 */
export function parseSheetRoutes(raw: string | null | undefined): SheetRoute[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const out: SheetRoute[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const source = str(r.source);
    const campaign = str(r.campaign);
    const assigneeUserId = str(r.assigneeUserId);
    if (!source || !campaign || !assigneeUserId) continue;
    const key = source + "|" + campaignKey(campaign);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source, campaign, assigneeUserId, serviceId: str(r.serviceId) });
  }
  return out;
}

/** The rule for this source + tab, or null when the tab isn't routed. */
export function findSheetRoute(routes: SheetRoute[], source: string, campaign: string): SheetRoute | null {
  const key = campaignKey(campaign);
  return routes.find((r) => r.source === source && campaignKey(r.campaign) === key) ?? null;
}

export async function getSheetRoutes(): Promise<SheetRoute[]> {
  const raw = await getSetting(SHEET_LEADS_ROUTES_KEY).catch(() => null);
  return parseSheetRoutes(raw);
}

/**
 * Stages a routed tab's re-enquiry takes a lead out of even when an active
 * consultant owns it: the business wants candidates resting in these stages
 * handed to the tab's consultant when they come back through that tab. Read
 * from the stage the lead was in BEFORE the re-enquiry, because the re-enquiry
 * itself revives Not Eligible to Re-marketing (crm-reinquiry.ts) — reading it
 * afterwards would also sweep up Not Interested leads, which stay put.
 */
export const ROUTE_TAKEOVER_STATUS_CODES: readonly string[] = ["re_marketing", "not_eligible"];
const TAKEOVER = new Set(ROUTE_TAKEOVER_STATUS_CODES);

/** One lead a routed batch touched. */
export type RouteTarget = {
  leadId: string;
  /** Its stage code before this batch's re-enquiry; null for a lead the batch created. */
  fromStatusCode: string | null;
};

export type RouteDecision =
  /** Nobody owns it: give it to the rule's consultant. */
  | "assign"
  /** Someone else owns it, but the rule takes it (see decideRoute). */
  | "take_over"
  /** Another active consultant is working it: leave it with them. */
  | "keep"
  /** The rule's consultant already owns it. */
  | "already_theirs";

/**
 * Who a routed lead goes to:
 * - no owner → the rule's consultant;
 * - owned by someone who is no longer an active L1/L2 consultant (left, or
 *   switched off in the Team Roster) → the rule's consultant;
 * - a re-enquiry on a lead that was in Re-marketing or Not Eligible → the
 *   rule's consultant, even from an active consultant;
 * - otherwise it stays with its active owner, whose re-enquiry task tells them
 *   the candidate came back.
 */
export function decideRoute(
  route: SheetRoute,
  lead: { ownerId: string | null; ownerIsActiveBde: boolean; fromStatusCode: string | null },
): RouteDecision {
  if (!lead.ownerId) return "assign";
  if (lead.ownerId === route.assigneeUserId) return "already_theirs";
  if (!lead.ownerIsActiveBde) return "take_over";
  if (lead.fromStatusCode && TAKEOVER.has(lead.fromStatusCode)) return "take_over";
  return "keep";
}

/** An owner counts as an active consultant only if they can still sign in AND are an active L1/L2 on the roster. */
export function isActiveBde(owner: { isActive: boolean; leadPulseRole: { active: boolean; role: string } | null } | null): boolean {
  const r = owner?.leadPulseRole;
  return !!owner && owner.isActive && !!r && r.active && (r.role === "l1" || r.role === "l2");
}

const TAKEOVER_REASON: Record<string, string> = {
  re_marketing: "it was in Re-marketing",
  not_eligible: "it was Not Eligible",
};

export type RouteOutcome = {
  /** Unowned leads handed to the rule's consultant. */
  assigned: number;
  /** Leads moved to the rule's consultant from another owner (see decideRoute). */
  takenOver: number;
  /** Re-inquiries on a lead an active consultant (or the rule's own consultant) owns — left as they are. */
  leftWithOwner: number;
  /** Assignments that failed (logged); the lead stays where it was for a person to pick up. */
  failed: number;
};

/**
 * Hand the leads one sheet batch touched to the rule's consultant, as
 * `decideRoute` says.
 *
 * Every move goes through the same `assignLeadTo` as a manual assignment —
 * timeline entry (naming the tab rule), in-app notification, WhatsApp intro
 * rules, inbox owner, and the lead's open tasks (including the re-enquiry task
 * just raised for the previous owner) all follow.
 *
 * The rule's service is filled in first, and only where the lead has none, so
 * the intro rules see it. Under a Study Abroad rule the nursing intro is
 * skipped for every lead, including one that keeps an older service.
 *
 * Never throws: a failure is logged and counted, and the lead simply stays
 * where it was, which is where it would have been without the rule.
 */
export async function applySheetRoute(route: SheetRoute, targets: RouteTarget[], tabLabel: string): Promise<RouteOutcome> {
  const outcome: RouteOutcome = { assigned: 0, takenOver: 0, leftWithOwner: 0, failed: 0 };
  // One decision per lead; the first mention wins, since a later row for the
  // same lead would see the stage the first row's re-enquiry already changed.
  const fromStatus = new Map<string, string | null>();
  for (const t of targets) if (!fromStatus.has(t.leadId)) fromStatus.set(t.leadId, t.fromStatusCode);
  const ids = Array.from(fromStatus.keys());
  if (ids.length === 0) return outcome;

  let leads: {
    id: string;
    assignedToId: string | null;
    serviceId: string | null;
    assignedTo: { isActive: boolean; leadPulseRole: { active: boolean; role: string } | null } | null;
  }[];
  let serviceName: string | null = null;
  let studyAbroadRule = false;
  try {
    leads = await prisma.lead.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        assignedToId: true,
        serviceId: true,
        assignedTo: { select: { isActive: true, leadPulseRole: { select: { active: true, role: true } } } },
      },
    });
    if (route.serviceId) {
      const svc = await prisma.service.findUnique({ where: { id: route.serviceId }, select: { name: true, isStudyAbroad: true } });
      serviceName = svc?.name ?? null;
      studyAbroadRule = !!svc?.isStudyAbroad;
    }
  } catch (e) {
    logger.warn("sheet_route_lookup_failed", { campaign: tabLabel, message: e instanceof Error ? e.message : String(e) });
    return { ...outcome, failed: ids.length };
  }

  const rule = `auto-assign rule for tab "${tabLabel}"`;
  for (const lead of leads) {
    const fromStatusCode = fromStatus.get(lead.id) ?? null;
    const ownerIsActiveBde = isActiveBde(lead.assignedTo);
    const decision = decideRoute(route, { ownerId: lead.assignedToId, ownerIsActiveBde, fromStatusCode });
    if (decision === "keep" || decision === "already_theirs") {
      outcome.leftWithOwner++;
      continue;
    }
    const why =
      decision === "assign"
        ? rule
        : `${rule}, because ${!ownerIsActiveBde ? "its owner is no longer an active BDE" : TAKEOVER_REASON[fromStatusCode ?? ""] ?? "of its stage"}`;
    try {
      if (route.serviceId && serviceName && !lead.serviceId) {
        await prisma.lead.update({ where: { id: lead.id }, data: { serviceId: route.serviceId } });
        await recordLeadActivity({
          leadId: lead.id,
          actorId: null,
          type: "FIELD_UPDATED",
          summary: `Service set to ${serviceName} — ${rule}`,
          metadata: { field: "service", serviceId: route.serviceId, sheetRoute: true },
          bumpLastActivity: false,
        });
      }
      // A Study Abroad rule never sends the nursing intro, even to a lead that
      // keeps an older service of its own.
      await assignLeadTo(lead.id, route.assigneeUserId, null, { via: why, ...(studyAbroadRule ? { studyAbroadRule: true } : {}) });
      if (decision === "assign") outcome.assigned++;
      else outcome.takenOver++;
    } catch (e) {
      outcome.failed++;
      logger.warn("sheet_route_assign_failed", {
        leadId: lead.id,
        campaign: tabLabel,
        decision,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return outcome;
}
