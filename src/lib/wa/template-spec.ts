/**
 * A WhatsApp template as we author it, and what Meta needs to be sent one.
 *
 * The CRM has always had "WhatsApp templates" that never went anywhere near
 * Meta: `CrmMessageTemplate` rows with `{name}` merge fields, written for the
 * free-text composer inside the 24-hour session window. That is a legitimate
 * thing — no approval is needed to answer someone who just messaged you — but it
 * is NOT what a template is on WhatsApp. A template is a message pre-cleared by
 * Meta so it can be sent to somebody who has not written to you, and it only
 * exists once Meta has approved it on the WABA.
 *
 * So a template written here has to be submitted, reviewed, and then either
 * approved or rejected with a reason. This module is the shape of that
 * submission and the rules it has to satisfy — deliberately pure, because the
 * alternative is discovering each rule as an opaque Graph error after a human
 * has already spent a review cycle on it.
 *
 * ERRORS vs WARNINGS is the load-bearing distinction. An error is something the
 * API will reject outright, so submitting is pointless and we refuse. A warning
 * is something Meta's REVIEWERS routinely reject but the API accepts — we say so
 * and let the author decide, because guessing at review policy and blocking on it
 * would make legitimate templates unsubmittable.
 */

/**
 * AUTHENTICATION is deliberately absent. Its templates are a fixed
 * one-time-password shape with their own fields (`add_security_recommendation`,
 * `code_expiration_minutes`, an OTP button) and no free body text at all, so
 * offering it in a general body/header/footer builder would produce something
 * that can only ever be rejected. We do not send OTPs.
 */
export type WaTemplateCategory = "MARKETING" | "UTILITY";

export const WA_TEMPLATE_CATEGORIES: { value: WaTemplateCategory; label: string; hint: string }[] = [
  {
    value: "UTILITY",
    label: "Utility",
    hint: "About something the candidate already has with us — an update, a reminder, a document request.",
  },
  {
    value: "MARKETING",
    label: "Marketing",
    hint: "Promotional or re-engagement. Counts against the per-user marketing frequency cap.",
  },
];

export type WaTemplateButton =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "URL"; text: string; url: string; urlExample?: string | null }
  | { type: "PHONE_NUMBER"; text: string; phoneNumber: string };

/** What we store and what we submit. One row of the builder. */
export type WaTemplateSpec = {
  name: string;
  /** Meta locale code — `en`, `en_US`, `ml`. A WABA holds one template per language. */
  language: string;
  category: WaTemplateCategory;
  /** Optional text header, at most one `{{1}}`. Media headers are not offered here. */
  headerText: string | null;
  /** Sample value for the header's variable, when it has one. */
  headerExample: string | null;
  body: string;
  /** One sample per distinct `{{n}}`, in order. Meta rejects a submission without them. */
  bodyExamples: string[];
  footer: string | null;
  buttons: WaTemplateButton[];
};

// Meta's documented limits. Exceeding any of them is a hard API rejection.
export const NAME_MAX = 512;
export const BODY_MAX = 1024;
export const HEADER_MAX = 60;
export const FOOTER_MAX = 60;
export const BUTTON_TEXT_MAX = 25;
export const URL_MAX = 2000;
export const MAX_QUICK_REPLY = 3;
export const MAX_URL_BUTTONS = 2;
export const MAX_PHONE_BUTTONS = 1;

/** Lowercase letters, digits and underscores — Meta accepts nothing else. */
const NAME_RE = /^[a-z0-9_]+$/;
/** `en`, `en_US`, `pt_BR`. */
const LANGUAGE_RE = /^[a-z]{2,3}(_[A-Z]{2})?$/;

/**
 * Turn whatever a human typed into a name Meta will accept.
 *
 * Applied on the way in rather than validated and bounced, because "Follow-up —
 * no response" is what a template is actually called in conversation and
 * `follow_up_no_response` is what it has to be called at Meta. Making the author
 * perform that transliteration by hand is friction with no upside.
 */
export function normalizeTemplateName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, NAME_MAX);
}

/**
 * The distinct `{{n}}` indexes in a piece of text, ascending.
 *
 * Distinct, not occurrences: `{{1}}` used twice is still one value to collect,
 * and counting it twice would make us demand an example nobody can supply.
 */
export function templateVariableIndexes(text: string | null | undefined): number[] {
  if (!text) return [];
  const found = new Set<number>();
  for (const m of text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n > 0) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}

/** Whether the indexes are exactly 1..n with nothing missing. Meta requires this. */
export function isSequentialFromOne(indexes: readonly number[]): boolean {
  return indexes.every((n, i) => n === i + 1);
}

export type SpecCheck = { errors: string[]; warnings: string[] };

/**
 * Everything wrong with a spec, split by whether Meta's API or Meta's reviewers
 * will be the one to object. See the module note for why that split matters.
 */
export function validateTemplateSpec(spec: WaTemplateSpec): SpecCheck {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── Name ──────────────────────────────────────────────────────────────
  const name = spec.name.trim();
  if (!name) errors.push("Give the template a name.");
  else if (!NAME_RE.test(name)) {
    errors.push("The name may only use lowercase letters, numbers and underscores.");
  } else if (name.length > NAME_MAX) {
    errors.push(`The name is longer than ${NAME_MAX} characters.`);
  }

  // ── Language ──────────────────────────────────────────────────────────
  if (!LANGUAGE_RE.test(spec.language.trim())) {
    errors.push('Pick a language code like "en" or "en_US".');
  }

  // ── Header ────────────────────────────────────────────────────────────
  const header = spec.headerText?.trim() ?? "";
  if (header) {
    if (header.length > HEADER_MAX) errors.push(`The header is longer than ${HEADER_MAX} characters.`);
    if (/[\r\n\t]/.test(header)) errors.push("The header can't contain line breaks or tabs.");
    const headerVars = templateVariableIndexes(header);
    if (headerVars.length > 1) errors.push("A header may contain at most one variable, and it must be {{1}}.");
    else if (headerVars.length === 1 && headerVars[0] !== 1) errors.push("The header's variable must be {{1}}.");
    if (headerVars.length === 1 && !spec.headerExample?.trim()) {
      errors.push("The header has a variable, so it needs a sample value.");
    }
    if (spec.headerExample && /[\r\n\t]/.test(spec.headerExample)) {
      errors.push("The header's sample value can't contain line breaks or tabs.");
    }
  }

  // ── Body ──────────────────────────────────────────────────────────────
  const body = spec.body.trim();
  if (!body) errors.push("The message body can't be empty.");
  if (body.length > BODY_MAX) errors.push(`The body is longer than ${BODY_MAX} characters.`);

  const bodyVars = templateVariableIndexes(body);
  if (!isSequentialFromOne(bodyVars)) {
    errors.push(`Variables must run 1, 2, 3… with no gaps — this body uses ${bodyVars.map((n) => `{{${n}}}`).join(", ")}.`);
  }
  if (bodyVars.length !== spec.bodyExamples.filter((v) => v.trim()).length) {
    errors.push(
      bodyVars.length === 0
        ? "The body has no variables, so it should have no sample values."
        : `Every variable needs a sample value — ${bodyVars.length} expected.`,
    );
  }
  for (const ex of spec.bodyExamples) {
    if (/[\r\n\t]/.test(ex)) errors.push("Sample values can't contain line breaks or tabs.");
    if (/ {5,}/.test(ex)) errors.push("Sample values can't contain more than four spaces in a row.");
  }

  // Accepted by the API, routinely rejected on review — so the author is told,
  // not blocked. Guessing at review policy and refusing to submit would make
  // legitimate templates unsendable.
  if (/^\s*\{\{\s*\d+\s*\}\}/.test(body)) warnings.push("Meta usually rejects a body that starts with a variable.");
  if (/\{\{\s*\d+\s*\}\}\s*$/.test(body)) warnings.push("Meta usually rejects a body that ends with a variable.");
  if (/\{\{\s*\d+\s*\}\}\s*\{\{\s*\d+\s*\}\}/.test(body)) {
    warnings.push("Meta usually rejects two variables placed next to each other.");
  }
  if (/ {5,}/.test(body)) warnings.push("More than four spaces in a row can fail review.");

  // ── Footer ────────────────────────────────────────────────────────────
  const footer = spec.footer?.trim() ?? "";
  if (footer) {
    if (footer.length > FOOTER_MAX) errors.push(`The footer is longer than ${FOOTER_MAX} characters.`);
    if (/[\r\n\t]/.test(footer)) errors.push("The footer can't contain line breaks or tabs.");
    if (templateVariableIndexes(footer).length > 0) errors.push("A footer can't contain variables.");
  }

  // ── Buttons ───────────────────────────────────────────────────────────
  const quick = spec.buttons.filter((b) => b.type === "QUICK_REPLY").length;
  const urls = spec.buttons.filter((b) => b.type === "URL").length;
  const phones = spec.buttons.filter((b) => b.type === "PHONE_NUMBER").length;
  if (quick > MAX_QUICK_REPLY) errors.push(`At most ${MAX_QUICK_REPLY} quick-reply buttons.`);
  if (urls > MAX_URL_BUTTONS) errors.push(`At most ${MAX_URL_BUTTONS} link buttons.`);
  if (phones > MAX_PHONE_BUTTONS) errors.push("At most one call button.");

  const seen = new Set<string>();
  for (const b of spec.buttons) {
    const text = b.text.trim();
    if (!text) errors.push("Every button needs a label.");
    else if (text.length > BUTTON_TEXT_MAX) errors.push(`Button labels are limited to ${BUTTON_TEXT_MAX} characters.`);
    // Meta rejects a template with two buttons that read the same, and the
    // rejection names neither of them.
    const key = text.toLowerCase();
    if (key && seen.has(key)) errors.push(`Two buttons are both labelled "${text}".`);
    if (key) seen.add(key);

    if (b.type === "URL") {
      const url = b.url.trim();
      if (!/^https?:\/\//i.test(url)) errors.push("A link button needs a URL starting with http:// or https://.");
      if (url.length > URL_MAX) errors.push("That link is too long.");
      const urlVars = templateVariableIndexes(url);
      if (urlVars.length > 1 || (urlVars.length === 1 && urlVars[0] !== 1)) {
        errors.push("A link may contain at most one variable, and it must be {{1}} at the end.");
      }
      if (urlVars.length === 1 && !b.urlExample?.trim()) {
        errors.push("The link has a variable, so it needs a full example URL.");
      }
    }
    if (b.type === "PHONE_NUMBER" && !/^\+[1-9]\d{6,14}$/.test(b.phoneNumber.trim())) {
      errors.push("A call button needs a number in international format, e.g. +919000000000.");
    }
  }

  return { errors, warnings };
}

/**
 * The `components` array Meta wants.
 *
 * Order is not cosmetic: Meta expects HEADER, BODY, FOOTER, BUTTONS and rejects
 * a payload that arrives in another order. `example` rides on the component it
 * belongs to rather than at the top level, which is the shape that trips people
 * up most often — a submission without it comes back as a bare "Invalid
 * parameter" naming nothing.
 */
export function buildTemplateComponentsPayload(spec: WaTemplateSpec): unknown[] {
  const components: unknown[] = [];

  const header = spec.headerText?.trim();
  if (header) {
    const hasVar = templateVariableIndexes(header).length === 1;
    components.push({
      type: "HEADER",
      format: "TEXT",
      text: header,
      ...(hasVar ? { example: { header_text: [spec.headerExample?.trim() ?? ""] } } : {}),
    });
  }

  const bodyVars = templateVariableIndexes(spec.body);
  components.push({
    type: "BODY",
    text: spec.body.trim(),
    // Nested one level deeper than header_text — body examples are an array OF
    // arrays, one inner array per example set. Flattening it is rejected.
    ...(bodyVars.length
      ? { example: { body_text: [bodyVars.map((_, i) => spec.bodyExamples[i]?.trim() ?? "")] } }
      : {}),
  });

  const footer = spec.footer?.trim();
  if (footer) components.push({ type: "FOOTER", text: footer });

  if (spec.buttons.length) {
    components.push({
      type: "BUTTONS",
      buttons: spec.buttons.map((b) => {
        if (b.type === "QUICK_REPLY") return { type: "QUICK_REPLY", text: b.text.trim() };
        if (b.type === "PHONE_NUMBER") {
          return { type: "PHONE_NUMBER", text: b.text.trim(), phone_number: b.phoneNumber.trim() };
        }
        const hasVar = templateVariableIndexes(b.url).length === 1;
        return {
          type: "URL",
          text: b.text.trim(),
          url: b.url.trim(),
          ...(hasVar ? { example: [b.urlExample?.trim() ?? ""] } : {}),
        };
      }),
    });
  }

  return components;
}

/** The whole create body. Name and language are fixed at creation and cannot be edited later. */
export function buildCreatePayload(spec: WaTemplateSpec): {
  name: string;
  language: string;
  category: WaTemplateCategory;
  components: unknown[];
} {
  return {
    name: spec.name.trim(),
    language: spec.language.trim(),
    category: spec.category,
    components: buildTemplateComponentsPayload(spec),
  };
}

/**
 * The edit body, which is POSTed to the TEMPLATE's own id rather than to the
 * WABA. Name and language are deliberately omitted: Meta ignores them on edit,
 * and including them reads as if they could change.
 */
export function buildEditPayload(spec: WaTemplateSpec): { category: WaTemplateCategory; components: unknown[] } {
  return { category: spec.category, components: buildTemplateComponentsPayload(spec) };
}

/** Substitute the sample values so an author sees the message, not the placeholders. */
export function renderSpecPreview(spec: WaTemplateSpec): { header: string; body: string; footer: string } {
  const fill = (text: string, values: readonly string[]) =>
    text.replace(/\{\{\s*(\d+)\s*\}\}/g, (whole, n: string) => {
      const v = values[Number(n) - 1]?.trim();
      return v || whole;
    });

  return {
    header: fill(spec.headerText ?? "", [spec.headerExample ?? ""]),
    body: fill(spec.body, spec.bodyExamples),
    footer: spec.footer ?? "",
  };
}

/**
 * Convert a CRM merge-field body into a Meta template body.
 *
 * `Hi {name}, about your {service}` becomes `Hi {{1}}, about your {{2}}` with
 * ["Priya Menon", "AHPRA Direct"] as the examples. This is the bridge for the
 * WhatsApp templates already sitting in the CRM: they were written to be sent,
 * they simply were never submitted anywhere, so the useful move is to carry the
 * wording across rather than ask someone to retype it in Meta's dialect.
 *
 * A token repeated in the body reuses its index, because Meta counts distinct
 * variables and a second `{{2}}` for the same candidate name would demand a
 * second sample value for the same thing.
 */
export function specFromMergeBody(
  body: string,
  samples: Record<string, string>,
): { body: string; bodyExamples: string[] } {
  const order: string[] = [];
  const converted = body.replace(/\{([a-z0-9_]+)\}/gi, (whole, token: string) => {
    const key = token.toLowerCase();
    // Only known merge fields become variables. A stray brace is left alone —
    // turning it into a {{n}} would silently invent a value nobody can fill.
    if (!(key in samples)) return whole;
    let idx = order.indexOf(key);
    if (idx === -1) {
      order.push(key);
      idx = order.length - 1;
    }
    return `{{${idx + 1}}}`;
  });

  return { body: converted, bodyExamples: order.map((k) => samples[k] ?? "") };
}

/**
 * One template as the management screen sees it.
 *
 * Deliberately covers BOTH kinds of row, because an author looking for their
 * template does not care which side of the seam it lives on. A template written
 * here has a `spec` and can be edited; one authored in Business Manager (or by
 * Wabis, who hold partner access to our WABA) arrives from the catalogue with no
 * spec at all and is marked `metaOnly` — shown so the list is the whole truth,
 * flagged so nobody expects to edit wording we do not hold.
 */
export type WaTemplateDTO = {
  /** Our row id, or `meta:<name>:<language>` for a catalogue-only template. */
  id: string;
  name: string;
  language: string;
  category: string;
  status: import("./template-status").WaTemplateStatus;
  metaId: string | null;
  /** Meta's raw rejection code, and the same thing said in words. */
  rejectedReason: string | null;
  rejectedReasonLabel: string | null;
  /** A payload Meta refused to even accept for review. */
  lastError: string | null;
  /** Null for a catalogue-only template — we never held its wording. */
  spec: WaTemplateSpec | null;
  /** Body text as Meta holds it. The only preview available for a metaOnly row. */
  metaBody: string | null;
  submittedAt: string | null;
  syncedAt: string | null;
  createdAt: string | null;
  createdBy: string | null;
  metaOnly: boolean;
  /** Whether Meta's current status permits an edit. */
  editable: boolean;
};
