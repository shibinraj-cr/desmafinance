// Re-inquiry detection — the durable fix for "a candidate who already exists
// submits again". Instead of creating a buried "Duplicate" row, we FOLD the new
// submission onto the canonical lead: bump inquiryCount, stamp lastInquiryAt,
// log a RE_INQUIRY activity, revive the lead if it was in a lost status, and
// raise follow-up tasks (the consultant who owns it, plus a supervisor oversight
// task so nothing slips). Used by all three entry points (webhook ingest,
// file-upload import, manual create).
import { prisma } from "./prisma";
import { getSetting, REINQUIRY_SUPERVISOR_KEY } from "./app-settings";
import { getEmailConfig, sendEmail } from "./mailer";

// Lost / terminal dispositions. A re-inquiry on one of these is the strongest
// re-engagement signal — the candidate said no, then came back.
export const LOST_STATUS_CODES = ["not_interested", "not_eligible", "already_processing_elsewhere"] as const;
const LOST = new Set<string>(LOST_STATUS_CODES);
export function isLostStatusCode(code: string | null | undefined): boolean {
  return !!code && LOST.has(code);
}

export const REMARKETING_STATUS_CODE = "re_marketing";
// Optional override mailbox for the supervisor digest (the supervisor user's own
// email is used when this isn't set).
export const REINQUIRY_NOTIFY_EMAIL_KEY = "crm_reinquiry_notify_email";

export type ReInquiryContext = {
  /** Re-marketing status id, or null to skip auto-revive (status left as-is). */
  reMarketingStatusId: string | null;
  /** Supervisor user id for oversight tasks + digest, or null when unconfigured. */
  supervisorUserId: string | null;
};

/** Resolve the configured supervisor user id (AppSetting → env), validating it exists. */
export async function getReInquirySupervisorId(): Promise<string | null> {
  const raw = (await getSetting(REINQUIRY_SUPERVISOR_KEY).catch(() => null)) || process.env.CRM_REINQUIRY_SUPERVISOR_USER_ID || null;
  if (!raw) return null;
  const u = await prisma.user.findUnique({ where: { id: raw }, select: { id: true } });
  return u?.id ?? null;
}

/** Resolve the shared context once per batch (status id + supervisor). */
export async function resolveReInquiryContext(): Promise<ReInquiryContext> {
  const [remkt, supervisorUserId] = await Promise.all([
    prisma.crmLeadStatus.findUnique({ where: { code: REMARKETING_STATUS_CODE }, select: { id: true, active: true } }),
    getReInquirySupervisorId(),
  ]);
  return { reMarketingStatusId: remkt?.active ? remkt.id : null, supervisorUserId };
}

export type ReInquiryEvent = {
  /** The canonical (existing) lead the re-inquiry folds onto. */
  leadId: string;
  source?: string | null;
  campaign?: string | null;
  /** When the re-submission happened (defaults to now). */
  occurredAt?: Date | null;
  /** Who triggered it (the importing user); null for webhook/system. */
  actorId?: string | null;
};

export type ReInquiryOutcome = {
  leadId: string;
  leadName: string;
  ownerId: string | null;
  revived: boolean;
  fromStatus: string;
  inquiryCount: number;
  source: string | null;
  campaign: string | null;
  occurredAt: Date;
};

// ── Pure builders (unit-tested) ─────────────────────────────────────────────

export function buildReInquirySummary(p: { fromStatus: string; revived: boolean; source?: string | null; campaign?: string | null }): string {
  const via = p.campaign ? ` via ${p.campaign}` : p.source ? ` via ${p.source}` : "";
  return p.revived
    ? `Re-inquiry${via}: candidate re-submitted while marked "${p.fromStatus}" — re-opened to Re-marketing.`
    : `Re-inquiry${via}: candidate re-submitted (was "${p.fromStatus}").`;
}

export function buildReInquiryTaskSubject(name: string, campaign?: string | null): string {
  return `Re-inquiry — ${name} re-submitted${campaign ? ` via ${campaign}` : ""}`;
}

export function buildReInquiryTaskNote(p: { fromStatus: string; revived: boolean; source?: string | null; campaign?: string | null; when: Date; count: number }): string {
  const src = p.campaign || p.source || "an inbound form";
  return [
    `Candidate re-submitted on ${p.when.toISOString().slice(0, 10)} via ${src}.`,
    `Previous status: ${p.fromStatus}.${p.revived ? " Auto-revived to Re-marketing." : ""}`,
    `Total submissions so far: ${p.count}.`,
  ].join(" ");
}

/** Supervisor digest email body for a set of re-inquiries. Pure → testable. */
export function buildSupervisorDigest(outcomes: ReInquiryOutcome[], baseUrl?: string): { subject: string; text: string } {
  const n = outcomes.length;
  const revived = outcomes.filter((o) => o.revived).length;
  const subject = `[CRM] ${n} re-inquir${n === 1 ? "y" : "ies"} detected${revived ? ` (${revived} revived from lost)` : ""}`;
  const lines = outcomes.map((o, i) => {
    const link = baseUrl ? ` ${baseUrl.replace(/\/$/, "")}/crm/leads/${o.leadId}` : "";
    const via = o.campaign || o.source || "inbound";
    const owner = o.ownerId ? "" : " [UNASSIGNED]";
    return `${i + 1}. ${o.leadName} — was "${o.fromStatus}"${o.revived ? " → Re-marketing" : ""}, via ${via}${owner}.${link}`;
  });
  const text = [
    `${n} re-inquiry${n === 1 ? "" : "ies"} were detected (existing candidates who submitted again).`,
    revived ? `${revived} were revived from a lost status to Re-marketing.` : "",
    "",
    ...lines,
    "",
    "Each has a follow-up task. Unassigned ones are in your task queue.",
  ].filter((l) => l !== "").join("\n");
  return { subject, text };
}

// ── Core: fold one re-inquiry onto its canonical lead ────────────────────────

/**
 * Record a re-inquiry on an existing lead. Idempotency is the caller's job
 * (e.g. the webhook's externalKey skip) — this always folds. Returns the outcome
 * for the digest, or null if the lead vanished.
 */
export async function recordReInquiry(ev: ReInquiryEvent, ctx: ReInquiryContext): Promise<ReInquiryOutcome | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: ev.leadId },
    select: { id: true, candidateName: true, assignedToId: true, inquiryCount: true, status: { select: { code: true, label: true } } },
  });
  if (!lead) return null;

  const when = ev.occurredAt ?? new Date();
  const revived = isLostStatusCode(lead.status.code) && !!ctx.reMarketingStatusId;
  const newCount = (lead.inquiryCount ?? 1) + 1;
  const actionOwner = lead.assignedToId ?? ctx.supervisorUserId ?? null;
  const dueAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const subject = buildReInquiryTaskSubject(lead.candidateName, ev.campaign);
  const note = buildReInquiryTaskNote({ fromStatus: lead.status.label, revived, source: ev.source, campaign: ev.campaign, when, count: newCount });

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: lead.id },
      data: {
        inquiryCount: newCount,
        lastInquiryAt: when,
        lastActivityAt: new Date(),
        ...(revived ? { statusId: ctx.reMarketingStatusId! } : {}),
      },
    });
    await tx.leadActivity.create({
      data: {
        leadId: lead.id, actorId: ev.actorId ?? null, type: "RE_INQUIRY",
        summary: buildReInquirySummary({ fromStatus: lead.status.label, revived, source: ev.source, campaign: ev.campaign }),
        metadata: { source: ev.source ?? null, campaign: ev.campaign ?? null, occurredAt: when.toISOString(), fromStatus: lead.status.label, fromStatusCode: lead.status.code, revived, inquiryCount: newCount },
      },
    });
    // Action task: the consultant who owns the lead, else the supervisor.
    const action = await tx.crmTask.create({
      data: { leadId: lead.id, subject, priority: "high", status: "open", dueAt, assignedToId: actionOwner, createdById: null, note },
    });
    await tx.leadActivity.create({
      data: { leadId: lead.id, actorId: ev.actorId ?? null, type: "TASK_CREATED", summary: `Task created: ${subject}`, metadata: { taskId: action.id, source: "reinquiry" } },
    });
    // Oversight task: ensure the supervisor sees every re-inquiry, even when a
    // consultant already owns the action task. Skipped when the supervisor IS
    // the action owner (no double task).
    if (ctx.supervisorUserId && actionOwner !== ctx.supervisorUserId) {
      await tx.crmTask.create({
        data: {
          leadId: lead.id, subject: `Re-inquiry oversight — ${lead.candidateName}`, priority: "normal", status: "open",
          dueAt, assignedToId: ctx.supervisorUserId, createdById: null,
          note: `Oversight copy. ${note}${lead.assignedToId ? "" : " Lead is UNASSIGNED — assign a consultant."}`,
        },
      });
    }
  });

  return {
    leadId: lead.id, leadName: lead.candidateName, ownerId: lead.assignedToId, revived,
    fromStatus: lead.status.label, inquiryCount: newCount, source: ev.source ?? null, campaign: ev.campaign ?? null, occurredAt: when,
  };
}

/**
 * Best-effort: email the supervisor a digest of a batch's re-inquiries. Never
 * throws. No-ops when there's nothing to send, no supervisor, or no deliverable
 * mailbox / SMTP. (A .local placeholder address won't deliver — in-app oversight
 * tasks are the reliable channel.)
 */
export async function notifySupervisorOfReInquiries(outcomes: ReInquiryOutcome[], ctx: ReInquiryContext, baseUrl?: string): Promise<void> {
  if (outcomes.length === 0 || !ctx.supervisorUserId) return;
  try {
    const override = await getSetting(REINQUIRY_NOTIFY_EMAIL_KEY).catch(() => null);
    let to = override;
    if (!to) {
      const sup = await prisma.user.findUnique({ where: { id: ctx.supervisorUserId }, select: { email: true } });
      to = sup?.email ?? null;
    }
    if (!to || /@.*\.local$/i.test(to)) return; // skip undeliverable placeholder addresses
    const cfg = await getEmailConfig();
    if (!cfg) return;
    const { subject, text } = buildSupervisorDigest(outcomes, baseUrl);
    await sendEmail(cfg, { to, subject, text });
  } catch (e) {
    console.error("[reinquiry] supervisor digest failed:", e);
  }
}
