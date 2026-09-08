import { getEmailConfig, DEFAULT_DAILY_CAP, type EmailConfig } from "@/lib/mailer";
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

/**
 * Hiring's OWN mailbox login, when it has one.
 *
 * The From override above only relabels mail sent through the shared account,
 * and Google will not let you relabel as an address that account has not been
 * granted — which is exactly the wall you hit when "Send mail as" is missing or
 * an admin has switched it off. Signing in as the hiring mailbox sidesteps the
 * question: the mail genuinely originates there, so there is nothing to verify.
 *
 * Falls back to the shared account when unset, so this stays optional.
 */
export const HIRING_SMTP_USER_KEY = "hiring_email_smtp_user";
export const HIRING_SMTP_PASS_KEY = "hiring_email_smtp_pass";

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
  const shared = await getEmailConfig();
  const [{ address, name }, own] = await Promise.all([getHiringSender(), getHiringSmtp()]);

  // Hiring's own mailbox wins. It does not need the shared account to exist at
  // all — a company can run hiring mail entirely from hr@ and never configure
  // the global sender.
  const base: EmailConfig | null = own
    ? {
        user: own.user,
        pass: own.pass,
        fromName: name || shared?.fromName || null,
        fromAddress: address || own.user,
        replyTo: address || own.user,
        dailyCap: shared?.dailyCap ?? DEFAULT_DAILY_CAP,
      }
    : shared;

  if (!base) return null;
  if (own || !address) return base;

  return {
    ...base,
    fromAddress: address,
    fromName: name || base.fromName,
    // Replies go to hiring even when Gmail rewrites the From to the login
    // mailbox — this is the half that always works.
    replyTo: address,
  };
}

/** Hiring's own SMTP login, or null when it sends through the shared account. */
export async function getHiringSmtp(): Promise<{ user: string; pass: string } | null> {
  const [user, pass] = await Promise.all([
    getSetting(HIRING_SMTP_USER_KEY),
    getSetting(HIRING_SMTP_PASS_KEY),
  ]);
  const u = user?.trim();
  const p = pass?.trim();
  return u && p ? { user: u, pass: p } : null;
}

/**
 * The saved mailbox login, even when no password is stored alongside it — so a
 * half-filled form shows what was entered rather than looking blank.
 */
export async function getHiringSmtpUser(): Promise<string | null> {
  return (await getSetting(HIRING_SMTP_USER_KEY))?.trim() || null;
}

export async function setHiringSmtp(
  user: string | null,
  /** Undefined leaves the stored password alone; "" clears it. */
  pass: string | undefined,
  userId?: string | null,
): Promise<void> {
  await setSetting(HIRING_SMTP_USER_KEY, user?.trim() ?? "", userId);
  // App passwords are pasted with the spaces Google displays them with.
  if (pass !== undefined) await setSetting(HIRING_SMTP_PASS_KEY, pass.replace(/\s+/g, ""), userId);
}
