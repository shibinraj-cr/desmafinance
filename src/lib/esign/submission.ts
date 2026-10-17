import { z } from "zod";
import { fieldName, type TemplateField } from "@/lib/esign/template-fields";
import type { StampItem } from "@/lib/esign/stamp";

/**
 * What a signer sends when they finish, and the rules it must meet.
 *
 * Shared by the public signing page (clients) and the in-app one (DESMA
 * staff), so both are judged the same way. Only the signer's own boxes count:
 * CRM-filled fields are already printed, and other signers' boxes are theirs.
 */

/** A drawn, typed or uploaded signature, sent as a PNG data URL. */
export const MAX_IMAGE_BYTES = 400 * 1024;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export const SubmissionSchema = z.object({
  values: z.record(z.string().max(2000)).default({}),
  images: z.record(z.string().max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 100)).default({}),
  consent: z.boolean(),
  location: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .nullable()
    .optional(),
});
export type Submission = z.infer<typeof SubmissionSchema>;

/** The boxes a signer fills: their role's, minus anything filled from the CRM. */
export function signerFields<T extends Pick<TemplateField, "role" | "mergeKey">>(fields: T[], role: string): T[] {
  return fields.filter((f) => f.role === role && !f.mergeKey);
}

/** Decode a PNG data URL, or null if it is not a reasonable PNG. */
export function decodePng(dataUrl: string): Uint8Array | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const bytes = new Uint8Array(Buffer.from(m[1], "base64"));
  if (bytes.length < 64 || bytes.length > MAX_IMAGE_BYTES) return null;
  return PNG_MAGIC.every((b, i) => bytes[i] === b) ? bytes : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CheckedSubmission = {
  errors: string[];
  /** What to burn into the PDF (images still as bytes). */
  items: StampItem[];
  /** One row per filled box, for EsignFieldValue (images keyed for upload). */
  values: Array<{ field: TemplateField; value: string | null; png: Uint8Array | null }>;
};

/** Check a submission against the signer's boxes and turn it into stamp items. */
export function checkSubmission(fields: TemplateField[], role: string, sub: Submission): CheckedSubmission {
  const errors: string[] = [];
  const items: StampItem[] = [];
  const values: CheckedSubmission["values"] = [];
  if (!sub.consent) errors.push("Tick the box to agree that your electronic signature counts as your handwritten one.");

  for (const f of signerFields(fields, role)) {
    const name = fieldName(f);
    const geo = { page: f.page, x: f.x, y: f.y, w: f.w, h: f.h };
    if (f.type === "signature" || f.type === "initial") {
      const raw = sub.images[f.key];
      if (!raw) {
        if (f.required) errors.push(`${f.type === "initial" ? "Add your initials" : "Sign"} in ${name}.`);
        continue;
      }
      const png = decodePng(raw);
      if (!png) {
        errors.push(`The ${f.type === "initial" ? "initials" : "signature"} in ${name} could not be read; try again.`);
        continue;
      }
      items.push({ kind: "image", ...geo, png });
      values.push({ field: f, value: null, png });
      continue;
    }

    const value = (sub.values[f.key] ?? "").trim();
    if (f.type === "checkbox") {
      const ticked = value === "true";
      if (f.required && !ticked) errors.push(`Tick ${name}.`);
      if (ticked) items.push({ kind: "check", ...geo });
      values.push({ field: f, value: ticked ? "true" : "false", png: null });
      continue;
    }
    if (!value) {
      if (f.required) errors.push(`Fill in ${name}.`);
      continue;
    }
    if (f.type === "radio" || f.type === "selection") {
      if (!(f.options ?? []).includes(value)) {
        errors.push(`Choose one of the options for ${name}.`);
        continue;
      }
    }
    if (f.type === "email" && !EMAIL_RE.test(value)) {
      errors.push(`${name} does not look like an email address.`);
      continue;
    }
    if (f.type === "phone" && !/^[+()\d\s-]{7,20}$/.test(value)) {
      errors.push(`${name} does not look like a phone number.`);
      continue;
    }
    if (value.length > (f.type === "textarea" ? 2000 : 500)) {
      errors.push(`${name} is too long.`);
      continue;
    }
    items.push({
      kind: "text",
      ...geo,
      text: value,
      fontSize: f.fontSize,
      alignment: f.alignment,
      multiline: f.type === "textarea",
    });
    values.push({ field: f, value, png: null });
  }
  return { errors, items, values };
}
