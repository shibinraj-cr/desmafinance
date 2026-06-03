/**
 * Resolve the public, shareable base URL of the app (no trailing slash).
 *
 * Used to build links we hand to external recipients — e.g. the psychometric
 * assignment link sent to an employee. These MUST point at the real public
 * domain, never at the internal `localhost:<port>` the Node process binds to.
 *
 * Resolution order (first match wins):
 *   1. APP_BASE_URL          — explicit public URL; set this in production
 *                              (e.g. https://desgro.in). Always correct.
 *   2. x-forwarded-host      — real client-facing host when behind a reverse
 *                              proxy (nginx / Vercel set this).
 *   3. NEXTAUTH_URL          — legacy fallback (also used by NextAuth).
 *   4. Host header           — last resort; raw upstream host in dev.
 */
export function siteBaseUrl(req: Request): string {
  const configured = process.env.APP_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");

  const proto = (req.headers.get("x-forwarded-proto") ?? "https").split(",")[0].trim();

  const forwardedHost = req.headers.get("x-forwarded-host");
  if (forwardedHost) return `${proto}://${forwardedHost.split(",")[0].trim()}`;

  const env = process.env.NEXTAUTH_URL;
  if (env) return env.replace(/\/$/, "");

  const host = req.headers.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}
