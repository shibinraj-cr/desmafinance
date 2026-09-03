/**
 * Where a submitted template stands with Meta.
 *
 * Two things deliver this and neither is optional. The webhook
 * (`message_template_status_update`) is how an approval arrives within seconds
 * of a human at Meta clicking it, but it only fires while the app is subscribed
 * to that field — and the WABA subscription this CRM already has selects
 * `messages`, not this one. So the catalogue poll is the floor: whatever the
 * webhook missed, a sync reconciles. Neither alone is trustworthy; together they
 * are.
 *
 * Parsing lives here, pure, because the payload is the part we cannot test
 * against the real thing without waiting on a review queue.
 */

/**
 * Meta's template statuses, plus our own DRAFT.
 *
 * DRAFT is ours alone: a template saved in the CRM but not yet submitted. It has
 * no Meta id and Meta has never heard of it. Keeping it in the same vocabulary
 * means one list shows work-in-progress next to what is live, which is the
 * question an author actually asks ("where is my template?").
 */
export type WaTemplateStatus =
  | "DRAFT"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "PAUSED"
  | "DISABLED"
  | "IN_APPEAL"
  | "PENDING_DELETION"
  | "DELETED"
  | "LIMIT_EXCEEDED"
  | "UNKNOWN";

const KNOWN: ReadonlySet<string> = new Set([
  "DRAFT",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "PAUSED",
  "DISABLED",
  "IN_APPEAL",
  "PENDING_DELETION",
  "DELETED",
  "LIMIT_EXCEEDED",
]);

export function normalizeTemplateStatus(raw: unknown): WaTemplateStatus {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s) return "UNKNOWN";
  // The status webhook says FLAGGED where the catalogue says PAUSED for the same
  // condition — quality dropped and sending is suspended. One word, so the UI
  // does not have to explain two.
  if (s === "FLAGGED") return "PAUSED";
  return KNOWN.has(s) ? (s as WaTemplateStatus) : "UNKNOWN";
}

/** Only an APPROVED template can actually be sent to a candidate. */
export function isSendable(status: WaTemplateStatus): boolean {
  return status === "APPROVED";
}

/** Meta permits an edit only from these states — a PENDING template is frozen under review. */
export function isEditableAtMeta(status: WaTemplateStatus): boolean {
  return status === "APPROVED" || status === "REJECTED" || status === "PAUSED";
}

/**
 * Meta's rejection codes, said in words.
 *
 * The raw code is what the API returns and it is the only explanation anyone
 * gets — `INCORRECT_CATEGORY` on its own does not tell an author to switch the
 * template from Marketing to Utility, which is exactly what it means.
 */
export function rejectionReasonLabel(raw: string | null | undefined): string | null {
  const code = (raw ?? "").trim().toUpperCase();
  if (!code || code === "NONE") return null;
  const MAP: Record<string, string> = {
    ABUSIVE_CONTENT: "Meta judged the content abusive, threatening or offensive.",
    INCORRECT_CATEGORY: "Wrong category — resubmit under the other category (usually Utility rather than Marketing).",
    INVALID_FORMAT: "The formatting is invalid — check variables, sample values and spacing.",
    PROMOTIONAL: "Read as promotional. A Utility template can't advertise; move it to Marketing or drop the offer.",
    SCAM: "Meta read this as a scam or misleading claim.",
    TAG_CONTENT_MISMATCH: "The content doesn't match the category it was submitted under.",
    NON_TRANSACTIONAL_AUTHENTICATION_CONTENT: "Authentication templates may only carry a one-time code.",
  };
  // Unknown codes are shown rather than swallowed: a code we cannot explain is
  // still the only thing the author has to go on.
  return MAP[code] ?? code.replace(/_/g, " ").toLowerCase();
}

export type WaTemplateStatusUpdate = {
  /** Meta's numeric template id, as a string. */
  metaId: string | null;
  name: string | null;
  language: string | null;
  status: WaTemplateStatus;
  /** Raw rejection code, `NONE` normalised away. */
  reason: string | null;
  /** Set only by a category-change event. */
  newCategory: string | null;
};

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(o: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/**
 * Pull template status changes out of a webhook body.
 *
 * Two fields carry them and both matter. `message_template_status_update` is the
 * approval or rejection. `template_category_update` is Meta reclassifying a
 * template AFTER approval — a Utility template it decides is really Marketing —
 * which changes what it costs and whether the marketing frequency cap applies,
 * so it is not cosmetic.
 *
 * Anything else on the subscription is left alone; this shares an endpoint with
 * messages and delivery statuses.
 */
export function extractTemplateStatusUpdates(body: unknown): WaTemplateStatusUpdate[] {
  const out: WaTemplateStatusUpdate[] = [];
  const root = asObject(body);
  if (!root) return out;

  const entries = Array.isArray(root.entry) ? root.entry : [];
  for (const entryRaw of entries) {
    const entry = asObject(entryRaw);
    if (!entry) continue;
    const changes = Array.isArray(entry.changes) ? entry.changes : [];

    for (const changeRaw of changes) {
      const change = asObject(changeRaw);
      if (!change) continue;
      const field = String(change.field ?? "").trim();
      const value = asObject(change.value);
      if (!value) continue;

      if (field === "message_template_status_update") {
        out.push({
          metaId: str(value, "message_template_id"),
          name: str(value, "message_template_name"),
          language: str(value, "message_template_language"),
          status: normalizeTemplateStatus(value.event ?? value.status),
          reason: (() => {
            const r = str(value, "reason");
            return r && r.toUpperCase() !== "NONE" ? r : null;
          })(),
          newCategory: null,
        });
      } else if (field === "template_category_update") {
        const category = str(value, "new_category", "correct_category");
        if (!category) continue;
        out.push({
          metaId: str(value, "message_template_id"),
          name: str(value, "message_template_name"),
          language: str(value, "message_template_language"),
          // A recategorisation says nothing about approval, so the status is
          // left for the catalogue to settle rather than guessed at here.
          status: "UNKNOWN",
          reason: null,
          newCategory: category.toUpperCase(),
        });
      }
    }
  }

  return out;
}
