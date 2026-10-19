import { z } from "zod";
import type { TemplateField } from "@/lib/esign/template-fields";

/**
 * Agreement requests — the pure rules behind sending one.
 *
 * I/O lives in send.ts (building the PDF, storing it, notifying) and the API
 * routes. Things worth knowing first:
 *
 * - **Signers sign in order.** Everyone sharing the lowest `signOrder` gets a
 *   link when the agreement is sent; the next group only once those have
 *   signed (Phase 3). Usually that is just the client.
 * - **A link is a credential.** Only its SHA-256 is stored, so a link can never
 *   be shown again — "resend" mints a new one and the old one stops working.
 * - **Merge values are a snapshot.** What staff confirmed at send time is what
 *   the PDF says and what the request records, whatever the CRM says later.
 */

/** Page grant for creating, sending and tracking agreements (admins pass). */
export const AGREEMENTS_PAGE = "/operations/agreements";

export const ESIGN_REQUEST_BLOB_PREFIX = "esign/requests/";

export const MAX_EXPIRY_DAYS = 90;

export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Waiting to sign",
  viewed: "Opened",
  partially_signed: "Partly signed",
  signed: "Signed",
  declined: "Declined",
  expired: "Expired",
  cancelled: "Cancelled",
};

/** Audit-trail actions in words, for the history list and the certificate. */
export const EVENT_LABELS: Record<string, string> = {
  created: "Created",
  sent: "Sent for signature",
  notified: "Delivered",
  resent: "New link sent",
  opened: "Opened",
  otp_sent: "One-time code sent",
  otp_verified: "One-time code verified",
  otp_failed: "Wrong one-time code",
  field_saved: "Fields filled in",
  signed: "Signed",
  declined: "Declined",
  completed: "Completed",
  contact_changed: "Contact details changed",
  expiry_extended: "Expiry extended",
  cancelled: "Cancelled",
};

/** Statuses an agreement can still be changed, resent or cancelled in. */
export const OPEN_STATUSES = ["draft", "sent", "viewed", "partially_signed"] as const;
export const isOpenStatus = (s: string) => (OPEN_STATUSES as readonly string[]).includes(s);

const trimmed = (max: number) => z.string().trim().max(max);
const optionalEmail = z
  .string()
  .trim()
  .max(200)
  .nullable()
  .optional()
  .transform((v) => (v ? v.toLowerCase() : null))
  .refine((v) => v === null || z.string().email().safeParse(v).success, "That email address does not look right.");
const optionalPhone = z
  .string()
  .trim()
  .max(40)
  .nullable()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || (v.replace(/\D/g, "").length >= 10 && v.replace(/\D/g, "").length <= 15), "That phone number does not look right.");

export const SignerInputSchema = z.object({
  role: z.enum(["Client", "DESMA"]),
  /** DESMA staff picked from the staff list sign inside DesGro as this user. */
  userId: z.string().nullable().optional(),
  name: trimmed(200).min(1, "Every signer needs a name."),
  email: optionalEmail,
  phone: optionalPhone,
  signOrder: z.number().int().min(1).max(10),
});
export type SignerInput = z.infer<typeof SignerInputSchema>;

export const SendInputSchema = z.object({
  leadId: z.string().min(1),
  templateVersionId: z.string().min(1),
  mergeData: z.record(z.string().max(2000)),
  signers: z.array(SignerInputSchema).min(1).max(5),
  cc: z.array(z.object({ name: trimmed(200), email: z.string().trim().toLowerCase().email() })).max(10).default([]),
  expiresInDays: z.number().int().min(1).max(MAX_EXPIRY_DAYS),
  reminderDays: z.number().int().min(0).max(30),
  message: trimmed(2000).nullable().optional(),
  /** "draft" saves without sending; "send" issues links and notifies. */
  action: z.enum(["draft", "send"]),
  /** Continue an existing draft instead of starting a new request. */
  draftId: z.string().nullable().optional(),
});
export type SendInput = z.infer<typeof SendInputSchema>;

/** DESMA always signs first, then the client — whatever order was asked for. */
export function withSigningOrder<T extends { role: string; signOrder: number }>(signers: T[]): T[] {
  return signers.map((s) => ({ ...s, signOrder: s.role === "DESMA" ? 1 : 2 }));
}

/** "AHPRA Agreement – Client Name" */
export function requestReference(templateName: string, clientName: string): string {
  return `${templateName} – ${clientName}`.slice(0, 300);
}

/** Merge keys a version's fields need, in field order, without repeats. */
export function mergeKeysOf(fields: Pick<TemplateField, "mergeKey">[]): string[] {
  return Array.from(new Set(fields.map((f) => f.mergeKey).filter((k): k is string => !!k)));
}

/** Roles a version's fields expect to sign or fill (merge-only fields excluded). */
export function rolesOf(fields: Pick<TemplateField, "role" | "mergeKey">[]): Set<string> {
  return new Set(fields.filter((f) => !f.mergeKey).map((f) => f.role));
}

/**
 * Everything wrong with a send before any file is touched, in words staff can
 * act on. Drafts are allowed to be incomplete; sends are not.
 */
export function sendProblems(opts: {
  input: Pick<SendInput, "signers" | "mergeData" | "action">;
  fields: Pick<TemplateField, "role" | "mergeKey" | "label" | "key">[];
  /** A WhatsApp code template is set up, so external signers may sign without an email. */
  otpByWhatsApp?: boolean;
}): string[] {
  if (opts.input.action === "draft") return [];
  const problems: string[] = [];
  const missing = mergeKeysOf(opts.fields).filter((k) => !(opts.input.mergeData[k] ?? "").trim());
  if (missing.length) problems.push(`Fill in: ${missing.join(", ")}.`);

  const roles = rolesOf(opts.fields);
  if (!roles.has("DESMA")) {
    problems.push("This template has no boxes for DESMA. DESMA signs every agreement first, so add DESMA's signature box to the template.");
  }
  const byRole = new Map(opts.input.signers.map((s) => [s.role, s]));
  if (opts.input.signers.length !== byRole.size) problems.push("Each role can only have one signer.");
  for (const role of roles) {
    if (!byRole.has(role as SignerInput["role"])) {
      problems.push(role === "DESMA" ? "This template has fields for DESMA, so add a DESMA signer." : `Add a ${role} signer.`);
    }
  }
  for (const s of opts.input.signers) {
    const who = s.name.trim() || `The ${s.role} signer`;
    if (!s.name.trim()) problems.push(`${who} needs a name.`);
    if (!roles.has(s.role)) problems.push(`The template has nothing for ${s.role} to fill or sign; remove that signer.`);
    if (!s.email && !s.phone) problems.push(`${who} needs an email address or a WhatsApp number to receive the link.`);
    else if (!s.userId && !s.email && !opts.otpByWhatsApp) {
      problems.push(`${who} needs an email address: it is where their one-time signing code is sent.`);
    }
  }
  return problems;
}

/** The signers whose turn it is: everyone pending at the lowest order still pending. */
export function activeSigners<T extends { signOrder: number; status: string }>(signers: T[]): T[] {
  const pending = signers.filter((s) => !["signed", "declined", "cancelled"].includes(s.status));
  if (!pending.length) return [];
  const first = Math.min(...pending.map((s) => s.signOrder));
  return pending.filter((s) => s.signOrder === first);
}

/** End of the IST day `days` from now, so "valid 14 days" means what it says. */
export function expiryFrom(now: Date, days: number): Date {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffsetMs);
  const endOfIstDay = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + days, 23, 59, 59, 999);
  return new Date(endOfIstDay - istOffsetMs);
}

/** "c*******e@example.com" — enough to recognise in a log, not enough to harvest. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  const shown = user.length <= 2 ? user[0] + "*" : `${user[0]}${"*".repeat(Math.min(user.length - 2, 7))}${user[user.length - 1]}`;
  return `${shown}@${domain}`;
}

/** "•••• 3210" */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length < 4 ? "••••" : `•••• ${digits.slice(-4)}`;
}

/**
 * Parameters for the agreement's WhatsApp template, by convention:
 * body {{1}} client name, {{2}} agreement name, {{3}} signing link, {{4}} expiry
 * date (a template may use fewer); a header {{1}} is the agreement name; a URL
 * button whose address ends in {{1}} (e.g. https://desgro.in/sign/{{1}}) gets
 * the link token. Returns null when the template has slots this convention
 * cannot fill, so the caller reports it instead of sending a broken message.
 */
export function agreementWaParams(
  spec: { body: string; headerText: string | null; buttons: Array<{ type: string; url?: string }> },
  v: { clientName: string; agreementName: string; link: string; token: string; expires: string },
): Record<string, string> | null {
  const slots = (text: string | null | undefined) =>
    Array.from(new Set(Array.from((text ?? "").matchAll(/\{\{\s*(\d+)\s*\}\}/g), (m) => Number(m[1])))).sort((a, b) => a - b);
  const bodyValues = [v.clientName, v.agreementName, v.link, v.expires];
  const params: Record<string, string> = {};
  for (const n of slots(spec.body)) {
    if (n < 1 || n > bodyValues.length) return null;
    params[String(n)] = bodyValues[n - 1];
  }
  for (const n of slots(spec.headerText)) {
    if (n !== 1) return null;
    params["header.1"] = v.agreementName;
  }
  for (const [i, b] of spec.buttons.entries()) {
    if (b.type !== "URL" || !b.url) continue;
    const n = slots(b.url);
    if (n.length === 0) continue;
    if (n.length !== 1 || n[0] !== 1 || !/\{\{\s*1\s*\}\}\s*$/.test(b.url)) return null;
    params[`button.${i}.1`] = v.token;
  }
  return params;
}
