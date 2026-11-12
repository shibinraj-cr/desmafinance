/**
 * Candidate referral links — the database side. Pure rules (codes, names,
 * classification) live in ./crm-referral-link.ts.
 *
 * Three moments:
 *   - a consultant opens a lead and asks for its link (getOrCreateReferralLink);
 *   - a stranger opens /r/<code> (recordReferralVisit, from the page's beacon);
 *   - they send the form (submitReferral), which makes a new lead filed under
 *     the candidate, or folds them onto the lead they already have.
 */
import { randomInt } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { computeDedupeKey, emailKeyOf, normalizePhone, phoneMatchKeys } from "./crm";
import { resolveDefaultStatus, resolveQualificationOther } from "./crm-leads";
import { recordLeadActivity } from "./crm-activity";
import { marketingAdminUserIds } from "./crm-notify";
import { notifySupervisorOfReInquiries, recordReInquiry, resolveReInquiryContext } from "./crm-reinquiry";
import { istToday } from "./dates";
import { badRequest } from "./http-error";
import { logger } from "./logger";
import {
  REFERRAL_LINK_SOURCE_CODE,
  REFERRAL_LINK_SOURCE_LABEL,
  classifyReferralSubmission,
  generateReferralCode,
  normalizeReferralCode,
  referralReInquirySource,
  referralUrl,
  REFERRED_LIST_LIMIT,
  normalizeRewardStatus,
  type LeadReferralDTO,
  type ReferralOutcome,
} from "./crm-referral-link";

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/**
 * The "Referral Link" source row. By code first; by label second, for a
 * deployment where an admin had made one by hand before the migration ran (it
 * then skipped its own insert rather than duplicate it).
 */
export async function resolveReferralSourceId(): Promise<string | null> {
  const byCode = await prisma.leadPulseSource.findUnique({ where: { code: REFERRAL_LINK_SOURCE_CODE }, select: { id: true } });
  if (byCode) return byCode.id;
  const byLabel = await prisma.leadPulseSource.findFirst({
    where: { label: { equals: REFERRAL_LINK_SOURCE_LABEL, mode: "insensitive" } },
    select: { id: true },
  });
  return byLabel?.id ?? null;
}

/**
 * The lead's link, made on first ask. Safe to call from two tabs at once: the
 * loser of the race on `referrerLeadId` reads the winner's row. A collision on
 * the random code itself just draws again.
 */
export async function getOrCreateReferralLink(leadId: string, actorId: string | null) {
  const existing = await prisma.crmReferralLink.findUnique({ where: { referrerLeadId: leadId } });
  if (existing) return existing;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode((max) => randomInt(max));
    try {
      return await prisma.crmReferralLink.create({ data: { code, referrerLeadId: leadId, createdById: actorId } });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const raced = await prisma.crmReferralLink.findUnique({ where: { referrerLeadId: leadId } });
      if (raced) return raced;
    }
  }
  throw new Error("Could not draw an unused referral code");
}

const LINK_SELECT = {
  id: true,
  code: true,
  active: true,
  referrerLeadId: true,
  referrerLead: { select: { candidateName: true, phoneE164: true, altPhoneE164: true, emailKey: true } },
} satisfies Prisma.CrmReferralLinkSelect;

export type PublicReferralLink = Prisma.CrmReferralLinkGetPayload<{ select: typeof LINK_SELECT }>;

/** The link behind a /r/<code> URL, or null for a code that isn't one. */
export async function findReferralLink(rawCode: string): Promise<PublicReferralLink | null> {
  const code = normalizeReferralCode(rawCode);
  if (!code) return null;
  return prisma.crmReferralLink.findUnique({ where: { code }, select: LINK_SELECT });
}

/** One page open, on today's IST row. */
export async function recordReferralVisit(linkId: string, now: Date = new Date()): Promise<void> {
  const { year, month, day } = istToday(now);
  const date = new Date(Date.UTC(year, month - 1, day));
  await prisma.crmReferralVisitDay.upsert({
    where: { linkId_day: { linkId, day: date } },
    create: { linkId, day: date, visits: 1 },
    update: { visits: { increment: 1 } },
  });
}

/** Said for a number too short to parse and for one that won't normalise alike. */
export const INVALID_PHONE_MESSAGE = "Enter your WhatsApp number with the country code, e.g. +91 98470 12345.";

export type ReferralFormInput = {
  name: string;
  phone: string;
  email?: string | null;
  qualificationId?: string | null;
  qualificationOther?: string | null;
  serviceId?: string | null;
};

/**
 * Take one form. Never tells the sender which way it went — the page thanks
 * everyone the same, so it can't be used to test whether a number is already a
 * DESMA candidate.
 */
export async function submitReferral(
  link: PublicReferralLink,
  input: ReferralFormInput,
  opts: { baseUrl?: string } = {},
): Promise<{ outcome: ReferralOutcome; leadId: string }> {
  const phoneE164 = normalizePhone(input.phone);
  if (!phoneE164) throw badRequest(INVALID_PHONE_MESSAGE, "invalid_phone");
  const email = input.email?.trim() || null;
  const emailKey = emailKeyOf(email);

  const identity: Prisma.LeadWhereInput[] = [{ phoneE164 }, { altPhoneE164: phoneE164 }];
  if (emailKey) identity.push({ emailKey });
  // Oldest lead on the identity = the canonical one a re-inquiry folds onto,
  // the same rule as every other entry point.
  const existing = await prisma.lead.findFirst({ where: { OR: identity }, orderBy: { createdAt: "asc" }, select: { id: true } });

  const referrer = link.referrerLead;
  const outcome = classifyReferralSubmission({
    referrer: { phoneKeys: phoneMatchKeys(referrer.phoneE164, referrer.altPhoneE164), emailKey: referrer.emailKey },
    submitted: { phoneE164, emailKey },
    existingLeadId: existing?.id ?? null,
    linkActive: link.active,
  });

  if (outcome === "self") {
    // The candidate trying their own link. Logged so the tally can say so, and
    // nothing else: a re-inquiry would hand their consultant a pointless task.
    await logSubmission(link.id, existing?.id ?? link.referrerLeadId, outcome);
    return { outcome, leadId: existing?.id ?? link.referrerLeadId };
  }

  if (outcome === "existing" && existing) {
    await foldOntoExisting(existing.id, referrer.candidateName, opts.baseUrl);
    await logSubmission(link.id, existing.id, outcome);
    return { outcome, leadId: existing.id };
  }

  const leadId = await createReferredLead(link, input, { phoneE164, email, emailKey, credited: outcome === "created" });
  await logSubmission(link.id, leadId, outcome);
  return { outcome, leadId };
}

async function foldOntoExisting(leadId: string, referrerName: string, baseUrl?: string): Promise<void> {
  const ctx = await resolveReInquiryContext();
  const reInquiry = await recordReInquiry({ leadId, source: referralReInquirySource(referrerName), campaign: null }, ctx);
  if (reInquiry) await notifySupervisorOfReInquiries([reInquiry], ctx, baseUrl);
}

async function createReferredLead(
  link: PublicReferralLink,
  input: ReferralFormInput,
  id: { phoneE164: string; email: string | null; emailKey: string | null; credited: boolean },
): Promise<string> {
  const [status, subStatus, sourceId, qualification, service] = await Promise.all([
    resolveDefaultStatus(),
    prisma.crmLeadSubStatus.findFirst({ where: { isDefault: true, active: true }, select: { id: true } }),
    resolveReferralSourceId(),
    input.qualificationId
      ? prisma.crmQualification.findFirst({ where: { id: input.qualificationId, active: true }, select: { id: true } })
      : null,
    input.serviceId ? prisma.service.findFirst({ where: { id: input.serviceId, isActive: true }, select: { id: true } }) : null,
  ]);
  if (!status) throw new Error("No lead stages are configured");
  if (!sourceId) logger.warn("referral_source_missing", { code: REFERRAL_LINK_SOURCE_CODE });

  // No externalKey: the phone/email lookup above is the dedupe, as for a lead
  // typed in by hand. (A key on the phone would outlive a consultant correcting
  // the number, and then swallow the next person who really has it.)
  const lead = await prisma.lead.create({
    data: {
      candidateName: input.name.trim(),
      phone: input.phone.trim(),
      phoneE164: id.phoneE164,
      email: id.email,
      emailKey: id.emailKey,
      dedupeKey: computeDedupeKey(id.email, id.phoneE164),
      sourceId,
      serviceId: service?.id ?? null,
      qualificationId: qualification?.id ?? null,
      qualificationOther: await resolveQualificationOther(qualification?.id ?? null, input.qualificationOther),
      statusId: status.id,
      subStatusId: subStatus?.id ?? null,
      subStatusSince: subStatus ? new Date() : null,
      // Born unassigned, like every referral: the Marketing Admin hands it out.
      referredByLeadId: id.credited ? link.referrerLeadId : null,
    },
    select: { id: true, candidateName: true },
  });

  const referrerName = link.referrerLead.candidateName;
  await recordLeadActivity({
    leadId: lead.id,
    type: "LEAD_CREATED",
    summary: id.credited
      ? `Created from ${referrerName}'s referral link`
      : `Created from ${referrerName}'s referral link, which is switched off — not credited`,
    metadata: { channel: "referral_link", linkId: link.id, referrerLeadId: link.referrerLeadId, credited: id.credited },
  });
  await notifyReferralLead(lead.id, lead.candidateName, referrerName);
  return lead.id;
}

async function logSubmission(linkId: string, leadId: string, outcome: ReferralOutcome): Promise<void> {
  try {
    await prisma.crmReferralSubmission.create({ data: { linkId, leadId, outcome } });
  } catch (e) {
    // The lead is what matters and it is already safe; the tally is a count.
    logger.warn("referral_submission_log_failed", { linkId, outcome, error: String(e) });
  }
}

/** Best-effort bell for the people who hand out leads. Never throws. */
async function notifyReferralLead(leadId: string, candidateName: string, referrerName: string): Promise<void> {
  try {
    const admins = await marketingAdminUserIds();
    if (admins.length === 0) return;
    await prisma.crmNotification.createMany({
      data: admins.map((userId) => ({
        userId,
        kind: "referral_lead",
        title: "New referral lead",
        body: `${candidateName} registered through ${referrerName}'s referral link. Assign a consultant.`,
        linkUrl: `/crm/leads/${leadId}`,
        leadId,
      })),
    });
  } catch (e) {
    logger.warn("referral_notify_failed", { leadId, error: String(e) });
  }
}

// ── The lead page ───────────────────────────────────────────────────────────

const ENROLLED_STATUS_CODE = "enrolled";

/** Everything the lead page's referral card shows. */
export async function loadLeadReferral(
  lead: { id: string; referredByLeadId: string | null },
  baseUrl: string,
): Promise<LeadReferralDTO> {
  const [link, referredBy, referred, leads, enrolled, rewards, rewardEarned] = await Promise.all([
    prisma.crmReferralLink.findUnique({ where: { referrerLeadId: lead.id }, select: { id: true, code: true, active: true } }),
    lead.referredByLeadId
      ? prisma.lead.findUnique({ where: { id: lead.referredByLeadId }, select: { id: true, candidateName: true } })
      : null,
    prisma.lead.findMany({
      where: { referredByLeadId: lead.id },
      orderBy: { createdAt: "desc" },
      take: REFERRED_LIST_LIMIT,
      select: { id: true, candidateName: true, createdAt: true, status: { select: { code: true, label: true, color: true } } },
    }),
    prisma.lead.count({ where: { referredByLeadId: lead.id } }),
    prisma.lead.count({ where: { referredByLeadId: lead.id, status: { code: ENROLLED_STATUS_CODE } } }),
    // Every reward this candidate is owed or was paid, keyed by the referred lead.
    prisma.crmReferralReward.findMany({
      where: { referrerLeadId: lead.id, status: { in: ["due", "paid"] } },
      select: { referredLeadId: true, status: true, amount: true },
    }),
    prisma.crmReferralReward.findUnique({ where: { referredLeadId: lead.id }, select: { status: true, amount: true } }),
  ]);
  const rewardOf = new Map(rewards.map((r) => [r.referredLeadId, { status: normalizeRewardStatus(r.status), amount: Number(r.amount) }]));
  const sum = (status: string) => rewards.filter((r) => r.status === status).reduce((t, r) => t + Number(r.amount), 0);

  let visits = 0;
  let existing = 0;
  if (link) {
    const [v, e] = await Promise.all([
      prisma.crmReferralVisitDay.aggregate({ where: { linkId: link.id }, _sum: { visits: true } }),
      prisma.crmReferralSubmission.count({ where: { linkId: link.id, outcome: "existing" } }),
    ]);
    visits = v._sum.visits ?? 0;
    existing = e;
  }

  return {
    link: link ? { code: link.code, url: referralUrl(baseUrl, link.code), active: link.active } : null,
    tally: { visits, leads, enrolled, existing, rewardDue: sum("due"), rewardPaid: sum("paid") },
    referred: referred.map((r) => ({
      id: r.id,
      candidateName: r.candidateName,
      createdAt: r.createdAt.toISOString(),
      status: r.status,
      reward: rewardOf.get(r.id) ?? null,
    })),
    referredBy,
    rewardEarned: rewardEarned
      ? { status: normalizeRewardStatus(rewardEarned.status), amount: Number(rewardEarned.amount) }
      : null,
  };
}
