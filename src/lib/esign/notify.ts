import { prisma } from "@/lib/prisma";
import { fillTemplate } from "@/lib/crm";
import { recordLeadActivity } from "@/lib/crm-activity";
import { friendlySmtpError, getEmailConfig, sendEmail } from "@/lib/mailer";
import { renderTemplatePreview } from "@/lib/wa/cloud-provider";
import { findOrCreateConversationForLead } from "@/lib/wa/mirror";
import { sendWaMessage } from "@/lib/wa/send";
import type { WaTemplateSpec } from "@/lib/wa/template-spec";
import { formatLongDate } from "@/lib/esign/merge-values";
import { agreementWaParams, maskEmail, maskPhone } from "@/lib/esign/requests";

/**
 * Sending a signer their link: an email and, for the client, the template's
 * approved WhatsApp message.
 *
 * Each channel is tried independently and reported separately — one failing
 * never stops the other, and the caller records exactly what reached whom.
 * WhatsApp only ever SENDS an approved template through the existing
 * conversation code; nothing here touches the webhook or WABA settings.
 */

export type ChannelResult = {
  channel: "email" | "whatsapp";
  ok: boolean;
  /** Masked recipient, safe for the audit trail. */
  to: string | null;
  detail?: string;
};

export const DEFAULT_EMAIL_SUBJECT = "Your {agreement} from DESMA is ready to sign";
export const DEFAULT_EMAIL_BODY = [
  "Dear {name},",
  "",
  "Your {agreement} from DESMA International is ready for you to review and sign.",
  "",
  "Open it here:",
  "{link}",
  "",
  "This link is personal to you and works until {expires}. You will be asked for a one-time code before signing.",
  "",
  "If you have any questions, reply to this email or call your DESMA consultant.",
  "",
  "Regards,",
  "DESMA International",
].join("\n");

type NotifyInput = {
  request: { id: string; reference: string; expiresAt: Date; message: string | null; leadId: string | null };
  template: { name: string; emailSubject: string | null; emailBody: string | null; whatsappTemplateName: string | null };
  signer: { id: string; role: string; name: string; email: string | null; phone: string | null };
  link: string;
  token: string;
  actorId: string;
};

export async function notifySigner(input: NotifyInput): Promise<ChannelResult[]> {
  const results: ChannelResult[] = [];
  if (input.signer.email) results.push(await sendInviteEmail(input));
  if (input.signer.role === "Client" && input.template.whatsappTemplateName && input.request.leadId) {
    results.push(await sendInviteWhatsApp(input));
  }
  return results;
}

function inviteVars(input: NotifyInput) {
  return {
    name: input.signer.name,
    first_name: input.signer.name.split(/\s+/)[0] ?? input.signer.name,
    agreement: input.template.name,
    reference: input.request.reference,
    link: input.link,
    expires: formatLongDate(input.request.expiresAt),
  };
}

/** The email text: the template's wording (or ours), the staff note, and always the link. */
export function inviteEmail(input: Pick<NotifyInput, "template" | "request" | "signer" | "link">): { subject: string; text: string } {
  const vars = inviteVars(input as NotifyInput);
  const subject = fillTemplate(input.template.emailSubject || DEFAULT_EMAIL_SUBJECT, vars).replace(/\s+/g, " ").trim();
  let text = fillTemplate(input.template.emailBody || DEFAULT_EMAIL_BODY, vars);
  // A custom body that forgot {link} would send an email the client cannot act on.
  if (!text.includes(input.link)) text += `\n\nOpen and sign your agreement here:\n${input.link}`;
  if (input.request.message?.trim()) text = `${input.request.message.trim()}\n\n${text}`;
  return { subject, text };
}

async function sendInviteEmail(input: NotifyInput): Promise<ChannelResult> {
  const to = input.signer.email!;
  const base = { channel: "email" as const, to: maskEmail(to) };
  const cfg = await getEmailConfig().catch(() => null);
  if (!cfg) return { ...base, ok: false, detail: "Email is not set up (CRM → Settings → Integrations)." };
  const { subject, text } = inviteEmail(input);
  try {
    const { messageId } = await sendEmail(cfg, { to, subject, text });
    if (input.request.leadId) {
      // Logged like any CRM email so it shows on the timeline and counts
      // against the daily Gmail quota ("delivery: gmail").
      await recordLeadActivity({
        leadId: input.request.leadId,
        actorId: input.actorId,
        type: "EMAIL_SENT",
        summary: `Agreement sent for signature: ${input.request.reference}`,
        metadata: { channel: "email", via: "esign", delivery: "gmail", to, messageId, esignRequestId: input.request.id },
      });
    }
    return { ...base, ok: true };
  } catch (e) {
    return { ...base, ok: false, detail: friendlySmtpError(e) };
  }
}

async function sendInviteWhatsApp(input: NotifyInput): Promise<ChannelResult> {
  const name = input.template.whatsappTemplateName!;
  const lead = await prisma.lead.findUnique({
    where: { id: input.request.leadId! },
    select: { id: true, phoneE164: true, assignedToId: true, whatsappOptedOutAt: true, whatsappUndeliverableAt: true },
  });
  const base = { channel: "whatsapp" as const, to: maskPhone(lead?.phoneE164) };
  if (!lead?.phoneE164) return { ...base, ok: false, detail: "The lead has no phone number." };
  if (lead.whatsappOptedOutAt) return { ...base, ok: false, detail: "The client opted out of WhatsApp messages." };
  if (lead.whatsappUndeliverableAt) return { ...base, ok: false, detail: "This number is marked as not on WhatsApp." };

  const tpl = await prisma.waTemplate.findFirst({
    where: { name, status: "APPROVED" },
    select: { name: true, language: true, spec: true },
  });
  if (!tpl) return { ...base, ok: false, detail: `WhatsApp template "${name}" is not approved by Meta yet.` };
  const spec = tpl.spec as unknown as WaTemplateSpec | null;
  if (!spec?.body) return { ...base, ok: false, detail: `WhatsApp template "${name}" has no saved wording in DesGro; sync templates first.` };

  const vals = {
    clientName: input.signer.name,
    agreementName: input.template.name,
    link: input.link,
    token: input.token,
    expires: formatLongDate(input.request.expiresAt),
  };
  const params = agreementWaParams(spec, vals);
  if (!params) {
    return { ...base, ok: false, detail: `WhatsApp template "${name}" has placeholders an agreement cannot fill.` };
  }

  const conv = await findOrCreateConversationForLead({ id: lead.id, phoneE164: lead.phoneE164, assignedToId: lead.assignedToId });
  if (!conv.ok) return { ...base, ok: false, detail: "This number's WhatsApp thread belongs to another lead." };

  // The inbox copy shows the link without its token: the token is a
  // credential and should live only in the message the client received.
  const masked = agreementWaParams(spec, { ...vals, link: input.link.replace(input.token, "••••"), token: "••••" }) ?? params;
  const out = await sendWaMessage({
    conversationId: conv.conversationId,
    sentById: input.actorId,
    template: `${tpl.name}:${tpl.language}`,
    templateParams: params,
    renderedBody: renderTemplatePreview(spec.body, masked),
  });
  if (out.ok) return { ...base, ok: true };
  return {
    ...base,
    ok: false,
    detail:
      out.reason === "unsupported"
        ? "WhatsApp Cloud API is not switched on, so WhatsApp could not be used."
        : out.detail || "WhatsApp did not accept the message.",
  };
}
