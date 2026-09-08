import { getSetting, setSetting } from "@/lib/app-settings";

/**
 * The Meta (Facebook) pixel for the PUBLIC careers site.
 *
 * Stored as a setting rather than an env var so marketing can change it without
 * a deploy — a pixel gets replaced whenever an ad account does.
 *
 * Scope is deliberate and load-bearing: this fires ONLY on /careers/desma. The
 * rest of Desgro is an internal ERP showing employee salaries, candidate
 * résumés and client records, and Meta has no business receiving a record of
 * who looked at which of those pages. "Paste it in the head of your website"
 * means the careers site here, not the application.
 */
export const META_PIXEL_KEY = "hiring_meta_pixel_id";

/** Meta pixel ids are numeric and 15-16 digits today; allow a little either way. */
const PIXEL_ID = /^\d{10,20}$/;

export function isValidPixelId(value: string): boolean {
  return PIXEL_ID.test(value.trim());
}

/**
 * Returns the configured id, or null. Anything that fails the shape check is
 * treated as absent rather than rendered — a pasted `<script>` block or a
 * stray quote would otherwise end up interpolated into a script tag.
 */
export async function getMetaPixelId(): Promise<string | null> {
  const raw = (await getSetting(META_PIXEL_KEY))?.trim();
  return raw && isValidPixelId(raw) ? raw : null;
}

export async function setMetaPixelId(value: string | null, userId?: string | null): Promise<void> {
  await setSetting(META_PIXEL_KEY, value?.trim() ?? "", userId);
}
