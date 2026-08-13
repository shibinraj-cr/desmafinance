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
import { cloudProvider, isCloudConfigured } from "./cloud-provider";
import type { WhatsAppProvider } from "./provider";

const PROVIDERS: Record<string, WhatsAppProvider> = {
  wabis: wabisProvider,
  cloud: cloudProvider,
};

export async function getWaProvider(): Promise<WhatsAppProvider> {
  const key = (await getSetting(WA_PROVIDER_KEY).catch(() => null))?.trim() || "wabis";
  const provider = PROVIDERS[key];

  if (!provider) {
    logger.warn("wa_provider_unknown", { configured: key, fallback: wabisProvider.key });
    return wabisProvider;
  }

  // Selecting "cloud" without credentials would make every send fail with a
  // configuration error rather than going out through the transport that still
  // works. Falling back keeps the CRM sending during a half-finished cutover,
  // which is exactly when this is most likely to be misconfigured.
  if (provider.key === "cloud" && !(await isCloudConfigured())) {
    logger.warn("wa_cloud_not_configured", { fallback: wabisProvider.key });
    return wabisProvider;
  }

  return provider;
}
