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
