import { getEmailConfig, type EmailConfig } from "@/lib/mailer";
import { getSetting, setSetting } from "@/lib/app-settings";

/**
 * Who candidate-facing email comes from.
 *
 * The SMTP account is shared with the rest of Desgro, and its From address is a
 * global setting — changing that would move payslips and CRM mail too. Hiring
 * gets its own override instead, because the address a candidate should reply
 * to (hr@) is not the address finance sends from.
 *
 * NOTE for whoever sets this: Gmail and Workspace only send From an address the
 * logged-in account owns or has verified under "Send mail as". An unverified
 * alias is silently rewritten back to the login address. Reply-To is not
 * restricted that way, which is why it falls back to this same address — even
 * where the From cannot be changed, replies still reach the right inbox.
 */
export const HIRING_FROM_ADDR_KEY = "hiring_email_from_address";
export const HIRING_FROM_NAME_KEY = "hiring_email_from_name";

/** Deliberately loose — a real address check is a delivery attempt, not a regex. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidSenderAddress(value: string): boolean {
  return EMAIL.test(value.trim());
}

export async function getHiringSender(): Promise<{ address: string | null; name: string | null }> {
  const [address, name] = await Promise.all([
    getSetting(HIRING_FROM_ADDR_KEY),
    getSetting(HIRING_FROM_NAME_KEY),
  ]);
  const a = address?.trim() ?? "";
  return { address: a && isValidSenderAddress(a) ? a : null, name: name?.trim() || null };
}

export async function setHiringSender(
  address: string | null,
  name: string | null,
  userId?: string | null,
): Promise<void> {
  await setSetting(HIRING_FROM_ADDR_KEY, address?.trim() ?? "", userId);
  await setSetting(HIRING_FROM_NAME_KEY, name?.trim() ?? "", userId);
}

/**
 * The email config hiring sends with: the shared SMTP account, addressed as
 * hiring rather than as whoever the global default is.
 */
export async function getHiringEmailConfig(): Promise<EmailConfig | null> {
  const cfg = await getEmailConfig();
  if (!cfg) return null;

  const { address, name } = await getHiringSender();
  if (!address) return cfg;

  return {
    ...cfg,
    fromAddress: address,
    fromName: name || cfg.fromName,
    // Replies go to hiring even when Gmail rewrites the From to the login
    // mailbox — this is the half that always works.
    replyTo: address,
  };
}
