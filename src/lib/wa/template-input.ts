/**
 * The wire shape of a template submission.
 *
 * Its own module rather than living in the route, because Next.js route files
 * may only export HTTP methods and segment config — a shared schema exported
 * from one and imported by another fails the build's route-type check.
 */
import { z } from "zod";
import { normalizeTemplateName, type WaTemplateSpec } from "./template-spec";

const ButtonSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("QUICK_REPLY"), text: z.string().trim().min(1).max(25) }),
  z.object({
    type: z.literal("URL"),
    text: z.string().trim().min(1).max(25),
    url: z.string().trim().min(1).max(2000),
    urlExample: z.string().trim().max(2000).nullable().optional(),
  }),
  z.object({
    type: z.literal("PHONE_NUMBER"),
    text: z.string().trim().min(1).max(25),
    phoneNumber: z.string().trim().min(1).max(20),
  }),
]);

/**
 * Loose where `validateTemplateSpec` is strict. This only checks that the
 * request is a template-shaped object at all; every rule Meta actually enforces
 * is applied there, so the author sees all of them at once instead of one zod
 * error at a time.
 */
export const SpecSchema = z.object({
  name: z.string().trim().min(1).max(512),
  language: z.string().trim().min(2).max(6),
  category: z.enum(["MARKETING", "UTILITY"]),
  headerText: z.string().trim().max(60).nullable().optional(),
  headerExample: z.string().trim().max(200).nullable().optional(),
  body: z.string().min(1).max(1024),
  bodyExamples: z.array(z.string().max(200)).max(20).optional(),
  footer: z.string().trim().max(60).nullable().optional(),
  buttons: z.array(ButtonSchema).max(10).optional(),
});

export type SpecInput = z.infer<typeof SpecSchema>;

/** Fill in the optional halves so nothing downstream has to handle undefined. */
export function specFromInput(input: SpecInput): WaTemplateSpec {
  return {
    // Normalised rather than rejected: "Follow-up — no response" is what the
    // template is called in conversation, and Meta only accepts snake_case.
    name: normalizeTemplateName(input.name),
    language: input.language,
    category: input.category,
    headerText: input.headerText?.trim() || null,
    headerExample: input.headerExample?.trim() || null,
    body: input.body,
    bodyExamples: (input.bodyExamples ?? []).map((v) => v.trim()),
    footer: input.footer?.trim() || null,
    buttons: input.buttons ?? [],
  };
}
