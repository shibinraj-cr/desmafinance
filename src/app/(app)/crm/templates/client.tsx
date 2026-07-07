"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  CRM_TEMPLATE_MERGE_FIELDS,
  CRM_TEMPLATE_SAMPLE_VARS,
  fillTemplate,
  type MessageChannel,
  type MessageTemplateDTO,
} from "@/lib/crm";

const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md";
const taCls =
  "w-full px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md resize-y font-mono";
const primaryBtn =
  "h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-60";
const secondaryBtn =
  "h-10 px-lg rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-label-sm text-on-surface-variant mb-xs">{label}</span>
      {children}
    </label>
  );
}
function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <span className="material-symbols-outlined" style={{ fontSize: size }}>
      {name}
    </span>
  );
}

async function api(url: string, method: string, body?: unknown): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.ok) return { ok: true };
  const d = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  return { ok: false, error: d.message || d.error || "Request failed." };
}

const CHANNELS: { key: MessageChannel; label: string; icon: string }[] = [
  { key: "email", label: "Email", icon: "mail" },
  { key: "whatsapp", label: "WhatsApp", icon: "chat" },
];

export function MessageTemplatesClient({ templates }: { templates: MessageTemplateDTO[] }) {
  const [channel, setChannel] = useState<MessageChannel>("email");
  const [editor, setEditor] = useState<{ template: MessageTemplateDTO | null } | null>(null);

  const list = useMemo(() => templates.filter((t) => t.channel === channel), [templates, channel]);

  return (
    <div className="space-y-lg">
      <div className="flex flex-wrap items-center justify-between gap-md">
        <div>
          <h2 className="text-h2 text-on-surface">Message templates</h2>
          <p className="text-body-sm text-on-surface-variant">
            Reusable email &amp; WhatsApp messages the team can pick when contacting a lead. Bodies (and email subjects)
            support <span className="font-mono">{"{merge}"}</span> fields that fill in per lead when sent.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditor({ template: null })}
          className={primaryBtn + " inline-flex items-center gap-xs"}
        >
          <Icon name="add" /> New {channel === "email" ? "email" : "WhatsApp"} template
        </button>
      </div>

      {/* Channel tabs */}
      <div className="inline-flex rounded-lg border border-outline-variant overflow-hidden">
        {CHANNELS.map((c) => {
          const active = channel === c.key;
          const count = templates.filter((t) => t.channel === c.key).length;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setChannel(c.key)}
              className={
                "px-md h-9 text-label-sm font-semibold transition inline-flex items-center gap-xs " +
                (active
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low")
              }
            >
              <Icon name={c.icon} size={16} /> {c.label}
              <span className={"text-label-sm rounded px-xs " + (active ? "bg-on-primary/20" : "bg-surface-container-high")}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest p-xl text-center text-on-surface-variant">
          No {channel === "email" ? "email" : "WhatsApp"} templates yet. Create one to give the team a ready-made message.
        </div>
      ) : (
        <div className="space-y-md">
          {list.map((t) => (
            <TemplateCard key={t.id} template={t} onEdit={() => setEditor({ template: t })} />
          ))}
        </div>
      )}

      {editor && (
        <TemplateEditorModal channel={channel} template={editor.template} onClose={() => setEditor(null)} />
      )}
    </div>
  );
}

function TemplateCard({ template, onEdit }: { template: MessageTemplateDTO; onEdit: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(p: Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setErr(null);
    const r = await p;
    setBusy(false);
    if (!r.ok) {
      setErr(r.error ?? "Failed.");
      return;
    }
    router.refresh();
  }

  return (
    <section className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
      <div className={"border-l-4 " + (template.isActive ? "border-primary" : "border-outline-variant")}>
        <div className="flex flex-wrap items-start justify-between gap-md px-lg py-md">
          <div className="min-w-0">
            <div className="flex items-center gap-xs flex-wrap">
              <h3 className="text-h3 text-on-surface">{template.name}</h3>
              {template.isActive ? (
                <span className="text-label-sm px-xs rounded bg-primary text-on-primary">Active</span>
              ) : (
                <span className="text-label-sm px-xs rounded bg-surface-container-high text-on-surface-variant">Inactive</span>
              )}
            </div>
            {template.subject != null && template.channel === "email" && (
              <p className="text-body-sm text-on-surface-variant mt-xs">
                <span className="text-label-sm uppercase tracking-wider">Subject:</span> {template.subject || "—"}
              </p>
            )}
            <p className="text-body-sm text-on-surface-variant mt-xs whitespace-pre-wrap line-clamp-3">{template.body}</p>
          </div>
          <div className="flex items-center gap-xs shrink-0">
            <button
              type="button"
              disabled={busy}
              onClick={() => run(api(`/api/crm/message-templates/${template.id}`, "PATCH", { isActive: !template.isActive }))}
              className={secondaryBtn + " h-9 text-label-sm"}
            >
              {template.isActive ? "Deactivate" : "Activate"}
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="h-9 w-9 grid place-items-center rounded-lg text-on-surface-variant hover:text-accent hover:bg-surface-container-low"
              title="Edit"
            >
              <Icon name="edit" />
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (confirm(`Delete template "${template.name}"? This cannot be undone.`)) {
                  run(api(`/api/crm/message-templates/${template.id}`, "DELETE"));
                }
              }}
              className="h-9 w-9 grid place-items-center rounded-lg text-on-surface-variant hover:text-error hover:bg-surface-container-low disabled:opacity-40"
              title="Delete"
            >
              <Icon name="delete" />
            </button>
          </div>
        </div>
        {err && <div className="px-lg pb-sm text-label-sm text-error">{err}</div>}
      </div>
    </section>
  );
}

function TemplateEditorModal({
  channel,
  template,
  onClose,
}: {
  channel: MessageChannel;
  template: MessageTemplateDTO | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When editing, keep the template's own channel; when creating, use the tab.
  const ch = template?.channel ?? channel;
  const isEmail = ch === "email";
  const [name, setName] = useState(template?.name ?? "");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [isActive, setIsActive] = useState(template?.isActive ?? true);
  const [showPreview, setShowPreview] = useState(false);

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // Which field a merge chip inserts into (the last email field the user touched).
  const [activeField, setActiveField] = useState<"subject" | "body">("body");

  useEffect(() => setMounted(true), []);

  function insertToken(token: string) {
    const text = `{${token}}`;
    const useSubject = isEmail && activeField === "subject";
    const el = useSubject ? subjectRef.current : bodyRef.current;
    const current = useSubject ? subject : body;
    const set = useSubject ? setSubject : setBody;
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + text + current.slice(end);
    set(next);
    // Restore focus + caret after React re-renders the controlled value.
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const caret = start + text.length;
      el.setSelectionRange(caret, caret);
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Give the template a name.");
      return;
    }
    if (!body.trim()) {
      setError("The message body can't be empty.");
      return;
    }
    setBusy(true);
    setError(null);
    const payload = {
      channel: ch,
      name: name.trim(),
      subject: isEmail ? subject : undefined,
      body,
      isActive,
    };
    const r = template
      ? await api(`/api/crm/message-templates/${template.id}`, "PATCH", {
          name: payload.name,
          subject: payload.subject,
          body: payload.body,
          isActive: payload.isActive,
        })
      : await api("/api/crm/message-templates", "POST", payload);
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "Failed to save.");
      return;
    }
    onClose();
    router.refresh();
  }

  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/50 p-md" onClick={() => !busy && onClose()}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-2xl max-h-[92vh] overflow-y-auto bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg p-lg space-y-md"
      >
        <div className="flex items-center gap-xs">
          <Icon name={isEmail ? "mail" : "chat"} />
          <h3 className="text-h3 text-on-surface">
            {template ? "Edit" : "New"} {isEmail ? "email" : "WhatsApp"} template
          </h3>
        </div>
        {error && <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm">{error}</div>}

        <Field label="Template name">
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Follow-up — no response"
            autoFocus
          />
        </Field>

        {isEmail && (
          <Field label="Subject">
            <input
              ref={subjectRef}
              className={inputCls}
              value={subject}
              onFocus={() => setActiveField("subject")}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Following up — {service}"
            />
          </Field>
        )}

        <Field label="Message body">
          <textarea
            ref={bodyRef}
            className={taCls}
            rows={isEmail ? 8 : 10}
            value={body}
            onFocus={() => setActiveField("body")}
            onChange={(e) => setBody(e.target.value)}
            placeholder={"Hi {name},\n\n…"}
          />
        </Field>

        {/* Merge-field palette */}
        <div className="rounded-lg border border-outline-variant bg-surface-container-low p-md">
          <div className="text-label-sm text-on-surface-variant mb-xs">
            Insert a merge field {isEmail ? `(into the ${activeField})` : ""} — it fills in per lead when sent:
          </div>
          <div className="flex flex-wrap gap-xs">
            {CRM_TEMPLATE_MERGE_FIELDS.map((f) => (
              <button
                key={f.token}
                type="button"
                onClick={() => insertToken(f.token)}
                title={`${f.label} — e.g. ${f.sample}`}
                className="inline-flex items-center gap-xs h-7 px-sm rounded-full border border-outline-variant text-label-sm hover:bg-surface-container transition"
              >
                <span className="font-mono">{`{${f.token}}`}</span>
                <span className="text-on-surface-variant">{f.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-md flex-wrap">
          <label className="flex items-center gap-xs text-body-md">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active (shown to the team in the composer)
          </label>
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="text-primary text-label-sm font-semibold hover:underline inline-flex items-center gap-xs"
          >
            <Icon name={showPreview ? "visibility_off" : "visibility"} size={16} />
            {showPreview ? "Hide preview" : "Preview with sample data"}
          </button>
        </div>

        {showPreview && (
          <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md space-y-xs">
            {isEmail && (
              <div className="text-body-sm">
                <span className="text-label-sm uppercase tracking-wider text-on-surface-variant">Subject: </span>
                {fillTemplate(subject, CRM_TEMPLATE_SAMPLE_VARS) || "—"}
              </div>
            )}
            <div className="text-body-md whitespace-pre-wrap">{fillTemplate(body, CRM_TEMPLATE_SAMPLE_VARS)}</div>
          </div>
        )}

        <div className="flex justify-end gap-base">
          <button type="button" className={secondaryBtn} disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={primaryBtn} disabled={busy}>
            {busy ? "Saving…" : template ? "Save" : "Create template"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
