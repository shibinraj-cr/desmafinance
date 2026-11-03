/**
 * Instagram DMs → CRM leads.
 *
 * Each inbound DM is stored against its sender (IgContact), the details in it
 * are pulled out (src/lib/ig/extract.ts), and the moment a phone or an email is
 * known the contact becomes a lead — a new one stamped source "Insta", or, when
 * the number/email already belongs to a candidate, a re-inquiry on theirs.
 * Then auto-ask (src/lib/ig/auto-ask.ts) decides whether to reply.
 *
 * The same two rules as the WhatsApp mirror carry correctness here:
 *
 *   - **Idempotency.** Meta redelivers on any non-2xx and sometimes on a slow
 *     2xx. Messages collide on the unique `providerMessageId`; the lead is
 *     created against a unique `externalKey` (`ig:<igsid>`); the contact's link
 *     to a lead is claimed with a conditional update. A replay is a no-op.
 *   - **Never lose a message.** Storage happens first and is the only failure
 *     that asks Meta to redeliver. Everything after it — profile lookup, lead
 *     creation, auto-ask — is best-effort and logged, and re-evaluated on the
 *     candidate's next message, so a blip there costs a delay, not the lead.
 *
 * Nothing a BDE typed is ever overwritten: details only fill blanks on the
 * lead, and the lead's name is replaced only while it is still the placeholder
 * this file gave it.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { computeDedupeKey, emailKeyOf } from "../crm";
import { resolveDefaultStatus } from "../crm-leads";
import { recordLeadActivity } from "../crm-activity";
import { notifySupervisorOfReInquiries, recordReInquiry, resolveReInquiryContext } from "../crm-reinquiry";
import { logger } from "../logger";
import {
  addsChasedDetail,
  extractDetails,
  missingDetails,
  newDetails,
  qualificationPayload,
  type ContactDetails,
  type QualOption,
} from "./extract";
import {
  decideAutoAsk,
  DEFAULT_IG_FOLLOWUP,
  DEFAULT_IG_INTRO,
  DEFAULT_IG_THANKS,
  firstNameOf,
  qualificationQuickReplies,
  renderAutoAskText,
} from "./auto-ask";
import { fetchIgProfile, hasEarlierConversation, sendIgText, type IgConfig } from "./graph";
import type { IgEvent } from "./webhook";

/** Source master DM-created leads are stamped with (seeded by the 20261103120000 migration). */
export const IG_SOURCE_CODE = "insta";
export const IG_SOURCE_LABEL = "Insta";
/** How a re-inquiry from a DM reads on the timeline and in the supervisor digest. */
const IG_CHANNEL_LABEL = "Instagram DM";

/** Lead.externalKey for a lead created from one Instagram contact. */
export function igLeadExternalKey(igsid: string): string {
  return `ig:${igsid}`;
}

/**
 * The "Insta" source row. By code first; by label second, for a deployment
 * where an admin had already made an "Insta" source by hand before the
 * migration ran (it then skipped its own insert rather than duplicate it).
 */
export async function resolveInstaSourceId(): Promise<string | null> {
  const byCode = await prisma.leadPulseSource.findUnique({ where: { code: IG_SOURCE_CODE }, select: { id: true } });
  if (byCode) return byCode.id;
  const byLabel = await prisma.leadPulseSource.findFirst({
    where: { label: { equals: IG_SOURCE_LABEL, mode: "insensitive" } },
    select: { id: true },
  });
  return byLabel?.id ?? null;
}

const CONTACT_SELECT = {
  id: true,
  igsid: true,
  username: true,
  name: true,
  typedName: true,
  email: true,
  phone: true,
  phoneE164: true,
  qualificationId: true,
  leadId: true,
  leadCreated: true,
  leadNameSet: true,
  askCount: true,
  thankedAt: true,
  humanRepliedAt: true,
  autoAskBlocked: true,
  firstInboundAt: true,
} satisfies Prisma.IgContactSelect;

type Contact = Prisma.IgContactGetPayload<{ select: typeof CONTACT_SELECT }>;

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/** Find the contact, or create it. A lost create race adopts the winner's row. */
async function findOrCreateContact(igsid: string, firstInboundAt: Date | null): Promise<{ contact: Contact; created: boolean }> {
  const found = await prisma.igContact.findUnique({ where: { igsid }, select: CONTACT_SELECT });
  if (found) return { contact: found, created: false };
  try {
    const contact = await prisma.igContact.create({
      data: { igsid, firstInboundAt, lastInboundAt: firstInboundAt },
      select: CONTACT_SELECT,
    });
    return { contact, created: true };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const winner = await prisma.igContact.findUnique({ where: { igsid }, select: CONTACT_SELECT });
    if (!winner) throw e;
    return { contact: winner, created: false };
  }
}

export type IgIngestSummary = {
  received: number;
  stored: number;
  duplicates: number;
  leadsCreated: number;
  leadsLinked: number;
  autoSent: number;
  /** Storage failed — the only outcome worth asking Meta to redeliver. */
  failed: number;
};

type BatchContext = {
  cfg: IgConfig;
  quals: QualOption[];
  summary: IgIngestSummary;
};

/** The best name we have for a lead we are about to create. */
function leadNameFor(c: Contact): string {
  return (
    c.typedName?.trim() ||
    c.name?.trim() ||
    (c.username ? `@${c.username}` : "") ||
    c.phoneE164 ||
    c.email?.trim() ||
    "Instagram lead"
  );
}

/**
 * Turn a contact that now has a phone or email into a lead, or tie it to the
 * lead that already has them. Returns the contact as it stands afterwards.
 */
async function linkOrCreateLead(contact: Contact, occurredAt: Date, batch: BatchContext): Promise<Contact> {
  const externalKey = igLeadExternalKey(contact.igsid);
  const emailKey = emailKeyOf(contact.email);

  // A lead this contact already created (the link write after it failed) is
  // ours, not a re-inquiry.
  const own = await prisma.lead.findUnique({ where: { externalKey }, select: { id: true } });

  const identity: Prisma.LeadWhereInput[] = [];
  if (emailKey) identity.push({ emailKey });
  if (contact.phoneE164) identity.push({ phoneE164: contact.phoneE164 }, { altPhoneE164: contact.phoneE164 });
  // Oldest lead on the identity = the canonical one a re-inquiry folds onto,
  // the same rule the sheet importer uses.
  const existing = own
    ? null
    : await prisma.lead.findFirst({ where: { OR: identity }, orderBy: { createdAt: "asc" }, select: { id: true } });

  if (existing) {
    const claimed = await prisma.igContact.updateMany({
      where: { id: contact.id, leadId: null },
      data: { leadId: existing.id, linkedAt: new Date(), leadCreated: false },
    });
    // Only the request that made the link folds the re-inquiry, so two racing
    // deliveries cannot raise two follow-up tasks for one DM.
    if (claimed.count === 1) {
      batch.summary.leadsLinked++;
      const ctx = await resolveReInquiryContext();
      const outcome = await recordReInquiry(
        { leadId: existing.id, source: IG_CHANNEL_LABEL, campaign: null, occurredAt },
        ctx,
      );
      if (outcome) await notifySupervisorOfReInquiries([outcome], ctx, process.env.NEXTAUTH_URL);
      await fillLeadBlanks(existing.id, { ...contact, leadNameSet: null });
    }
    return { ...contact, leadId: existing.id, leadCreated: false };
  }

  let leadId = own?.id ?? null;
  let name = leadNameFor(contact);
  if (!leadId) {
    const [defStatus, sourceId] = await Promise.all([resolveDefaultStatus(), resolveInstaSourceId()]);
    if (!defStatus) {
      logger.warn("ig_lead_no_status_configured", {});
      return contact;
    }
    // Race-safe: insert-or-skip on the unique externalKey, then read back —
    // the loser of a race gets the winner's lead instead of a second one.
    const inserted = await prisma.lead.createMany({
      data: [
        {
          candidateName: name,
          email: contact.email,
          emailKey,
          phone: contact.phone,
          phoneE164: contact.phoneE164,
          dedupeKey: computeDedupeKey(contact.email, contact.phoneE164),
          externalKey,
          statusId: defStatus.id,
          sourceId,
          qualificationId: contact.qualificationId,
          ...(contact.username ? { extra: { Instagram: `@${contact.username}` } } : {}),
        },
      ],
      skipDuplicates: true,
    });
    const lead = await prisma.lead.findUnique({ where: { externalKey }, select: { id: true, candidateName: true } });
    if (!lead) return contact;
    leadId = lead.id;
    name = lead.candidateName;
    if (inserted.count > 0) {
      batch.summary.leadsCreated++;
      await recordLeadActivity({
        leadId: lead.id,
        type: "LEAD_CREATED",
        summary: contact.username ? `Created from an Instagram DM (@${contact.username})` : "Created from an Instagram DM",
        metadata: { channel: "instagram", igsid: contact.igsid },
      });
    }
  }

  await prisma.igContact.updateMany({
    where: { id: contact.id, leadId: null },
    data: { leadId, linkedAt: new Date(), leadCreated: true, leadNameSet: name },
  });
  return { ...contact, leadId, leadCreated: true, leadNameSet: name };
}

/**
 * Copy what the contact has told us onto the lead — blanks only.
 *
 * The name is the one field that may change something already set, and only
 * while it is still the placeholder we gave the lead (`leadNameSet`): a typed
 * "Anjali" should replace "@anjali_rn_22", but never a name a BDE corrected.
 */
async function fillLeadBlanks(leadId: string, contact: Contact): Promise<void> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { candidateName: true, email: true, phone: true, phoneE164: true, qualificationId: true },
  });
  if (!lead) return;

  const data: Prisma.LeadUncheckedUpdateInput = {};
  const filled: string[] = [];
  const email = !emailKeyOf(lead.email) && emailKeyOf(contact.email) ? contact.email : null;
  const phoneE164 = !lead.phoneE164 && !lead.phone?.trim() && contact.phoneE164 ? contact.phoneE164 : null;
  if (email) {
    data.email = email;
    data.emailKey = emailKeyOf(email);
    filled.push("email");
  }
  if (phoneE164) {
    data.phone = contact.phone ?? phoneE164;
    data.phoneE164 = phoneE164;
    filled.push("phone");
  }
  if (email || phoneE164) data.dedupeKey = computeDedupeKey(email ?? lead.email, phoneE164 ?? lead.phoneE164);
  if (!lead.qualificationId && contact.qualificationId) {
    data.qualificationId = contact.qualificationId;
    filled.push("qualification");
  }
  const typed = contact.typedName?.trim();
  const renamed = !!typed && !!contact.leadNameSet && lead.candidateName === contact.leadNameSet && typed !== lead.candidateName;
  if (renamed) {
    data.candidateName = typed;
    filled.push("name");
  }
  if (filled.length === 0) return;

  await prisma.lead.update({ where: { id: leadId }, data });
  if (renamed) await prisma.igContact.update({ where: { id: contact.id }, data: { leadNameSet: typed } });
  await recordLeadActivity({
    leadId,
    type: "FIELD_UPDATED",
    summary: `Filled from an Instagram DM: ${filled.join(", ")}`,
    metadata: { channel: "instagram", fields: filled },
  });
}

/** Decide, claim and send one auto-ask reply. Never throws past its own logging. */
async function maybeAutoAsk(
  contactId: string,
  ctx: { firstInbound: boolean; addedDetail: boolean },
  batch: BatchContext,
): Promise<void> {
  const { cfg } = batch;
  const c = await prisma.igContact.findUnique({ where: { id: contactId }, select: CONTACT_SELECT });
  if (!c) return;
  const missing = missingDetails(c);

  const decision = decideAutoAsk({
    enabled: cfg.autoAskEnabled && !!cfg.pageId && !!cfg.token,
    humanRepliedAt: c.humanRepliedAt,
    blocked: c.autoAskBlocked,
    thankedAt: c.thankedAt,
    askCount: c.askCount,
    existingLead: !!c.leadId && !c.leadCreated,
    firstInbound: ctx.firstInbound,
    addedDetail: ctx.addedDetail,
    missing,
  });
  if (decision.action === "none") return;

  // Claim before sending: two deliveries racing on one candidate both decide
  // "intro", and only the one whose conditional update lands may speak.
  const now = new Date();
  const claim =
    decision.action === "thanks"
      ? await prisma.igContact.updateMany({
          where: { id: c.id, thankedAt: null, humanRepliedAt: null },
          data: { thankedAt: now },
        })
      : await prisma.igContact.updateMany({
          where: { id: c.id, askCount: c.askCount, humanRepliedAt: null },
          data: { askCount: { increment: 1 }, lastAskAt: now },
        });
  if (claim.count !== 1) return;

  const template =
    decision.action === "intro"
      ? cfg.texts.intro || DEFAULT_IG_INTRO
      : decision.action === "follow_up"
        ? cfg.texts.followUp || DEFAULT_IG_FOLLOWUP
        : cfg.texts.thanks || DEFAULT_IG_THANKS;
  const text = renderAutoAskText(template, { firstName: firstNameOf(c.typedName, c.name), missing });
  const quickReplies =
    decision.action !== "thanks" && missing.includes("qualification")
      ? qualificationQuickReplies(batch.quals, qualificationPayload)
      : undefined;

  // Stored BEFORE the send, so Meta's echo of it — which can beat the send's
  // own response back to us — finds a row to attach to and is not mistaken
  // for a person on the team replying.
  const row = await prisma.igMessage.create({
    data: { contactId: c.id, direction: "out", sender: "auto", body: text, sendStatus: "sending", occurredAt: now },
    select: { id: true },
  });
  const sent = await sendIgText(cfg, c.igsid, text, quickReplies);

  if (sent.ok) {
    batch.summary.autoSent++;
    await prisma.igMessage
      .update({ where: { id: row.id }, data: { sendStatus: "sent", ...(sent.mid ? { providerMessageId: sent.mid } : {}) } })
      .catch(async (e) => {
        // The echo got there first and already carries this id — on this row
        // (harmless) or, improbably, another. The send itself stands.
        if (!isUniqueViolation(e)) throw e;
        await prisma.igMessage.update({ where: { id: row.id }, data: { sendStatus: "sent" } });
      });
    return;
  }

  // Undo the claim so the counters say what candidates actually received.
  await prisma.igMessage.update({ where: { id: row.id }, data: { sendStatus: "failed", sendError: sent.detail.slice(0, 500) } });
  await prisma.igContact.update({
    where: { id: c.id },
    data: decision.action === "thanks" ? { thankedAt: null } : { askCount: { decrement: 1 } },
  });
}

/** One message from a candidate. */
async function ingestInbound(ev: IgEvent, batch: BatchContext): Promise<void> {
  const { cfg, summary } = batch;
  const occurredAt = ev.occurredAt ?? new Date();

  // A redelivery is a true no-op — checked before anything writes.
  if (ev.mid) {
    const seen = await prisma.igMessage.findUnique({ where: { providerMessageId: ev.mid }, select: { id: true } });
    if (seen) {
      summary.duplicates++;
      return;
    }
  }

  const { contact: before, created } = await findOrCreateContact(ev.igsid, occurredAt);
  // First message they ever sent us: a brand-new contact, or one the team
  // wrote to first (an echo made the row, with no inbound yet).
  const firstInbound = created || !before.firstInboundAt;

  const stored = await prisma.igMessage.createMany({
    data: [
      {
        contactId: before.id,
        direction: "in",
        body: ev.text,
        quickReplyPayload: ev.quickReplyPayload,
        attachmentType: ev.attachmentType,
        providerMessageId: ev.mid,
        occurredAt,
      },
    ],
    skipDuplicates: true,
  });
  if (stored.count === 0) {
    summary.duplicates++;
    return;
  }
  summary.stored++;

  // ── Everything below is best-effort: the message is safe. ──────────────
  try {
    let contact = before;
    const contactPatch: Prisma.IgContactUncheckedUpdateInput = {
      lastInboundAt: occurredAt,
      ...(before.firstInboundAt ? {} : { firstInboundAt: occurredAt }),
    };

    if (firstInbound && cfg.token) {
      const [profile, history] = await Promise.all([
        before.username || before.name ? null : fetchIgProfile(cfg, ev.igsid),
        cfg.autoAskEnabled && !ev.standby && !before.autoAskBlocked
          ? hasEarlierConversation(cfg, ev.igsid, { mid: ev.mid, occurredAt })
          : null,
      ]);
      if (profile?.name) contactPatch.name = profile.name;
      if (profile?.username) contactPatch.username = profile.username;
      if (history === "earlier") contactPatch.autoAskBlocked = "earlier_conversation";
      if (history === "unknown") contactPatch.autoAskBlocked = "history_unknown";
    }
    if (ev.standby && !before.autoAskBlocked) contactPatch.autoAskBlocked = "standby";

    const found = extractDetails({ text: ev.text, quickReplyPayload: ev.quickReplyPayload }, batch.quals);
    const details: ContactDetails = {
      typedName: before.typedName,
      email: before.email,
      phone: before.phone,
      phoneE164: before.phoneE164,
      qualificationId: before.qualificationId,
    };
    const patch = newDetails(details, found);
    Object.assign(contactPatch, patch);

    contact = await prisma.igContact.update({ where: { id: before.id }, data: contactPatch, select: CONTACT_SELECT });

    if (cfg.captureEnabled) {
      if (!contact.leadId && (contact.phoneE164 || emailKeyOf(contact.email))) {
        contact = await linkOrCreateLead(contact, occurredAt, batch);
      } else if (contact.leadId && Object.keys(patch).length > 0) {
        await fillLeadBlanks(contact.leadId, contact);
      }
    }

    await maybeAutoAsk(contact.id, { firstInbound, addedDetail: addsChasedDetail(patch) }, batch);
  } catch (e) {
    logger.warn("ig_ingest_followup_failed", { message: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * One message the BUSINESS sent: either our own auto-ask coming back, or a
 * person on the team replying in Business Suite / the Instagram app. The
 * second is the signal auto-ask waits for to fall silent.
 */
async function ingestEcho(ev: IgEvent, batch: BatchContext): Promise<void> {
  const { summary } = batch;
  if (ev.mid) {
    const seen = await prisma.igMessage.findUnique({ where: { providerMessageId: ev.mid }, select: { id: true } });
    if (seen) {
      summary.duplicates++;
      return;
    }
  }

  const { contact } = await findOrCreateContact(ev.igsid, null);

  // Ours? An auto-ask row still waiting for its id, with the same text, sent
  // in the last few minutes.
  if (ev.text) {
    const pending = await prisma.igMessage.findFirst({
      where: {
        contactId: contact.id,
        direction: "out",
        sender: "auto",
        providerMessageId: null,
        body: ev.text,
        createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (pending) {
      if (ev.mid) {
        await prisma.igMessage
          .update({ where: { id: pending.id }, data: { providerMessageId: ev.mid } })
          .catch((e) => {
            if (!isUniqueViolation(e)) throw e;
          });
      }
      summary.duplicates++;
      return;
    }
  }

  const occurredAt = ev.occurredAt ?? new Date();
  const stored = await prisma.igMessage.createMany({
    data: [
      {
        contactId: contact.id,
        direction: "out",
        sender: "team",
        body: ev.text,
        attachmentType: ev.attachmentType,
        providerMessageId: ev.mid,
        occurredAt,
      },
    ],
    skipDuplicates: true,
  });
  if (stored.count === 0) {
    summary.duplicates++;
    return;
  }
  summary.stored++;
  if (!contact.humanRepliedAt) {
    await prisma.igContact.updateMany({ where: { id: contact.id, humanRepliedAt: null }, data: { humanRepliedAt: occurredAt } });
  }
}

/** Ingest one webhook delivery, in order. */
export async function ingestIgEvents(events: IgEvent[], cfg: IgConfig): Promise<IgIngestSummary> {
  const summary: IgIngestSummary = {
    received: events.length,
    stored: 0,
    duplicates: 0,
    leadsCreated: 0,
    leadsLinked: 0,
    autoSent: 0,
    failed: 0,
  };
  if (events.length === 0) return summary;

  const quals = events.some((e) => e.kind === "in")
    ? await prisma.crmQualification.findMany({
        where: { active: true },
        orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
        select: { id: true, label: true },
      })
    : [];
  const batch: BatchContext = { cfg, quals, summary };

  for (const ev of events) {
    try {
      if (ev.kind === "echo") await ingestEcho(ev, batch);
      else await ingestInbound(ev, batch);
    } catch (e) {
      summary.failed++;
      logger.error("ig_ingest_failed", { message: e instanceof Error ? e.message : String(e) });
    }
  }
  return summary;
}
