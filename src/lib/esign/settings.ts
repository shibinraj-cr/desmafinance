import { getSetting, setSetting } from "@/lib/app-settings";

/**
 * Whether agreements may actually be sent to clients.
 *
 * Off by default, because the signing page (`/sign/[token]`) arrives in
 * Phase 3: until it exists, a sent link would open on a 404 for the client.
 * Drafts and the PDF preview work either way. An admin turns this on from the
 * Agreements page once signing is live.
 */
export const ESIGN_SENDING_KEY = "esign_sending_enabled";

export async function isSendingEnabled(): Promise<boolean> {
  return (await getSetting(ESIGN_SENDING_KEY).catch(() => null)) === "true";
}

export async function setSendingEnabled(on: boolean, userId: string | null): Promise<void> {
  await setSetting(ESIGN_SENDING_KEY, on ? "true" : "false", userId);
}

/**
 * Optional approved WhatsApp AUTHENTICATION template ("name:language") for
 * one-time codes. Without it codes go by email only, so clients need an email.
 */
export const ESIGN_OTP_WA_TEMPLATE_KEY = "esign_otp_wa_template";

export async function getOtpWhatsAppTemplate(): Promise<string | null> {
  return (await getSetting(ESIGN_OTP_WA_TEMPLATE_KEY).catch(() => null))?.trim() || null;
}

/**
 * Addresses that receive every signed agreement, on top of the signers, the
 * CC list and the sender. Comma-separated; defaults to DESMA's main inbox.
 */
export const ESIGN_SIGNED_COPY_TO_KEY = "esign_signed_copy_to";
export const DEFAULT_SIGNED_COPY_TO = "hello@desma.in";

export async function signedCopyRecipients(): Promise<string[]> {
  const raw = (await getSetting(ESIGN_SIGNED_COPY_TO_KEY).catch(() => null)) ?? DEFAULT_SIGNED_COPY_TO;
  return raw
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
}
