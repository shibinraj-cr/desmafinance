import { z } from "zod";
import { safeBlobFileName } from "@/lib/finance-docs";

/**
 * Agreements (E-Sign) — the pure rules behind agreement templates.
 *
 * No I/O here, so everything can be tested on its own; Blob and database calls
 * live in store.ts and the API routes. Two decisions worth knowing first:
 *
 * 1. **Templates are master documents.** A handful of PDFs ("AHPRA Agreement",
 *    "NZ Agreement", …) whose merge fields are filled from the CRM at send
 *    time. Replacing Odoo, where staff uploaded an edited PDF per client, is
 *    the point of the module.
 *
 * 2. **A version is frozen once anything was sent from it.** Uploading a new
 *    PDF always makes a new version; editing the fields of a version already
 *    in use forks one too. A sent agreement therefore always has exactly the
 *    file and layout it was sent with.
 */

/** Page grant that lets a role manage templates (admins pass automatically). */
export const AGREEMENT_TEMPLATES_PAGE = "/operations/agreements/templates";

/** Every template PDF lives under this prefix in the private Blob store. */
export const ESIGN_TEMPLATE_BLOB_PREFIX = "esign/templates/";

/** A text agreement is well under 1 MB; scanned letterheads can run to a few. */
export const MAX_TEMPLATE_PDF_BYTES = 15 * 1024 * 1024;

export const MAX_TEMPLATE_PAGES = 100;

/**
 * Whole-file responses stay under this, because a Vercel function response is
 * capped at 4.5 MB. Larger PDFs are fetched by the builder in byte ranges of
 * RANGE_CHUNK_BYTES, each its own small response — never through a storage URL,
 * which the site CSP would block and which would leave our access check.
 */
export const STREAM_LIMIT_BYTES = 4 * 1024 * 1024;
export const RANGE_CHUNK_BYTES = 2 * 1024 * 1024;

/** Agreement families, taken from the tags used in Odoo Sign. */
export const TEMPLATE_CATEGORIES = [
  "AHPRA Agreement",
  "AHPRA Pathway",
  "Visa Agreement (AUS)",
  "NZ Agreement",
  "NCLEX RN Booking",
  "Sales",
  "Agent",
  "Promotional",
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

/**
 * Optional free text: absent stays absent (a partial update must not clear
 * it), while an explicit null or blank clears it.
 */
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === null || v.trim() === "" ? null : v.trim()));

/**
 * Everything about a template except its PDF and fields. All keys optional so
 * the same schema serves create (with defaults) and partial updates.
 */
export const TemplateSettingsSchema = z.object({
  name: z.string().trim().min(1, "Give the template a name").max(200).optional(),
  category: z.enum(TEMPLATE_CATEGORIES).optional(),
  description: optionalText(1000),
  defaultExpiryDays: z.number().int().min(1).max(90).optional(),
  /** 0 = no automatic reminders. */
  defaultReminderDays: z.number().int().min(0).max(30).optional(),
  emailSubject: optionalText(200),
  emailBody: optionalText(5000),
  /** Meta template names are lowercase letters, digits and underscores. */
  whatsappTemplateName: z
    .string()
    .trim()
    .max(512)
    .regex(/^([a-z0-9_]+)?$/, "WhatsApp template names use lowercase letters, digits and _ only")
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null)),
  active: z.boolean().optional(),
});
export type TemplateSettingsInput = z.input<typeof TemplateSettingsSchema>;

/** Where the browser uploads a template PDF; the store adds a random suffix. */
export function templateUploadPath(fileName: string): string {
  return `${ESIGN_TEMPLATE_BLOB_PREFIX}${safeBlobFileName(fileName.replace(/\.pdf$/i, ""))}.pdf`;
}

/**
 * Whether a pathname is one we will issue an upload token for, or register as
 * a template file: under our prefix, one level deep, a .pdf, no dot segments.
 * Mixed case is allowed because the store's random suffix ("-Ab3x….pdf") is.
 */
export function isTemplateUploadPath(pathname: string): boolean {
  if (!pathname.startsWith(ESIGN_TEMPLATE_BLOB_PREFIX)) return false;
  const rest = pathname.slice(ESIGN_TEMPLATE_BLOB_PREFIX.length);
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/.test(rest) && !rest.includes("..");
}

/**
 * One page as the signer sees it, in PDF points: displayed width and height
 * (already swapped for a 90/270 rotation), the rotation, and the crop box the
 * fractions are measured against. The burn-in step needs all three to turn a
 * fraction back into a PDF coordinate.
 */
export type PageGeometry = {
  w: number;
  h: number;
  rotate: 0 | 90 | 180 | 270;
  box: [number, number, number, number];
};

export function normalizeRotation(angle: number): 0 | 90 | 180 | 270 {
  const r = (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
  return r as 0 | 90 | 180 | 270;
}

/** Read the `pages` JSON column back, tolerating anything malformed as A4. */
export function readPageGeometry(raw: unknown, numPages: number): PageGeometry[] {
  const list = Array.isArray(raw) ? raw : [];
  return Array.from({ length: numPages }, (_, i) => {
    const p = list[i] as Partial<PageGeometry> | undefined;
    const w = typeof p?.w === "number" && p.w > 0 ? p.w : 595.28;
    const h = typeof p?.h === "number" && p.h > 0 ? p.h : 841.89;
    const box =
      Array.isArray(p?.box) && p.box.length === 4 && p.box.every((n) => typeof n === "number")
        ? (p.box as [number, number, number, number])
        : ([0, 0, w, h] as [number, number, number, number]);
    return { w, h, rotate: normalizeRotation(typeof p?.rotate === "number" ? p.rotate : 0), box };
  });
}

/**
 * Parse a single-range `Range` header against a file of `size` bytes.
 *
 * Returns null when there is no header (serve the whole file), "invalid" when
 * it cannot be satisfied (answer 416), or the inclusive byte span. Spans longer
 * than RANGE_CHUNK_BYTES are shortened, which HTTP allows: the reply's
 * Content-Range says what was actually sent, and our loader reads it.
 */
export function parseByteRange(
  header: string | null,
  size: number,
): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "") || size <= 0) return "invalid";
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
    return "invalid";
  }
  return { start, end: Math.min(end, start + RANGE_CHUNK_BYTES - 1) };
}

/** The byte spans a loader requests to fetch a file of `size` bytes in chunks. */
export function rangeChunks(size: number, chunk = RANGE_CHUNK_BYTES): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (let start = 0; start < size; start += chunk) out.push({ start, end: Math.min(size, start + chunk) - 1 });
  return out;
}

/**
 * What saving a version's fields should do.
 *
 * - "stale": the builder was opened on a version that is no longer current
 *   (someone uploaded a new PDF meanwhile) — saving would edit the wrong file.
 * - "fork": agreements were already sent from this version, so its layout is
 *   frozen; the edit becomes the next version instead.
 * - "update": nothing depends on it yet; edit in place.
 */
export function planFieldSave(opts: {
  versionId: string;
  currentVersionId: string | null;
  sentCount: number;
}): "stale" | "fork" | "update" {
  if (opts.versionId !== opts.currentVersionId) return "stale";
  return opts.sentCount > 0 ? "fork" : "update";
}
