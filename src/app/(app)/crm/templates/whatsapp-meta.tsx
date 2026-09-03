"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  WA_TEMPLATE_CATEGORIES,
  BODY_MAX,
  FOOTER_MAX,
  HEADER_MAX,
  normalizeTemplateName,
  renderSpecPreview,
  templateVariableIndexes,
  validateTemplateSpec,
  type WaTemplateButton,
  type WaTemplateDTO,
  type WaTemplateSpec,
} from "@/lib/wa/template-spec";
import { rejectionReasonLabel, type WaTemplateStatus } from "@/lib/wa/template-status";

/**
 * Templates that actually reach Meta.
 *
 * The CRM has always had a "WhatsApp template" screen, and nothing written on it
 * ever left the database — which is why a template could look finished here and
 * still be unusable: a message to somebody who has not written to you first has
 * to be a template Meta has approved, and Meta had never seen these. This is the
 * missing half. Write it here, submit it, watch the status, fix a rejection and
 * resubmit, all without opening Business Manager.
 *
 * The screen is deliberately blunt about the one thing that trips people up:
 * submitting is not approving. A template comes back PENDING and a human at Meta
 * decides, usually in minutes and occasionally in days.
 */

const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md";
const taCls =
  "w-full px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md resize-y";
const primaryBtn =
  "h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-60";
const secondaryBtn =
  "h-10 px-lg rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition disabled:opacity-60";
const card = "bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm";

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <span className="material-symbols-outlined" style={{ fontSize: size }}>
      {name}
    </span>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-label-sm text-on-surface-variant mb-xs">{label}</span>
      {children}
      {hint && <span className="block text-label-sm text-on-surface-variant mt-xs">{hint}</span>}
    </label>
  );
}

/**
 * The languages this desk actually writes in. Free entry is deliberately not
 * offered: a locale Meta does not recognise is rejected with a bare "Invalid
 * parameter", and a typo'd `en-US` (hyphen, not underscore) is the single most
 * common way to earn one.
 */
const LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "en_US", label: "English (US)" },
  { code: "en_GB", label: "English (UK)" },
  { code: "ml", label: "Malayalam" },
  { code: "hi", label: "Hindi" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "kn", label: "Kannada" },
  { code: "ar", label: "Arabic" },
];

/** What each status means for whether the template can be sent. */
const STATUS_META: Record<string, { cls: string; note: string }> = {
  DRAFT: {
    cls: "border border-outline-variant text-on-surface-variant",
    note: "Saved here only — Meta has never seen it.",
  },
  PENDING: {
    cls: "bg-secondary-container text-on-secondary-container",
    note: "With Meta for review. Usually minutes, sometimes days.",
  },
  APPROVED: { cls: "bg-primary text-on-primary", note: "Live — this can be sent to candidates." },
  REJECTED: { cls: "bg-error-container text-on-error-container", note: "Refused. Fix it and resubmit." },
  PAUSED: {
    cls: "bg-error-container text-on-error-container",
    note: "Suspended for poor quality — too many people blocked or reported it.",
  },
  DISABLED: { cls: "bg-error-container text-on-error-container", note: "Switched off by Meta. It cannot be sent." },
  IN_APPEAL: { cls: "bg-secondary-container text-on-secondary-container", note: "Appealed at Meta; awaiting a decision." },
  PENDING_DELETION: { cls: "bg-surface-container-high text-on-surface-variant", note: "Queued for deletion at Meta." },
  DELETED: { cls: "bg-surface-container-high text-on-surface-variant", note: "Gone from Meta. Kept here for the wording." },
  LIMIT_EXCEEDED: {
    cls: "bg-error-container text-on-error-container",
    note: "The WABA is at its template limit — delete an unused one first.",
  },
  UNKNOWN: { cls: "bg-surface-container-high text-on-surface-variant", note: "Meta reported a status we don't recognise." },
};

function StatusPill({ status }: { status: WaTemplateStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.UNKNOWN;
  return (
    <span className={"text-label-sm px-sm h-6 inline-flex items-center rounded-full font-semibold " + meta.cls}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

const EMPTY_SPEC: WaTemplateSpec = {
  name: "",
  language: "en",
  category: "UTILITY",
  headerText: null,
  headerExample: null,
  body: "",
  bodyExamples: [],
  footer: null,
  buttons: [],
};

type Payload = {
  templates: WaTemplateDTO[];
  canSubmit: boolean;
  catalogueRead: boolean;
  providerLabel: string;
};

export function WhatsAppMetaTemplates({
  seed,
  onSeedUsed,
}: {
  /** A body handed over from a CRM quick reply, already converted to {{n}}. */
  seed?: { name: string; body: string; bodyExamples: string[] } | null;
  onSeedUsed?: () => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ template: WaTemplateDTO | null; spec: WaTemplateSpec } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/crm/wa/templates").catch(() => null);
    setLoading(false);
    if (!r?.ok) return;
    setData((await r.json()) as Payload);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A quick reply sent over from the CRM list opens the builder pre-filled.
  useEffect(() => {
    if (!seed) return;
    setEditing({
      template: null,
      spec: { ...EMPTY_SPEC, name: normalizeTemplateName(seed.name), body: seed.body, bodyExamples: seed.bodyExamples },
    });
    onSeedUsed?.();
  }, [seed, onSeedUsed]);

  async function sync() {
    setSyncing(true);
    setSyncNote(null);
    const r = await fetch("/api/crm/wa/templates/sync", { method: "POST" }).catch(() => null);
    const d = (await r?.json().catch(() => null)) as
      | { ok?: boolean; detail?: string; matched?: number; changed?: number; disappeared?: number; metaOnly?: number }
      | null;
    setSyncing(false);
    if (!d?.ok) {
      setSyncNote(d?.detail ?? "Could not reach Meta.");
      return;
    }
    setSyncNote(
      d.detail ??
        `Checked ${d.matched ?? 0} template${d.matched === 1 ? "" : "s"} — ${d.changed ?? 0} changed` +
          (d.disappeared ? `, ${d.disappeared} no longer at Meta` : "") +
          (d.metaOnly ? `, ${d.metaOnly} only at Meta` : "") +
          ".",
    );
    void load();
  }

  const templates = useMemo(() => data?.templates ?? [], [data]);
  const counts = useMemo(() => {
    const by = new Map<string, number>();
    for (const t of templates) by.set(t.status, (by.get(t.status) ?? 0) + 1);
    return by;
  }, [templates]);

  return (
    <div className="space-y-lg">
      <div className={card + " p-lg space-y-sm"}>
        <div className="flex flex-wrap items-start justify-between gap-md">
          <div className="min-w-0">
            <h3 className="text-h3 text-on-surface">Approved templates (Meta)</h3>
            <p className="text-body-sm text-on-surface-variant mt-xs max-w-3xl">
              A message to a candidate who hasn&apos;t written to you first has to be a template{" "}
              <span className="font-semibold text-on-surface">Meta has approved</span>. Write it here and submit it —
              Meta reviews it and the status below updates when they decide.
            </p>
          </div>
          <div className="flex items-center gap-xs shrink-0">
            <button type="button" className={secondaryBtn} onClick={sync} disabled={syncing || !data?.catalogueRead}>
              {syncing ? "Checking…" : "Sync from Meta"}
            </button>
            <button
              type="button"
              className={primaryBtn + " inline-flex items-center gap-xs"}
              onClick={() => setEditing({ template: null, spec: EMPTY_SPEC })}
            >
              <Icon name="add" /> New template
            </button>
          </div>
        </div>

        {/* The two ways this screen can be half-wired, each said plainly rather
            than left to be discovered when a submit fails. */}
        {data && !data.canSubmit && (
          <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm text-body-sm">
            <span className="font-semibold">{data.providerLabel} can&apos;t submit templates to Meta.</span> Templates
            written here will be saved as drafts. Set the transport to WhatsApp Cloud API in CRM → Settings, then
            resubmit them.
          </div>
        )}
        {data && data.canSubmit && !data.catalogueRead && (
          <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm text-body-sm">
            The template catalogue can&apos;t be read, so approvals won&apos;t appear here. Check the WhatsApp Business
            Account ID and that the access token carries <span className="font-mono">whatsapp_business_management</span>.
          </div>
        )}

        {syncNote && <div className="text-label-sm text-on-surface-variant">{syncNote}</div>}

        {counts.size > 0 && (
          <div className="flex flex-wrap gap-xs pt-xs">
            {[...counts.entries()].map(([status, n]) => (
              <span key={status} className="inline-flex items-center gap-xs">
                <StatusPill status={status as WaTemplateStatus} />
                <span className="text-label-sm text-on-surface-variant">{n}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {loading && <div className={card + " p-lg text-on-surface-variant"}>Loading templates…</div>}

      {!loading && templates.length === 0 && (
        <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest p-xl text-center text-on-surface-variant">
          No templates yet. Write one and submit it — Meta has to approve it before it can be sent to a candidate who
          hasn&apos;t messaged us.
        </div>
      )}

      <div className="space-y-md">
        {templates.map((t) => (
          <TemplateRow
            key={t.id}
            template={t}
            onEdit={() => t.spec && setEditing({ template: t, spec: t.spec })}
            onChanged={load}
          />
        ))}
      </div>

      {editing && (
        <TemplateEditor
          template={editing.template}
          initial={editing.spec}
          canSubmit={data?.canSubmit ?? false}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function TemplateRow({
  template: t,
  onEdit,
  onChanged,
}: {
  template: WaTemplateDTO;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const note = (STATUS_META[t.status] ?? STATUS_META.UNKNOWN).note;

  async function remove() {
    if (!confirm(`Delete "${t.name}" (${t.language})? It is removed from Meta too and can't be undone.`)) return;
    setBusy(true);
    setErr(null);
    const r = await fetch(`/api/crm/wa/templates/${t.id}`, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!r?.ok) {
      const d = (await r?.json().catch(() => ({}))) as { error?: string };
      setErr(d?.error ?? "Meta would not delete that template.");
      return;
    }
    onChanged();
  }

  const preview = t.spec ? renderSpecPreview(t.spec) : null;

  return (
    <section className={card + " overflow-hidden"}>
      <div className={"border-l-4 " + (t.status === "APPROVED" ? "border-primary" : "border-outline-variant")}>
        <div className="flex flex-wrap items-start justify-between gap-md px-lg py-md">
          <div className="min-w-0 space-y-xs">
            <div className="flex items-center gap-xs flex-wrap">
              <span className="text-body-md font-semibold text-on-surface font-mono">{t.name}</span>
              <span className="text-label-sm font-mono text-on-surface-variant">{t.language}</span>
              <StatusPill status={t.status} />
              <span className="px-sm h-6 inline-flex items-center rounded-full bg-surface-container text-label-sm text-on-surface-variant">
                {t.category}
              </span>
              {t.metaOnly && (
                <span className="text-label-sm text-on-surface-variant italic">
                  written in Meta Business Manager — not editable here
                </span>
              )}
            </div>

            <p className="text-label-sm text-on-surface-variant">{note}</p>

            {(preview?.header || t.metaBody || preview?.body) && (
              <div className="border border-outline-variant rounded-lg p-sm bg-surface-container-low max-w-2xl space-y-xs">
                {preview?.header && <p className="text-body-sm font-semibold text-on-surface">{preview.header}</p>}
                <p className="text-body-sm text-on-surface-variant whitespace-pre-wrap">
                  {preview?.body || t.metaBody}
                </p>
                {preview?.footer && <p className="text-label-sm text-on-surface-variant">{preview.footer}</p>}
                {t.spec?.buttons.length ? (
                  <div className="flex flex-wrap gap-xs pt-xs">
                    {t.spec.buttons.map((b, i) => (
                      <span
                        key={i}
                        className="text-label-sm px-sm h-6 inline-flex items-center rounded-full border border-outline-variant text-accent"
                      >
                        {b.text}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            )}

            {/* Meta's verdict, and our own failure to even get it reviewed, are
                different things and are shown as different things. */}
            {t.status === "REJECTED" && (
              <p className="text-body-sm text-error">
                <span className="font-semibold">Meta rejected this:</span>{" "}
                {t.rejectedReasonLabel ?? rejectionReasonLabel(t.rejectedReason) ?? "no reason given."}
              </p>
            )}
            {t.lastError && (
              <p className="text-body-sm text-error">
                <span className="font-semibold">Not submitted:</span> {t.lastError}
              </p>
            )}

            <p className="text-label-sm text-on-surface-variant">
              {t.createdBy ? `Written by ${t.createdBy}. ` : ""}
              {t.submittedAt ? `Submitted ${new Date(t.submittedAt).toLocaleString()}. ` : ""}
              {t.syncedAt ? `Status confirmed ${new Date(t.syncedAt).toLocaleString()}.` : ""}
            </p>
          </div>

          <div className="flex items-center gap-xs shrink-0">
            {t.spec && (
              <button
                type="button"
                onClick={onEdit}
                disabled={!t.editable}
                title={t.editable ? "Edit and resubmit" : "Meta won't accept an edit while it's under review"}
                className="h-9 w-9 grid place-items-center rounded-lg text-on-surface-variant hover:text-accent hover:bg-surface-container-low disabled:opacity-40"
              >
                <Icon name="edit" />
              </button>
            )}
            {!t.metaOnly && (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                title="Delete at Meta and here"
                className="h-9 w-9 grid place-items-center rounded-lg text-on-surface-variant hover:text-error hover:bg-surface-container-low disabled:opacity-40"
              >
                <Icon name="delete" />
              </button>
            )}
          </div>
        </div>
        {err && <div className="px-lg pb-sm text-label-sm text-error">{err}</div>}
      </div>
    </section>
  );
}

function TemplateEditor({
  template,
  initial,
  canSubmit,
  onClose,
  onSaved,
}: {
  template: WaTemplateDTO | null;
  initial: WaTemplateSpec;
  canSubmit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [spec, setSpec] = useState<WaTemplateSpec>(initial);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setMounted(true), []);

  // Name and language are immutable once Meta holds the template: Meta ignores a
  // change to either, so an "edit" that appeared to rename it would leave the
  // original live under the old name.
  const locked = !!template?.metaId;

  const bodyVars = useMemo(() => templateVariableIndexes(spec.body), [spec.body]);
  const headerHasVar = templateVariableIndexes(spec.headerText ?? "").length > 0;
  const check = useMemo(() => validateTemplateSpec({ ...spec, name: normalizeTemplateName(spec.name) }), [spec]);
  const preview = useMemo(() => renderSpecPreview(spec), [spec]);

  function set<K extends keyof WaTemplateSpec>(key: K, value: WaTemplateSpec[K]) {
    setSpec((s) => ({ ...s, [key]: value }));
  }

  /** Append the next variable at the caret, and grow the example list with it. */
  function addVariable() {
    const next = bodyVars.length + 1;
    const el = bodyRef.current;
    const at = el?.selectionStart ?? spec.body.length;
    const body = spec.body.slice(0, at) + `{{${next}}}` + spec.body.slice(el?.selectionEnd ?? at);
    setSpec((s) => ({ ...s, body, bodyExamples: [...s.bodyExamples, ""] }));
    requestAnimationFrame(() => {
      el?.focus();
      const caret = at + `{{${next}}}`.length;
      el?.setSelectionRange(caret, caret);
    });
  }

  function setExample(i: number, value: string) {
    setSpec((s) => {
      const next = [...s.bodyExamples];
      while (next.length <= i) next.push("");
      next[i] = value;
      return { ...s, bodyExamples: next };
    });
  }

  function addButton(kind: WaTemplateButton["type"]) {
    const b: WaTemplateButton =
      kind === "QUICK_REPLY"
        ? { type: "QUICK_REPLY", text: "" }
        : kind === "URL"
          ? { type: "URL", text: "", url: "https://" }
          : { type: "PHONE_NUMBER", text: "", phoneNumber: "+91" };
    set("buttons", [...spec.buttons, b]);
  }

  function patchButton(i: number, patch: Partial<WaTemplateButton>) {
    set(
      "buttons",
      spec.buttons.map((b, idx) => (idx === i ? ({ ...b, ...patch } as WaTemplateButton) : b)),
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (check.errors.length) return;
    setBusy(true);
    setServerErrors([]);

    const payload = { ...spec, name: normalizeTemplateName(spec.name) };
    const res = await fetch(template ? `/api/crm/wa/templates/${template.id}` : "/api/crm/wa/templates", {
      method: template ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);

    setBusy(false);
    if (!res?.ok) {
      const d = (await res?.json().catch(() => ({}))) as { error?: string; errors?: string[]; message?: string };
      setServerErrors(d?.errors?.length ? d.errors : [d?.error || d?.message || "The template could not be saved."]);
      return;
    }
    onSaved();
  }

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/50 p-md" onClick={() => !busy && onClose()}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-5xl max-h-[94vh] overflow-y-auto bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg"
      >
        <div className="sticky top-0 bg-surface-container-lowest border-b border-outline-variant px-lg py-md flex items-center gap-xs z-10">
          <Icon name="chat" />
          <h3 className="text-h3 text-on-surface">{template ? "Edit template" : "New WhatsApp template"}</h3>
          {template && <StatusPill status={template.status} />}
        </div>

        <div className="grid md:grid-cols-[1fr_320px] gap-lg p-lg">
          <div className="space-y-md min-w-0">
            {serverErrors.length > 0 && (
              <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm space-y-xs">
                {serverErrors.map((e, i) => (
                  <p key={i} className="text-body-sm">
                    {e}
                  </p>
                ))}
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-md">
              <Field
                label="Template name"
                hint={
                  locked
                    ? "Fixed — Meta won't rename an existing template."
                    : spec.name
                      ? `Submitted to Meta as ${normalizeTemplateName(spec.name)}`
                      : "Lowercase, numbers and underscores. Spaces are converted for you."
                }
              >
                <input
                  className={inputCls}
                  value={spec.name}
                  disabled={locked}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="e.g. follow_up_no_response"
                  autoFocus
                />
              </Field>

              <Field label="Language" hint={locked ? "Fixed — a different language is a different template." : undefined}>
                <select
                  className={inputCls}
                  value={spec.language}
                  disabled={locked}
                  onChange={(e) => set("language", e.target.value)}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label} ({l.code})
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div>
              <span className="block text-label-sm text-on-surface-variant mb-xs">Category</span>
              <div className="space-y-xs">
                {WA_TEMPLATE_CATEGORIES.map((c) => (
                  <label
                    key={c.value}
                    className={
                      "flex gap-sm items-start rounded-lg border p-sm cursor-pointer transition " +
                      (spec.category === c.value
                        ? "border-primary bg-surface-container-low"
                        : "border-outline-variant hover:bg-surface-container-low")
                    }
                  >
                    <input
                      type="radio"
                      className="mt-xs"
                      checked={spec.category === c.value}
                      onChange={() => set("category", c.value)}
                    />
                    <span>
                      <span className="block text-body-md text-on-surface font-semibold">{c.label}</span>
                      <span className="block text-label-sm text-on-surface-variant">{c.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-label-sm text-on-surface-variant mt-xs">
                Getting this wrong is the most common rejection — a Utility template that promotes anything comes back as{" "}
                <span className="font-mono">INCORRECT_CATEGORY</span>.
              </p>
            </div>

            <Field label={`Header (optional, ${HEADER_MAX} characters)`}>
              <input
                className={inputCls}
                value={spec.headerText ?? ""}
                maxLength={HEADER_MAX}
                onChange={(e) => set("headerText", e.target.value || null)}
                placeholder="e.g. Your AHPRA application"
              />
            </Field>
            {headerHasVar && (
              <Field label="Sample value for the header's {{1}}">
                <input
                  className={inputCls}
                  value={spec.headerExample ?? ""}
                  onChange={(e) => set("headerExample", e.target.value || null)}
                  placeholder="e.g. Priya"
                />
              </Field>
            )}

            <div>
              <div className="flex items-center justify-between mb-xs">
                <span className="text-label-sm text-on-surface-variant">
                  Message body ({spec.body.length}/{BODY_MAX})
                </span>
                <button type="button" onClick={addVariable} className="text-primary text-label-sm font-semibold hover:underline">
                  + Add a variable
                </button>
              </div>
              <textarea
                ref={bodyRef}
                className={taCls + " font-mono"}
                rows={8}
                maxLength={BODY_MAX}
                value={spec.body}
                onChange={(e) => set("body", e.target.value)}
                placeholder={"Hi {{1}}, your {{2}} application has moved to the next stage."}
              />
              <p className="text-label-sm text-on-surface-variant mt-xs">
                Variables are numbered, not named — <span className="font-mono">{"{{1}}"}</span>,{" "}
                <span className="font-mono">{"{{2}}"}</span> — and are filled in per candidate when the message is sent.
              </p>
            </div>

            {bodyVars.length > 0 && (
              <div className="rounded-lg border border-outline-variant bg-surface-container-low p-md space-y-sm">
                <p className="text-label-sm text-on-surface-variant">
                  Meta needs a realistic example of each variable to review the template. These are never sent to anyone.
                </p>
                {bodyVars.map((n, i) => (
                  <Field key={n} label={`Example for {{${n}}}`}>
                    <input
                      className={inputCls}
                      value={spec.bodyExamples[i] ?? ""}
                      onChange={(e) => setExample(i, e.target.value)}
                      placeholder={i === 0 ? "e.g. Priya Menon" : "e.g. AHPRA Direct"}
                    />
                  </Field>
                ))}
              </div>
            )}

            <Field label={`Footer (optional, ${FOOTER_MAX} characters, no variables)`}>
              <input
                className={inputCls}
                value={spec.footer ?? ""}
                maxLength={FOOTER_MAX}
                onChange={(e) => set("footer", e.target.value || null)}
                placeholder="e.g. Desma Global Careers"
              />
            </Field>

            <div className="rounded-lg border border-outline-variant p-md space-y-sm">
              <div className="flex items-center justify-between flex-wrap gap-xs">
                <span className="text-label-sm text-on-surface-variant">Buttons (optional)</span>
                <div className="flex gap-xs">
                  <button type="button" onClick={() => addButton("QUICK_REPLY")} className="text-primary text-label-sm font-semibold hover:underline">
                    + Quick reply
                  </button>
                  <button type="button" onClick={() => addButton("URL")} className="text-primary text-label-sm font-semibold hover:underline">
                    + Link
                  </button>
                  <button type="button" onClick={() => addButton("PHONE_NUMBER")} className="text-primary text-label-sm font-semibold hover:underline">
                    + Call
                  </button>
                </div>
              </div>

              {spec.buttons.length === 0 && (
                <p className="text-label-sm text-on-surface-variant">
                  A quick-reply button gets a far higher response rate than asking someone to type — and its tap arrives
                  in the inbox as an ordinary reply.
                </p>
              )}

              {spec.buttons.map((b, i) => (
                <div key={i} className="flex flex-wrap items-end gap-sm border-t border-outline-variant pt-sm">
                  <span className="text-label-sm text-on-surface-variant w-20 shrink-0">
                    {b.type === "QUICK_REPLY" ? "Quick reply" : b.type === "URL" ? "Link" : "Call"}
                  </span>
                  <input
                    className={inputCls + " flex-1 min-w-[8rem]"}
                    value={b.text}
                    maxLength={25}
                    onChange={(e) => patchButton(i, { text: e.target.value })}
                    placeholder="Button label"
                  />
                  {b.type === "URL" && (
                    <input
                      className={inputCls + " flex-1 min-w-[12rem]"}
                      value={b.url}
                      onChange={(e) => patchButton(i, { url: e.target.value } as Partial<WaTemplateButton>)}
                      placeholder="https://desgro.in/…"
                    />
                  )}
                  {b.type === "PHONE_NUMBER" && (
                    <input
                      className={inputCls + " flex-1 min-w-[10rem]"}
                      value={b.phoneNumber}
                      onChange={(e) => patchButton(i, { phoneNumber: e.target.value } as Partial<WaTemplateButton>)}
                      placeholder="+919000000000"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => set("buttons", spec.buttons.filter((_, idx) => idx !== i))}
                    className="h-10 w-10 grid place-items-center rounded-lg text-on-surface-variant hover:text-error"
                  >
                    <Icon name="close" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Preview + verdict, pinned beside the form so a rule breaks in view
              rather than after a submit. */}
          <div className="space-y-md">
            <div className="rounded-xl border border-outline-variant bg-surface-container-low p-md">
              <p className="text-label-sm text-on-surface-variant mb-sm">As the candidate sees it</p>
              <div className="rounded-lg bg-surface-container-lowest border border-outline-variant p-sm space-y-xs">
                {preview.header && <p className="text-body-sm font-semibold text-on-surface">{preview.header}</p>}
                <p className="text-body-sm text-on-surface whitespace-pre-wrap">
                  {preview.body || <span className="text-on-surface-variant italic">Nothing written yet.</span>}
                </p>
                {preview.footer && <p className="text-label-sm text-on-surface-variant">{preview.footer}</p>}
                {spec.buttons.length > 0 && (
                  <div className="pt-xs space-y-xs border-t border-outline-variant">
                    {spec.buttons.map((b, i) => (
                      <div key={i} className="text-body-sm text-accent text-center py-xs">
                        {b.text || "…"}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {check.errors.length > 0 && (
              <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm space-y-xs">
                <p className="text-label-sm font-semibold">Meta will not accept this yet</p>
                {check.errors.map((e, i) => (
                  <p key={i} className="text-body-sm">
                    • {e}
                  </p>
                ))}
              </div>
            )}

            {check.warnings.length > 0 && (
              <div className="rounded-lg border border-outline-variant bg-surface-container-low px-md py-sm space-y-xs">
                <p className="text-label-sm font-semibold text-on-surface">Likely to be rejected on review</p>
                {check.warnings.map((w, i) => (
                  <p key={i} className="text-body-sm text-on-surface-variant">
                    • {w}
                  </p>
                ))}
                <p className="text-label-sm text-on-surface-variant">
                  You can still submit — these are review habits, not API rules.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 bg-surface-container-lowest border-t border-outline-variant px-lg py-md flex items-center justify-between gap-base flex-wrap">
          <p className="text-label-sm text-on-surface-variant">
            {canSubmit
              ? "Submitting sends it to Meta for review — it can't be used until they approve it."
              : "Saved as a draft: the current transport can't submit to Meta."}
          </p>
          <div className="flex gap-base">
            <button type="button" className={secondaryBtn} disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={primaryBtn} disabled={busy || check.errors.length > 0}>
              {busy ? "Submitting…" : template ? "Save & resubmit" : "Submit to Meta"}
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  );
}
