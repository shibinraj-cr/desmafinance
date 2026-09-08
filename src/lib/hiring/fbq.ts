/**
 * Fire one Meta pixel event, if a pixel is loaded.
 *
 * Never throws and never waits: an ad-blocker, a privacy browser or simply no
 * pixel configured all mean `fbq` is absent, and none of those may interfere
 * with somebody submitting a job application.
 */
export function trackPixel(event: string, params?: Record<string, unknown>): void {
  try {
    const fbq = (window as unknown as { fbq?: (...a: unknown[]) => void }).fbq;
    if (typeof fbq === "function") fbq("track", event, params);
  } catch {
    // Analytics must never break the form.
  }
}
