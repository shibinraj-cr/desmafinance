import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { buildLeadMergeVars, fillTemplate } from "@/lib/crm";
import { getEmailConfig, getDailyQuota, sendEmail, smtpErrorInfo } from "@/lib/mailer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // nodemailer (SMTP)
export const maxDuration = 60; // use the full serverless window for the send loop

// One request emails at most this many leads; the client chunks larger
// selections so each request stays well inside the function timeout. Kept small
// because SMTP sends are sequential (~0.3–0.6s each) — 50 ≈ 30s, leaving margin
// under maxDuration so a request never times out mid-send.
const MAX_PER_REQUEST = 60;

const BodySchema = z.object({
  leadIds: z.array(z.string().min(1)).min(1).max(MAX_PER_REQUEST),
  // Single-line: reject CR/LF so a merged subject can never inject mail headers.
  subject: z.string().trim().min(1).max(300).regex(/^[^\r\n]+$/, "Subject can't contain line breaks"),
  body: z.string().min(1).max(20000),
});

/** Merge tokens available in a bulk subject/body, derived from one lead. */
function mergeVars(lead: {
  candidateName: string;
  campaign: string | null;
  service: { name: string } | null;
  qualification: { label: string } | null;
  assignedTo: { username: string; leadPulseRole: { displayName: string; phone: string | null } | null } | null;
}): Record<string, string> {
  return buildLeadMergeVars({
    candidateName: lead.candidateName,
    service: lead.service?.name,
    consultant: lead.assignedTo?.leadPulseRole?.displayName ?? lead.assignedTo?.username,
    consultantPhone: lead.assignedTo?.leadPulseRole?.phone,
    campaign: lead.campaign,
    qualification: lead.qualification?.label,
  });
}

// POST /api/crm/leads/bulk-email — send an individual, merge-filled email to
// each of the given leads (admin-only). One EMAIL_SENT activity is written per
// lead so the message shows on the lead's timeline; Gmail files a copy in the
// sender mailbox's Sent folder. Honours a soft daily cap.
export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canBulkEmail) throw forbidden();

  const parsed = BodySchema.parse(await req.json().catch(() => null));
  const { subject, body } = parsed;
  // Dedupe so a repeated id (a buggy/retried caller) can't email a lead twice.
  const leadIds = Array.from(new Set(parsed.leadIds));

  const cfg = await getEmailConfig();
  if (!cfg) throw badRequest("Email sender is not configured. Set it up in Settings → Integrations.", "email_not_configured");

  const quota = await getDailyQuota(cfg);
  if (quota.remaining <= 0) {
    return NextResponse.json({
      requested: leadIds.length,
      sent: 0,
      failed: 0,
      skippedNoEmail: 0,
      skippedCap: leadIds.length,
      capReached: true,
      remaining: 0,
    });
  }

  // Load the requested leads, then iterate in the caller's order.
  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds } },
    select: {
      id: true,
      candidateName: true,
      email: true,
      campaign: true,
      service: { select: { name: true } },
      qualification: { select: { label: true } },
      assignedTo: { select: { username: true, leadPulseRole: { select: { displayName: true, phone: true } } } },
    },
  });
  const byId = new Map(leads.map((l) => [l.id, l]));

  let sent = 0;
  let failed = 0;
  let skippedNoEmail = 0;
  let skippedCap = 0;
  let rateLimited = false;
  const failures: { leadId: string; error: string }[] = [];
  const sentLeadIds: string[] = [];

  for (let i = 0; i < leadIds.length; i++) {
    const lead = byId.get(leadIds[i]);
    if (!lead) continue; // stale id — silently skip
    if (!lead.email) {
      skippedNoEmail++;
      continue;
    }
    if (sent >= quota.remaining) {
      skippedCap++;
      continue;
    }

    const vars = mergeVars(lead);
    const renderedSubject = fillTemplate(subject, vars);
    const renderedBody = fillTemplate(body, vars);
    try {
      const { messageId } = await sendEmail(cfg, { to: lead.email, subject: renderedSubject, text: renderedBody });
      sent++;
      sentLeadIds.push(lead.id);
      // Log immediately (not batched at the end) so a timeout mid-loop can never
      // leave an email sent-but-unlogged. One create per send is fine at this scale.
      await prisma.leadActivity.create({
        data: {
          leadId: lead.id,
          actorId: userId,
          type: "EMAIL_SENT",
          summary: `Emailed ${lead.email}`,
          metadata: { to: lead.email, subject: renderedSubject, body: renderedBody, delivery: "gmail", messageId, bulk: true },
        },
      });
    } catch (e) {
      const info = smtpErrorInfo(e);
      // Gmail throttling / daily-quota: stop — every further send would fail the
      // same way. The rest count as cap-skipped so the client reports "try later".
      if (info.rateLimited) {
        rateLimited = true;
        skippedCap += leadIds.length - i - 1;
        break;
      }
      failed++;
      failures.push({ leadId: lead.id, error: info.message });
    }
  }

  // Bump lastActivityAt for the leads we emailed (one updateMany; non-critical,
  // so it's fine that it only runs if the loop completes).
  if (sentLeadIds.length) {
    await prisma.lead.updateMany({ where: { id: { in: sentLeadIds } }, data: { lastActivityAt: new Date() } });
  }

  return NextResponse.json({
    requested: leadIds.length,
    sent,
    failed,
    skippedNoEmail,
    skippedCap,
    rateLimited,
    capReached: skippedCap > 0,
    // 0 tells the client to stop sending further chunks (quota/throttle hit).
    remaining: rateLimited ? 0 : Math.max(0, quota.remaining - sent),
    failures: failures.slice(0, 20),
  });
});
