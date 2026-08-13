/**
 * Which transport is live right now.
 *
 * One setting — `wa_provider` — is the entire cutover switch. Nothing above this
 * function knows whether a message went out through a Wabis workflow or straight
 * to Meta, which is the whole point of the seam: the inbox, the outbox and the
 * drip scheduler are written once and keep working when the number moves.
 *
 * Resolution is deliberately fail-safe rather than fail-fast. A setting naming a
 * transport we cannot serve falls back to the one we can, loudly, because the
 * alternative is that a typo in an admin field silently stops every WhatsApp
 * send in the CRM.
 */
import { getSetting, WA_PROVIDER_KEY } from "../app-settings";
import { logger } from "../logger";
import { wabisProvider } from "./wabis-provider";
import type { WhatsAppProvider } from "./provider";

/**
 * Adapters that actually exist. The Cloud API adapter lands with the cutover
 * (phase 4); until then `wa_provider = "cloud"` is a configuration the code
 * cannot honour, and saying so beats pretending.
 */
const PROVIDERS: Record<string, WhatsAppProvider> = {
  wabis: wabisProvider,
};

export async function getWaProvider(): Promise<WhatsAppProvider> {
  const key = (await getSetting(WA_PROVIDER_KEY).catch(() => null))?.trim() || "wabis";
  const provider = PROVIDERS[key];
  if (provider) return provider;

  logger.warn("wa_provider_unavailable", { configured: key, fallback: wabisProvider.key });
  return wabisProvider;
}
