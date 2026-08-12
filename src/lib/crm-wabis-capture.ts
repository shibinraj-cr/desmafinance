// Inbound WhatsApp → CRM single-lead capture.
//
// When a candidate first messages the Wabis-linked marketing number with the
// campaign keyword (e.g. "study abroad"), a Wabis keyword-reply flow POSTs their
// subscriber profile to /api/crm/integrations/wabis/capture and we create ONE
// lead. Deduped by phone/email so a repeat texter folds into a re-inquiry on
// their existing lead rather than a duplicate row.
//
// Unlike the batch spreadsheet ingest (crm-sheet-ingest.ts) this is a real-time,
// one-at-a-time path that can also stamp an assignee, so it's its own small
// function rather than a SHEET_SOURCES entry — but it reuses the same dedupe,
// re-inquiry and notification primitives.
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { normalizePhone, emailKeyOf, computeDedupeKey } from "./crm";
import { resolveDefaultStatus } from "./crm-leads";
import { recordReInquiry, resolveReInquiryContext } from "./crm-reinquiry";
import { notifyLeadAssigned } from "./crm-notify";

/** LeadPulseSource.code stamped on WhatsApp-captured leads (see prisma/seed-lead-pulse.ts). */
export const WABIS_CAPTURE_SOURCE_CODE = "meta_whatsapp";
/** Human label used in re-inquiry/timeline summaries. */
const SOURCE_LABEL = "Meta WhatsApp";

export type CaptureInput = {
  name: string | null;
  /** Raw sender number as Wabis sends it (e.g. "919946108136" — no leading +). */
  phone: string | null;
  email: string | null;
  /** The candidate's message text, kept as lead context. */
  message: string | null;
  /** Which WhatsApp number the message arrived on. */
  botNumber: string | null;
  /** Campaign label stamped on the lead (e.g. "Study Abroad"). */
  campaign: string;
  /** Optional pre-resolved consultant to own the lead (per-agent Wabis flows). */
  assignToUserId?: string | null;
};

export type CaptureResult =
  | { status: "created"; leadId: string; assigned: boolean }
  | { status: "reinquiry"; leadId: string; assigned: false }
  | { status: "skipped"; reason: string };

/**
 * Stable per-person idempotency key: Wabis sends no message-id, so a resend of
 * the same first contact must hash the same and skip. Keyed by source + campaign
 * + email/phone (not the message text, which varies) so one person in one
 * campaign is one lead.
 */
function externalKeyFor(campaign: string, emailKey: string | null, phoneE164: string | null): string {
  const basis = [WABIS_CAPTURE_SOURCE_CODE, campaign.trim().toLowerCase(), emailKey ?? "", phoneE164 ?? ""].join("|");
  return WABIS_CAPTURE_SOURCE_CODE + "_" + createHash("sha1").update(basis).digest("hex");
}

async function foldReInquiry(leadId: string, campaign: string): Promise<CaptureResult> {
  const ctx = await resolveReInquiryContext();
  await recordReInquiry({ leadId, source: SOURCE_LABEL, campaign, occurredAt: null }, ctx);
  return { status: "reinquiry", leadId, assigned: false };
}

export async function captureWabisLead(input: CaptureInput): Promise<CaptureResult> {
  const phoneE164 = normalizePhone(input.phone);
  const emailKey = emailKeyOf(input.email);
  // A WhatsApp message always carries a sender number; with neither phone nor
  // email we can't dedupe or follow up, so there's nothing useful to store.
  if (!phoneE164 && !emailKey) return { status: "skipped", reason: "no_phone_or_email" };

  // Dedupe: match the incoming number/email against BOTH phone fields of existing
  // leads (a candidate's alternate number counts too); oldest lead = canonical.
  const dupWhere: Prisma.LeadWhereInput[] = [];
  if (emailKey) dupWhere.push({ emailKey });
  if (phoneE164) {
    dupWhere.push({ phoneE164 });
    dupWhere.push({ altPhoneE164: phoneE164 });
  }
  const existing = await prisma.lead.findFirst({
    where: { OR: dupWhere },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  // Existing candidate re-messaging → fold as a re-inquiry (may revive a lost
  // lead to Re-marketing) instead of creating a duplicate. Owner is left as-is.
  if (existing) return foldReInquiry(existing.id, input.campaign);

  const [defStatus, source] = await Promise.all([
    resolveDefaultStatus(),
    prisma.leadPulseSource.findUnique({ where: { code: WABIS_CAPTURE_SOURCE_CODE }, select: { id: true } }),
  ]);
  if (!defStatus) return { status: "skipped", reason: "no_status_configured" };

  const candidateName = input.name?.trim() || (phoneE164 ? `WhatsApp ${phoneE164.slice(-4)}` : "WhatsApp lead");
  const externalKey = externalKeyFor(input.campaign, emailKey, phoneE164);

  const extra: Record<string, string> = { campaign: input.campaign, channel: "whatsapp" };
  if (input.message) extra.message = input.message;
  if (input.botNumber) extra.botNumber = input.botNumber;

  try {
    const lead = await prisma.lead.create({
      data: {
        candidateName,
        email: input.email,
        phone: input.phone,
        phoneE164,
        emailKey,
        dedupeKey: computeDedupeKey(input.email, phoneE164),
        externalKey,
        sourceId: source?.id ?? null,
        statusId: defStatus.id,
        campaign: input.campaign,
        extra,
        assignedToId: input.assignToUserId ?? null,
      },
      select: { id: true },
    });

    await prisma.leadActivity.create({
      data: { leadId: lead.id, type: "LEAD_CREATED", summary: `Captured from WhatsApp — ${input.campaign}` },
    });

    if (input.assignToUserId) {
      await prisma.leadActivity.create({
        data: { leadId: lead.id, type: "ASSIGNED", summary: "Auto-assigned from Wabis" },
      });
      // Best-effort in-app ping; never blocks the capture (see crm-notify).
      await notifyLeadAssigned({ assigneeUserId: input.assignToUserId, leadId: lead.id, candidateName });
    }

    return { status: "created", leadId: lead.id, assigned: !!input.assignToUserId };
  } catch (e) {
    // Two messages racing on the unique externalKey → the first wins; treat the
    // loser as a re-inquiry on the row that won rather than erroring.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const winner = await prisma.lead.findUnique({ where: { externalKey }, select: { id: true } });
      if (winner) return foldReInquiry(winner.id, input.campaign);
    }
    throw e;
  }
}

/**
 * Resolve an optional Wabis agent hint (?agent=) to a DesGro consultant user id.
 * Matches an active L1/L2 consultant by exact email or username, else by display
 * name (all case-insensitive). Returns null when unset or unmatched — capture
 * then leaves the lead unassigned rather than guessing the wrong owner.
 *
 * Wabis's payload carries no agent today; this is the forward-compatible hook for
 * per-agent Wabis flows that append `&agent=<email>` to the capture URL later.
 */
export async function resolveConsultantHint(hint: string | null): Promise<string | null> {
  const q = hint?.trim().toLowerCase();
  if (!q) return null;
  const roles = await prisma.leadPulseRole.findMany({
    where: { active: true, role: { in: ["l1", "l2"] } },
    select: { userId: true, displayName: true, user: { select: { username: true, email: true } } },
  });
  const byIdentity = roles.find(
    (r) => r.user?.email?.toLowerCase() === q || r.user?.username?.toLowerCase() === q,
  );
  if (byIdentity) return byIdentity.userId;
  const byName = roles.find((r) => r.displayName.trim().toLowerCase() === q);
  return byName?.userId ?? null;
}
