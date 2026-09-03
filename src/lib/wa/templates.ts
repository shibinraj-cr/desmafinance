/**
 * Templates authored in the CRM, and their standing with Meta.
 *
 * The gap this closes: the CRM has always let someone write a "WhatsApp
 * template", and that template has never once been submitted anywhere. It sat in
 * `CrmMessageTemplate` as free text, usable only inside the 24-hour session
 * window, while every template the business could actually send to a candidate
 * had to be typed again by hand in Meta Business Manager. Approval status was
 * invisible from here, so "why has my template not gone out?" had no answer this
 * side of logging into Meta.
 *
 * So this module owns the round trip: author → submit → Meta reviews → status
 * comes back → the template becomes sendable. Three things keep the local row
 * and Meta honest with each other, in descending order of trust:
 *
 *   1. A SYNC reads the whole catalogue and reconciles. Authoritative.
 *   2. The STATUS WEBHOOK updates one row the moment a reviewer decides — but
 *      only while the app is subscribed to `message_template_status_update`,
 *      which is a field on the WABA subscription and not the one the mirror
 *      needed. Fast, and not guaranteed.
 *   3. The SUBMIT response, which is `PENDING` and nothing more.
 *
 * None of them is enough alone, which is why the row records `syncedAt` — a
 * status nobody has confirmed in a while is a status worth doubting.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { logger } from "../logger";
import { getWaProvider } from "./registry";
import {
  normalizeTemplateStatus,
  rejectionReasonLabel,
  isEditableAtMeta,
  type WaTemplateStatus,
  type WaTemplateStatusUpdate,
} from "./template-status";
import {
  buildCreatePayload,
  buildEditPayload,
  validateTemplateSpec,
  type WaTemplateDTO,
  type WaTemplateSpec,
} from "./template-spec";

type Row = Prisma.WaTemplateGetPayload<{ include: { createdBy: { select: { username: true } } } }>;

/**
 * The stored spec, read back defensively.
 *
 * It is a JSON column, so nothing in the type system guarantees an old row still
 * matches today's shape. A row we cannot read is shown without its wording
 * rather than crashing the page — the status is still worth seeing.
 */
export function parseSpec(value: unknown): WaTemplateSpec | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.body !== "string" || typeof v.name !== "string") return null;
  return {
    name: v.name,
    language: typeof v.language === "string" ? v.language : "en",
    category: v.category === "MARKETING" ? "MARKETING" : "UTILITY",
    headerText: typeof v.headerText === "string" ? v.headerText : null,
    headerExample: typeof v.headerExample === "string" ? v.headerExample : null,
    body: v.body,
    bodyExamples: Array.isArray(v.bodyExamples) ? v.bodyExamples.map((x) => String(x ?? "")) : [],
    footer: typeof v.footer === "string" ? v.footer : null,
    buttons: Array.isArray(v.buttons) ? (v.buttons as WaTemplateSpec["buttons"]) : [],
  };
}

export function serializeWaTemplate(row: Row): WaTemplateDTO {
  const status = normalizeTemplateStatus(row.status);
  const spec = parseSpec(row.spec);
  return {
    id: row.id,
    name: row.name,
    language: row.language,
    category: row.category,
    status,
    metaId: row.metaId,
    rejectedReason: row.rejectedReason,
    rejectedReasonLabel: rejectionReasonLabel(row.rejectedReason),
    lastError: row.lastError,
    spec,
    metaBody: spec?.body ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    syncedAt: row.syncedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy?.username ?? null,
    metaOnly: false,
    // A DRAFT has never been to Meta, so it is always editable here whatever
    // Meta would say about a template in that state.
    editable: status === "DRAFT" || isEditableAtMeta(status),
  };
}

const INCLUDE = { createdBy: { select: { username: true } } } as const;

/**
 * Every template, ours and Meta's, in one list.
 *
 * Merged rather than presented as two tabs, because "where is my template?" is
 * one question. A template we authored wins over the catalogue entry for the
 * same name+language — the catalogue only knows the status, we know the status
 * AND who wrote it, when, and what it said before it was rejected.
 */
export async function listWaTemplates(): Promise<{ templates: WaTemplateDTO[]; catalogueRead: boolean }> {
  const provider = await getWaProvider();
  const [rows, catalogue] = await Promise.all([
    prisma.waTemplate.findMany({ include: INCLUDE, orderBy: [{ updatedAt: "desc" }] }),
    provider.supports("listTemplates") ? provider.listTemplates().catch(() => []) : Promise.resolve([]),
  ]);

  const ours = rows.map(serializeWaTemplate);
  const claimed = new Set(ours.map((t) => `${t.name}:${t.language}`));

  const metaOnly: WaTemplateDTO[] = catalogue
    .filter((t) => !claimed.has(`${t.name}:${t.language}`))
    .map((t) => {
      const status = normalizeTemplateStatus(t.status);
      return {
        id: `meta:${t.name}:${t.language}`,
        name: t.name,
        language: t.language,
        category: t.category ?? "—",
        status,
        metaId: t.id,
        rejectedReason: t.rejectedReason,
        rejectedReasonLabel: rejectionReasonLabel(t.rejectedReason),
        lastError: null,
        spec: null,
        metaBody: t.body,
        submittedAt: null,
        syncedAt: null,
        createdAt: null,
        createdBy: null,
        metaOnly: true,
        // Editing needs the authored spec — header format, sample values,
        // button targets — and the catalogue carries none of it. Offering an
        // edit here would silently drop whatever it could not reconstruct.
        editable: false,
      };
    });

  return {
    templates: [...ours, ...metaOnly],
    catalogueRead: provider.supports("listTemplates"),
  };
}

export type SubmitOutcome = {
  ok: boolean;
  /** Set when the spec itself is wrong — nothing was sent to Meta. */
  errors?: string[];
  /** Set when Meta refused the submission. */
  detail?: string;
  template?: WaTemplateDTO;
};

/**
 * Save a template and send it to Meta for review.
 *
 * The local row is written FIRST and kept whatever Meta says. That ordering is
 * the point: a submission Meta rejects outright is exactly the one an author
 * needs to open, fix and resend, and a flow that only persisted on success would
 * throw the draft away at the moment it became most valuable.
 */
export async function submitWaTemplate(spec: WaTemplateSpec, userId: string): Promise<SubmitOutcome> {
  const { errors } = validateTemplateSpec(spec);
  if (errors.length) return { ok: false, errors };

  const existing = await prisma.waTemplate.findUnique({
    where: { name_language: { name: spec.name, language: spec.language } },
  });
  if (existing) {
    return {
      ok: false,
      errors: [`A template named "${spec.name}" already exists in ${spec.language}. Edit that one instead.`],
    };
  }

  const row = await prisma.waTemplate.create({
    data: {
      name: spec.name,
      language: spec.language,
      category: spec.category,
      status: "DRAFT",
      spec: spec as unknown as Prisma.InputJsonValue,
      createdById: userId,
    },
    include: INCLUDE,
  });

  return sendToMeta(row.id, spec, "create");
}

/**
 * Edit a template and resubmit it.
 *
 * The name and language are frozen once Meta holds the template, because Meta
 * freezes them — an "edit" that changed either would create a second template
 * and leave the first live. A DRAFT has no Meta counterpart yet, so it can be
 * renamed freely.
 */
export async function updateWaTemplate(id: string, spec: WaTemplateSpec, userId: string): Promise<SubmitOutcome> {
  const existing = await prisma.waTemplate.findUnique({ where: { id } });
  if (!existing) return { ok: false, detail: "That template no longer exists." };

  const locked = !!existing.metaId;
  const next: WaTemplateSpec = locked
    ? { ...spec, name: existing.name, language: existing.language }
    : spec;

  const { errors } = validateTemplateSpec(next);
  if (errors.length) return { ok: false, errors };

  if (!locked && (next.name !== existing.name || next.language !== existing.language)) {
    const clash = await prisma.waTemplate.findUnique({
      where: { name_language: { name: next.name, language: next.language } },
    });
    if (clash && clash.id !== id) {
      return { ok: false, errors: [`A template named "${next.name}" already exists in ${next.language}.`] };
    }
  }

  await prisma.waTemplate.update({
    where: { id },
    data: {
      name: next.name,
      language: next.language,
      category: next.category,
      spec: next as unknown as Prisma.InputJsonValue,
      // The previous verdict describes the previous wording. Keeping it would
      // show a rejection reason next to text that no longer contains the problem.
      rejectedReason: null,
      lastError: null,
      createdById: existing.createdById ?? userId,
    },
  });

  return sendToMeta(id, next, existing.metaId ? "edit" : "create");
}

/**
 * The one place a template actually goes to Meta.
 *
 * Shared by create and edit because everything except the Graph call is
 * identical — and because the failure handling is the part worth writing once:
 * whatever Meta says, it lands on the row as `lastError`, so an author sees the
 * refusal in the CRM rather than in a server log they cannot read.
 */
async function sendToMeta(id: string, spec: WaTemplateSpec, mode: "create" | "edit"): Promise<SubmitOutcome> {
  const provider = await getWaProvider();
  if (!provider.supports("manageTemplates")) {
    const detail = `${provider.label} cannot submit templates to Meta. Set the transport to WhatsApp Cloud API in CRM → Settings; the template is saved here as a draft in the meantime.`;
    const row = await prisma.waTemplate.update({
      where: { id },
      data: { status: "DRAFT", lastError: detail },
      include: INCLUDE,
    });
    return { ok: false, detail, template: serializeWaTemplate(row) };
  }

  const row = await prisma.waTemplate.findUnique({ where: { id } });
  if (!row) return { ok: false, detail: "That template no longer exists." };

  const payload = buildCreatePayload(spec);
  const result =
    mode === "edit" && row.metaId
      ? await provider.updateTemplate(row.metaId, buildEditPayload(spec))
      : await provider.createTemplate(payload);

  if (!result.ok) {
    logger.warn("wa_template_submit_failed", { id, mode, code: result.code });
    const updated = await prisma.waTemplate.update({
      where: { id },
      // Status is left alone: a rejected EDIT does not un-approve the template
      // Meta already holds, and overwriting APPROVED here would make a live
      // template look unusable.
      data: { lastError: result.detail },
      include: INCLUDE,
    });
    return { ok: false, detail: result.detail, template: serializeWaTemplate(updated) };
  }

  const updated = await prisma.waTemplate.update({
    where: { id },
    data: {
      metaId: result.metaId ?? row.metaId,
      // Meta answers PENDING on create and nothing at all on edit — an edited
      // template goes back into review, so PENDING is the honest default.
      status: normalizeTemplateStatus(result.status ?? "PENDING"),
      category: result.category ?? spec.category,
      rejectedReason: null,
      lastError: null,
      submittedAt: new Date(),
      syncedAt: new Date(),
    },
    include: INCLUDE,
  });

  logger.info("wa_template_submitted", { id, mode, metaId: updated.metaId });
  return { ok: true, template: serializeWaTemplate(updated) };
}

/**
 * Remove a template.
 *
 * Deleted at Meta first, then here. The other order would leave a live template
 * on the WABA that the CRM has forgotten about — sendable by anyone with Business
 * Manager access and invisible to everyone else. When Meta refuses, the local row
 * stays and the caller is told why, rather than the two drifting apart silently.
 *
 * A draft that never reached Meta is simply deleted; there is nothing there to
 * remove.
 */
export async function deleteWaTemplate(id: string): Promise<{ ok: boolean; detail?: string }> {
  const row = await prisma.waTemplate.findUnique({ where: { id } });
  if (!row) return { ok: true };

  if (row.metaId) {
    const provider = await getWaProvider();
    if (!provider.supports("manageTemplates")) {
      return { ok: false, detail: `${provider.label} cannot delete templates at Meta — switch to the WhatsApp Cloud API first.` };
    }
    const result = await provider.deleteTemplate(row.name, row.metaId);
    if (!result.ok) return { ok: false, detail: result.detail };
  }

  await prisma.waTemplate.delete({ where: { id } });
  logger.info("wa_template_deleted", { id, metaId: row.metaId });
  return { ok: true };
}

export type SyncSummary = {
  ok: boolean;
  detail?: string;
  /** Local rows whose status was refreshed from the catalogue. */
  matched: number;
  /** Local rows whose status actually changed. */
  changed: number;
  /** Rows Meta no longer holds, marked DELETED here. */
  disappeared: number;
  /** Catalogue entries with no local row — shown, not imported. */
  metaOnly: number;
};

/**
 * Reconcile every local template against Meta's catalogue.
 *
 * This is the authoritative path and the reason the webhook being optional is
 * survivable: whatever the webhook missed — because the app was not subscribed
 * to the template field, or the delivery failed, or the template was approved
 * before this feature existed — a sync settles it.
 *
 * A local row whose Meta id is absent from the catalogue is marked DELETED
 * rather than removed, because someone deleting a template in Business Manager
 * should not silently destroy the CRM's only copy of wording that took a review
 * cycle to approve. Drafts are exempt: Meta has never heard of them, so their
 * absence means nothing.
 */
export async function syncWaTemplatesFromMeta(): Promise<SyncSummary> {
  const provider = await getWaProvider();
  const empty: SyncSummary = { ok: false, matched: 0, changed: 0, disappeared: 0, metaOnly: 0 };

  if (!provider.supports("listTemplates")) {
    return { ...empty, detail: `${provider.label} cannot read the template catalogue — this needs the WhatsApp Cloud API.` };
  }

  const catalogue = await provider.listTemplates().catch(() => []);
  if (catalogue.length === 0) {
    // Indistinguishable from a WABA with no templates, so nothing is deleted on
    // the strength of it. A read that failed and a genuinely empty catalogue
    // both come back as [], and acting on the second would wipe the first.
    return { ...empty, ok: true, detail: "Meta returned no templates. Nothing was changed." };
  }

  const rows = await prisma.waTemplate.findMany();
  const byMetaId = new Map(rows.filter((r) => r.metaId).map((r) => [r.metaId!, r]));
  const byName = new Map(rows.map((r) => [`${r.name}:${r.language}`, r]));

  let matched = 0;
  let changed = 0;
  let metaOnly = 0;
  const seen = new Set<string>();

  for (const t of catalogue) {
    // By id first: a template renamed at Meta is still the same template, and
    // matching on name alone would create a duplicate row for it.
    const row = (t.id ? byMetaId.get(t.id) : undefined) ?? byName.get(`${t.name}:${t.language}`);
    if (!row) {
      metaOnly += 1;
      continue;
    }
    seen.add(row.id);
    matched += 1;

    const status = normalizeTemplateStatus(t.status);
    const category = t.category ?? row.category;
    const reason = t.rejectedReason;
    const statusChanged = row.status !== status || row.category !== category || row.rejectedReason !== reason;
    if (statusChanged) changed += 1;

    await prisma.waTemplate.update({
      where: { id: row.id },
      data: {
        // Adopts the id for a row submitted before we captured one, and for one
        // matched by name after being created directly in Business Manager.
        metaId: t.id ?? row.metaId,
        status,
        category,
        rejectedReason: reason,
        // A verdict from Meta supersedes a submission error we recorded locally.
        ...(statusChanged ? { lastError: null } : {}),
        syncedAt: new Date(),
      },
    });
  }

  const gone = rows.filter((r) => r.metaId && !seen.has(r.id) && r.status !== "DELETED");
  for (const r of gone) {
    await prisma.waTemplate.update({ where: { id: r.id }, data: { status: "DELETED", syncedAt: new Date() } });
  }

  logger.info("wa_templates_synced", { matched, changed, disappeared: gone.length, metaOnly });
  return { ok: true, matched, changed, disappeared: gone.length, metaOnly };
}

/**
 * Apply status changes that arrived on the webhook.
 *
 * Matched by Meta's template id where we have one and by name+language
 * otherwise, which covers the template approved before it was ever submitted
 * from here. An update naming a template we do not hold is ignored rather than
 * created: the WABA is shared, and inventing rows for someone else's templates
 * would fill this list with things nobody here can edit.
 */
export async function applyTemplateStatusUpdates(updates: readonly WaTemplateStatusUpdate[]): Promise<number> {
  let applied = 0;

  for (const u of updates) {
    const where: Prisma.WaTemplateWhereInput[] = [];
    if (u.metaId) where.push({ metaId: u.metaId });
    if (u.name && u.language) where.push({ name: u.name, language: u.language });
    if (where.length === 0) continue;

    const row = await prisma.waTemplate.findFirst({ where: { OR: where } });
    if (!row) continue;

    const status: WaTemplateStatus = u.status === "UNKNOWN" ? normalizeTemplateStatus(row.status) : u.status;

    await prisma.waTemplate.update({
      where: { id: row.id },
      data: {
        metaId: u.metaId ?? row.metaId,
        status,
        // A rejection carries a reason; an approval clears the previous one, so
        // an approved template never shows why an earlier version was refused.
        rejectedReason: status === "REJECTED" ? u.reason : null,
        ...(u.newCategory ? { category: u.newCategory } : {}),
        ...(status !== "REJECTED" ? { lastError: null } : {}),
        syncedAt: new Date(),
      },
    });
    applied += 1;
    logger.info("wa_template_status_update", { id: row.id, status, category: u.newCategory });
  }

  return applied;
}
