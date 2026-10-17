import { siteBaseUrl } from "@/lib/site-url";

/**
 * The address every agreement link points at — signing links, the in-app link
 * DESMA signers get, and the verify link printed on the certificate.
 *
 * Production always uses DESMA's own domain, never whichever host the sender
 * happened to be on (the vercel.app address leaked into client emails that
 * way). ESIGN_PUBLIC_BASE_URL overrides it; previews and local runs keep their
 * own host so their links work there.
 */
export const ESIGN_PUBLIC_ORIGIN = "https://desgro.in";

export function esignBaseUrl(req: Request): string {
  const override = process.env.ESIGN_PUBLIC_BASE_URL?.trim();
  if (override) return override.replace(/\/$/, "");
  if (process.env.VERCEL_ENV === "production") return ESIGN_PUBLIC_ORIGIN;
  return siteBaseUrl(req);
}
