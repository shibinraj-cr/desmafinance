import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess, canEditLead } from "@/lib/crm-rbac";
import { recordLeadActivity, type CrmActivityType } from "@/lib/crm-activity";

export const dynamic = "force-dynamic";

const CALL_OUTCOMES = ["connected", "no_answer", "busy", "wrong_number"] as const;
const OUTCOME_LABEL: Record<string, string> = {
  connected: "Connected",
  no_answer: "No answer",
  busy: "Busy",
  wrong_number: "Wrong number",
};

const CommSchema = z.discriminatedUnion("channel", [
  z.object({
    channel: z.literal("email"),
    subject: z.string().max(300).optional(),
    body: z.string().max(10000).optional(),
  }),
  z.object({
    channel: z.literal("whatsapp"),
    body: z.string().max(10000).optional(),
  }),
  z.object({
    channel: z.literal("call"),
    outcome: z.enum(CALL_OUTCOMES),
    durationSec: z.number().int().min(0).max(86400).optional(),
    note: z.string().max(2000).optional(),
  }),
]);

// POST /api/crm/leads/[id]/comms — log/send a communication.
// Phase 1: deep links (mailto / wa.me / tel) + activity logging. There is no
// email/SMS provider wired in this repo; when one is added (Phase 2) the email
// branch can send server-side and degrade to mailto only when unset.
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    select: { id: true, assignedToId: true, email: true, phone: true, phoneE164: true },
  });
  if (!lead) throw notFound();
  if (!canEditLead(access, lead, userId)) throw forbidden();

  const data = CommSchema.parse(await req.json().catch(() => null));

  if (data.channel === "email") {
    if (!lead.email) throw badRequest("Lead has no email address", "no_email");
    const subject = data.subject ?? "";
    const body = data.body ?? "";
    const mailtoUrl =
      `mailto:${encodeURIComponent(lead.email)}` +
      `?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    await logComm(params.id, userId, "EMAIL_SENT", `Emailed ${lead.email}`, {
      to: lead.email,
      subject,
      body,
      delivery: "mailto",
    });
    return NextResponse.json({ channel: "email", mailtoUrl, delivery: "mailto" });
  }

  if (data.channel === "whatsapp") {
    if (!lead.phoneE164) throw badRequest("Lead has no usable phone number", "no_phone");
    const text = data.body ?? "";
    const url = `https://wa.me/${lead.phoneE164.replace(/[^0-9]/g, "")}` + (text ? `?text=${encodeURIComponent(text)}` : "");

    await logComm(params.id, userId, "WHATSAPP_SENT", `WhatsApp to ${lead.phoneE164}`, {
      to: lead.phoneE164,
      message: text,
    });
    return NextResponse.json({ channel: "whatsapp", url });
  }

  // call
  const outcomeLabel = OUTCOME_LABEL[data.outcome];
  await logComm(
    params.id,
    userId,
    "CALL_LOGGED",
    `Call logged: ${outcomeLabel}${data.durationSec ? ` (${data.durationSec}s)` : ""}`,
    { outcome: data.outcome, durationSec: data.durationSec ?? null, note: data.note ?? null },
  );
  return NextResponse.json({ channel: "call", telUrl: lead.phone ? `tel:${lead.phone}` : null });
});

async function logComm(
  leadId: string,
  actorId: string,
  type: CrmActivityType,
  summary: string,
  metadata: Record<string, unknown>,
) {
  await recordLeadActivity({ leadId, actorId, type, summary, metadata });
}
