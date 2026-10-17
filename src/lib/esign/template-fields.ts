import { z } from "zod";
import { MERGE_KEY_SET } from "@/lib/esign/merge-keys";
import type { PageGeometry } from "@/lib/esign/templates";

/**
 * Template field boxes — shared by the builder (browser) and the save route
 * (server), so both judge a layout by the same rules.
 *
 * Geometry is a fraction of the displayed page: x/y of the top-left corner and
 * w/h, all 0–1, page numbers 1-based. That is Odoo's sign.item convention, so
 * an imported Odoo layout needs no conversion. Sizes that only make sense in
 * real units (a default signature box, the smallest box) are kept in PDF
 * points and converted per page, because pages differ in size.
 */

export const FIELD_TYPES = [
  "signature",
  "initial",
  "text",
  "textarea",
  "checkbox",
  "radio",
  "selection",
  "date",
  "name",
  "email",
  "phone",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  signature: "Signature",
  initial: "Initials",
  text: "Text",
  textarea: "Multi-line text",
  checkbox: "Checkbox",
  radio: "Radio choice",
  selection: "Dropdown",
  date: "Date",
  name: "Name",
  email: "Email",
  phone: "Phone",
};

/** Material Symbols name per type. */
export const FIELD_TYPE_ICONS: Record<FieldType, string> = {
  signature: "draw",
  initial: "gesture",
  text: "short_text",
  textarea: "notes",
  checkbox: "check_box",
  radio: "radio_button_checked",
  selection: "arrow_drop_down_circle",
  date: "calendar_today",
  name: "badge",
  email: "mail",
  phone: "call",
};

export const SIGNER_ROLES = ["Client", "DESMA"] as const;
export type SignerRole = (typeof SIGNER_ROLES)[number];

export const ALIGNMENTS = ["left", "center", "right"] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

/** Types that can be filled from a merge key: the ones holding plain text. */
export const MERGEABLE_TYPES: readonly FieldType[] = ["text", "textarea", "date", "name", "email", "phone"];
/** Types that carry a list of choices. */
export const OPTION_TYPES: readonly FieldType[] = ["radio", "selection"];
/** Types whose text is drawn with a font size and alignment. */
export const TEXT_TYPES: readonly FieldType[] = ["text", "textarea", "date", "name", "email", "phone", "selection"];

/** A new box of each type, in PDF points (an A4 page is 595 × 842). */
export const DEFAULT_SIZE_PT: Record<FieldType, [number, number]> = {
  signature: [160, 48],
  initial: [60, 36],
  text: [160, 18],
  textarea: [260, 64],
  checkbox: [14, 14],
  radio: [120, 48],
  selection: [140, 18],
  date: [90, 18],
  name: [160, 18],
  email: [180, 18],
  phone: [120, 18],
};

/** No box may be smaller than this on either side, in points. */
export const MIN_SIZE_PT = 8;

export const MAX_FIELDS = 500;

export type TemplateField = {
  key: string;
  label: string | null;
  type: FieldType;
  role: SignerRole;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  required: boolean;
  options: string[] | null;
  mergeKey: string | null;
  fontSize: number;
  alignment: Alignment;
};

const KEY_RE = /^[a-z][a-z0-9_]{0,59}$/;
const unit = z.number().finite().min(0).max(1);

export const FieldSchema = z.object({
  key: z.string().regex(KEY_RE, "Keys start with a letter and use lowercase letters, digits and _"),
  label: z.string().trim().max(120).nullable().transform((v) => (v ? v : null)),
  type: z.enum(FIELD_TYPES),
  role: z.enum(SIGNER_ROLES),
  page: z.number().int().min(1),
  x: unit,
  y: unit,
  w: unit,
  h: unit,
  required: z.boolean(),
  options: z.array(z.string().trim().min(1).max(100)).max(50).nullable(),
  mergeKey: z.string().max(60).nullable(),
  fontSize: z.number().int().min(6).max(36),
  alignment: z.enum(ALIGNMENTS),
});

export const FieldListSchema = z.array(FieldSchema).max(MAX_FIELDS);

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const EPS = 1e-6;

/**
 * Whether a signer must fill a box before they can finish. Every DESMA box is
 * mandatory whatever the template says: the client must never receive an
 * agreement with DESMA's part left blank. Client boxes follow the template.
 */
export function mustFill(f: Pick<TemplateField, "required" | "role" | "mergeKey">): boolean {
  return !f.mergeKey && (f.required || f.role === "DESMA");
}

/** How a field is named in an error message: its label, else its key. */
export function fieldName(f: Pick<TemplateField, "label" | "key">): string {
  return f.label ? `"${f.label}"` : f.key;
}

/** Smallest allowed width/height as page fractions. */
export function minSizeFrac(page: Pick<PageGeometry, "w" | "h">): { w: number; h: number } {
  return { w: Math.min(1, MIN_SIZE_PT / page.w), h: Math.min(1, MIN_SIZE_PT / page.h) };
}

/** Keep a box on its page and no smaller than MIN_SIZE_PT. */
export function clampBox(
  box: { x: number; y: number; w: number; h: number },
  page: Pick<PageGeometry, "w" | "h">,
): { x: number; y: number; w: number; h: number } {
  const min = minSizeFrac(page);
  const w = Math.min(1, Math.max(min.w, box.w));
  const h = Math.min(1, Math.max(min.h, box.h));
  const x = Math.min(1 - w, Math.max(0, box.x));
  const y = Math.min(1 - h, Math.max(0, box.y));
  return { x: round6(x), y: round6(y), w: round6(w), h: round6(h) };
}

/** `${base}_${n}` with the smallest n not already taken. */
export function uniqueKey(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const stem = base
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/, "")
    .slice(0, 52) || "field";
  for (let n = 1; ; n++) {
    const key = `${stem}_${n}`;
    if (!used.has(key)) return key;
  }
}

/** The key a field gets when it is tied to a merge key: client.full_name → client_full_name_1. */
export function keyForMergeKey(mergeKey: string, taken: Iterable<string>): string {
  return uniqueKey(mergeKey.replace(/\./g, "_"), taken);
}

/** Whether a key still looks auto-generated for its type (so renaming it is safe). */
export function isAutoKey(key: string, type: FieldType): boolean {
  return new RegExp(`^${type}_\\d+$`).test(key);
}

/** A new box of `type`, centred on (cx, cy) — page fractions — and kept on the page. */
export function newField(
  type: FieldType,
  pageNo: number,
  center: { x: number; y: number },
  page: Pick<PageGeometry, "w" | "h">,
  taken: Iterable<string>,
  role: SignerRole = "Client",
): TemplateField {
  const [wPt, hPt] = DEFAULT_SIZE_PT[type];
  const w = wPt / page.w;
  const h = hPt / page.h;
  return {
    key: uniqueKey(type, taken),
    label: null,
    type,
    role,
    page: pageNo,
    ...clampBox({ x: center.x - w / 2, y: center.y - h / 2, w, h }, page),
    required: type !== "checkbox",
    options: OPTION_TYPES.includes(type) ? ["Option 1", "Option 2"] : null,
    mergeKey: null,
    fontSize: 11,
    alignment: "left",
  };
}

/**
 * Bring a field in line with its type after an edit: options only on choice
 * types, merge keys only on text types, and a merge-filled field is never
 * "required" of the signer (they cannot change it).
 */
export function normalizeField(f: TemplateField): TemplateField {
  const mergeKey = MERGEABLE_TYPES.includes(f.type) ? f.mergeKey : null;
  return {
    ...f,
    x: round6(f.x),
    y: round6(f.y),
    w: round6(f.w),
    h: round6(f.h),
    options: OPTION_TYPES.includes(f.type) ? f.options ?? [] : null,
    mergeKey,
    required: mergeKey ? false : f.role === "DESMA" ? true : f.required,
  };
}

/** A copy of `f` on each listed page (its own page skipped), with fresh keys. */
export function copyFieldToPages(
  f: TemplateField,
  pageNos: number[],
  pages: Array<Pick<PageGeometry, "w" | "h">>,
  taken: Iterable<string>,
): TemplateField[] {
  const used = new Set(taken);
  const out: TemplateField[] = [];
  for (const p of Array.from(new Set(pageNos)).sort((a, b) => a - b)) {
    if (p === f.page || p < 1 || p > pages.length) continue;
    const key = uniqueKey(`${f.key.replace(/_\d+$/, "")}_p${p}`, used);
    used.add(key);
    out.push({ ...f, key, page: p, ...clampBox(f, pages[p - 1]) });
  }
  return out;
}

/**
 * Read a page list as people type it: "all", "2-5, 7", "3". Returns null when
 * any part is not a page of this document.
 */
export function parsePageList(input: string, numPages: number): number[] | null {
  const s = input.trim().toLowerCase();
  if (s === "all") return Array.from({ length: numPages }, (_, i) => i + 1);
  if (!s) return null;
  const out = new Set<number>();
  for (const part of s.split(",")) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b > numPages || a > b) return null;
    for (let p = a; p <= b; p++) out.add(p);
  }
  return Array.from(out).sort((x, y) => x - y);
}

/**
 * Fields carried from the current version onto a newly uploaded PDF. Boxes on
 * pages the new file no longer has are dropped (and counted, so the person
 * uploading is told).
 */
export function carryFieldsForward<T extends Pick<TemplateField, "page">>(
  fields: T[],
  newNumPages: number,
): { kept: T[]; dropped: number } {
  const kept = fields.filter((f) => f.page <= newNumPages);
  return { kept, dropped: fields.length - kept.length };
}

/** Reading order for storage: by page, then top to bottom, then left to right. */
export function sortFields<T extends Pick<TemplateField, "page" | "x" | "y">>(fields: T[]): T[] {
  return [...fields].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
}

/** Problems that make a layout unsavable, in words a template author can act on. */
export function validateFields(fields: TemplateField[], numPages: number): string[] {
  const errors: string[] = [];
  if (fields.length > MAX_FIELDS) errors.push(`A template can have at most ${MAX_FIELDS} fields.`);
  const seen = new Set<string>();
  for (const f of fields) {
    const name = fieldName(f);
    if (!KEY_RE.test(f.key)) errors.push(`${name}: the key "${f.key}" must start with a letter and use a–z, 0–9 and _.`);
    if (seen.has(f.key)) errors.push(`Two fields share the key "${f.key}". Keys must be unique.`);
    seen.add(f.key);
    if (f.page < 1 || f.page > numPages) errors.push(`${name} is on page ${f.page}, but the PDF has ${numPages}.`);
    if (!(f.w > 0 && f.h > 0) || f.x < -EPS || f.y < -EPS || f.x + f.w > 1 + EPS || f.y + f.h > 1 + EPS) {
      errors.push(`${name} on page ${f.page} runs off the page.`);
    }
    if (OPTION_TYPES.includes(f.type)) {
      const opts = (f.options ?? []).map((o) => o.trim()).filter(Boolean);
      if (opts.length < 2) errors.push(`${name} needs at least two choices.`);
      else if (new Set(opts).size !== opts.length) errors.push(`${name} lists the same choice twice.`);
    }
    if (f.mergeKey) {
      if (!MERGE_KEY_SET.has(f.mergeKey)) errors.push(`${name} uses an unknown merge key "${f.mergeKey}".`);
      else if (!MERGEABLE_TYPES.includes(f.type)) {
        errors.push(`${name}: a ${FIELD_TYPE_LABELS[f.type].toLowerCase()} cannot be filled from the CRM.`);
      }
    }
  }
  return errors;
}

/** Things worth flagging that do not block a save (a draft layout is fine). */
export function fieldWarnings(fields: TemplateField[]): string[] {
  const warnings: string[] = [];
  if (!fields.some((f) => f.role === "Client" && f.type === "signature")) {
    warnings.push("There is no signature box for the Client yet.");
  }
  if (!fields.some((f) => f.role === "DESMA" && f.type === "signature")) {
    warnings.push("There is no signature box for DESMA yet. DESMA signs every agreement first, so it cannot be sent without one.");
  }
  return warnings;
}
