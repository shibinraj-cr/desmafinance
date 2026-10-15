"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatBytes } from "@/lib/finance-docs";
import { TEMPLATE_CATEGORIES } from "@/lib/esign/templates";
import {
  Field,
  Icon,
  Modal,
  api,
  checkPdfFile,
  formatDateTime,
  inputCls,
  primaryBtn,
  secondaryBtn,
  taCls,
  uploadTemplatePdf,
} from "../../_ui";

type VersionRow = {
  id: string;
  version: number;
  fileName: string;
  fileSize: number;
  fileSha256: string;
  numPages: number;
  notes: string | null;
  fieldCount: number;
  sentCount: number;
  createdBy: string | null;
  createdAt: string;
};

export type TemplateDetail = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  defaultExpiryDays: number;
  defaultReminderDays: number;
  emailSubject: string | null;
  emailBody: string | null;
  whatsappTemplateName: string | null;
  active: boolean;
  currentVersionId: string | null;
  createdBy: string | null;
  createdAt: string;
  versions: VersionRow[];
};

export function TemplateDetailClient({ template, blobReady }: { template: TemplateDetail; blobReady: boolean }) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = template.versions.find((v) => v.id === template.currentVersionId) ?? null;
  const base = `/operations/agreements/templates/${template.id}`;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const clone = () =>
    run(async () => {
      const res = await api<{ template: { id: string } }>(`/api/esign/templates/${template.id}/clone`, "POST", {});
      router.push(`/operations/agreements/templates/${res.template.id}`);
    });

  const setActive = (active: boolean) =>
    run(async () => {
      if (!active && !window.confirm("Archive this template? It will no longer be offered when sending agreements.")) return;
      await api(`/api/esign/templates/${template.id}`, "PATCH", { active });
      router.refresh();
    });

  return (
    <div className="space-y-lg max-w-5xl">
      {!template.active && (
        <div className="rounded-lg border border-outline-variant bg-surface-container-low p-md flex flex-wrap items-center gap-sm">
          <Icon name="archive" />
          <span className="text-body-md flex-1">This template is archived. Restore it to edit it or send it.</span>
          <button type="button" className={secondaryBtn} onClick={() => setActive(true)} disabled={busy}>
            Restore
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-sm">
        {template.active && current && (
          <Link href={`${base}/builder`} className={primaryBtn}>
            <Icon name="edit_document" /> Edit fields
          </Link>
        )}
        {template.active && (
          <button type="button" className={secondaryBtn} onClick={() => setUploading(true)} disabled={!blobReady || busy}>
            <Icon name="upload_file" /> Upload new PDF version
          </button>
        )}
        <button type="button" className={secondaryBtn} onClick={clone} disabled={busy || !current}>
          <Icon name="content_copy" /> Copy template
        </button>
        {template.active && (
          <button type="button" className={secondaryBtn} onClick={() => setActive(false)} disabled={busy}>
            <Icon name="archive" /> Archive
          </button>
        )}
      </div>
      {error && (
        <p className="text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      <SettingsForm template={template} />

      <section className="space-y-sm">
        <h3 className="text-h3 font-bold">Versions</h3>
        <p className="text-body-md text-on-surface-variant">
          Every new PDF, and every field change to a version that has already been sent, becomes a new version. Sent
          agreements keep the version they were sent with.
        </p>
        <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full text-body-md">
            <thead className="bg-surface-container-low text-left text-on-surface-variant">
              <tr>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider">Version</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider">File</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider text-right">Fields</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider text-right">Sent</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider">Created</th>
                <th className="px-md py-sm" />
              </tr>
            </thead>
            <tbody>
              {template.versions.map((v) => (
                <tr key={v.id} className="border-t border-outline-variant align-top">
                  <td className="px-md py-sm whitespace-nowrap">
                    <span className="font-semibold">v{v.version}</span>
                    {v.id === template.currentVersionId && (
                      <span className="ml-sm text-caption px-xs py-[1px] rounded bg-primary/20 text-accent font-semibold">
                        Current
                      </span>
                    )}
                    {v.notes && <p className="text-caption text-on-surface-variant max-w-xs">{v.notes}</p>}
                  </td>
                  <td className="px-md py-sm">
                    <div className="break-all">{v.fileName}</div>
                    <div className="text-caption text-on-surface-variant">
                      {v.numPages} page{v.numPages === 1 ? "" : "s"} · {formatBytes(v.fileSize)} ·{" "}
                      <span title={`SHA-256 ${v.fileSha256}`} className="font-mono">
                        {v.fileSha256.slice(0, 12)}…
                      </span>
                    </div>
                  </td>
                  <td className="px-md py-sm text-right tabular-nums">{v.fieldCount}</td>
                  <td className="px-md py-sm text-right tabular-nums">{v.sentCount}</td>
                  <td className="px-md py-sm whitespace-nowrap">
                    {formatDateTime(v.createdAt)}
                    {v.createdBy && <div className="text-caption text-on-surface-variant">{v.createdBy}</div>}
                  </td>
                  <td className="px-md py-sm">
                    <div className="flex justify-end gap-xs">
                      <a
                        href={`/api/esign/templates/${template.id}/versions/${v.id}/file`}
                        target="_blank"
                        rel="noreferrer"
                        className={secondaryBtn + " !py-xs"}
                        title="Open the PDF"
                      >
                        <Icon name="picture_as_pdf" /> PDF
                      </a>
                      <Link
                        href={`${base}/builder?version=${v.id}`}
                        className={secondaryBtn + " !py-xs"}
                        title={v.id === template.currentVersionId && template.active ? "Edit fields" : "View fields"}
                      >
                        <Icon name={v.id === template.currentVersionId && template.active ? "edit_document" : "visibility"} />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {uploading && current && (
        <NewVersionModal templateId={template.id} current={current} onClose={() => setUploading(false)} />
      )}
    </div>
  );
}

function SettingsForm({ template }: { template: TemplateDetail }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: template.name,
    category: template.category,
    description: template.description ?? "",
    defaultExpiryDays: String(template.defaultExpiryDays),
    defaultReminderDays: String(template.defaultReminderDays),
    emailSubject: template.emailSubject ?? "",
    emailBody: template.emailBody ?? "",
    whatsappTemplateName: template.whatsappTemplateName ?? "",
  });
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setState("idle");
  };
  const disabled = !template.active;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const expiry = Number(form.defaultExpiryDays);
    const reminder = Number(form.defaultReminderDays);
    if (!Number.isInteger(expiry) || expiry < 1 || expiry > 90) return setError("Expiry must be 1–90 days.");
    if (!Number.isInteger(reminder) || reminder < 0 || reminder > 30) return setError("Reminders must be every 0–30 days.");
    setError(null);
    setState("saving");
    try {
      await api(`/api/esign/templates/${template.id}`, "PATCH", {
        name: form.name,
        category: form.category,
        description: form.description,
        defaultExpiryDays: expiry,
        defaultReminderDays: reminder,
        emailSubject: form.emailSubject,
        emailBody: form.emailBody,
        whatsappTemplateName: form.whatsappTemplateName.trim(),
      });
      setState("saved");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      setState("idle");
    }
  }

  return (
    <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-md">
      <h3 className="text-h3 font-bold">Settings</h3>
      <form onSubmit={save} className="space-y-md">
        <fieldset disabled={disabled} className="grid gap-md md:grid-cols-2">
          <Field label="Name">
            <input className={inputCls} value={form.name} onChange={set("name")} />
          </Field>
          <Field label="Category">
            <select className={inputCls} value={form.category} onChange={set("category")}>
              {TEMPLATE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Description">
              <textarea className={taCls} rows={2} value={form.description} onChange={set("description")} />
            </Field>
          </div>
          <Field label="Link expires after (days)" hint="Default for agreements sent from this template.">
            <input className={inputCls} type="number" min={1} max={90} value={form.defaultExpiryDays} onChange={set("defaultExpiryDays")} />
          </Field>
          <Field label="Remind every (days)" hint="0 turns automatic reminders off.">
            <input className={inputCls} type="number" min={0} max={30} value={form.defaultReminderDays} onChange={set("defaultReminderDays")} />
          </Field>
          <Field label="Email subject">
            <input className={inputCls} value={form.emailSubject} onChange={set("emailSubject")} placeholder="Your DESMA agreement is ready to sign" />
          </Field>
          <Field label="WhatsApp template" hint="Name of the approved Meta template that carries the signing link.">
            <input className={inputCls + " font-mono"} value={form.whatsappTemplateName} onChange={set("whatsappTemplateName")} placeholder="agreement_sign_link" />
          </Field>
          <div className="md:col-span-2">
            <Field label="Email message">
              <textarea className={taCls} rows={4} value={form.emailBody} onChange={set("emailBody")} />
            </Field>
          </div>
        </fieldset>
        {error && (
          <p className="text-body-md text-error" role="alert">
            {error}
          </p>
        )}
        {!disabled && (
          <div className="flex items-center gap-sm">
            <button type="submit" className={primaryBtn} disabled={state === "saving"}>
              {state === "saving" ? "Saving…" : "Save settings"}
            </button>
            {state === "saved" && <span className="text-body-md text-on-surface-variant">Saved</span>}
          </div>
        )}
      </form>
    </section>
  );
}

function NewVersionModal({ templateId, current, onClose }: { templateId: string; current: VersionRow; onClose: () => void }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ version: number; carried: number; dropped: number; from: number } | null>(null);
  const busy = progress !== null && !done;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const fileError = checkPdfFile(file);
    if (fileError || !file) return setError(fileError);
    setError(null);
    setProgress(0);
    // Read before the refresh below makes the new upload "current".
    const from = current.version;
    try {
      const pathname = await uploadTemplatePdf(file, setProgress);
      const res = await api<{ version: number; carried: number; dropped: number }>(
        `/api/esign/templates/${templateId}/versions`,
        "POST",
        { pathname, fileName: file.name, notes: notes || null },
      );
      setDone({ ...res, from });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed. Try again.");
      setProgress(null);
    }
  }

  if (done) {
    return (
      <Modal title={`Version ${done.version} uploaded`} onClose={onClose}>
        <p className="text-body-md">
          {done.carried} field{done.carried === 1 ? "" : "s"} carried over from v{done.from}.
          {done.dropped > 0 &&
            ` ${done.dropped} field${done.dropped === 1 ? " was" : "s were"} on pages the new PDF does not have and ${done.dropped === 1 ? "was" : "were"} removed.`}{" "}
          Check their positions in the builder: the new PDF&apos;s layout may differ.
        </p>
        <div className="flex justify-end gap-sm">
          <button type="button" className={secondaryBtn} onClick={onClose}>
            Close
          </button>
          <Link href={`/operations/agreements/templates/${templateId}/builder`} className={primaryBtn}>
            Check fields
          </Link>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Upload new PDF version"
      subtitle={`Becomes v${current.version + 1}. The ${current.fieldCount} field${current.fieldCount === 1 ? "" : "s"} on v${current.version} are copied onto it.`}
      onClose={busy ? () => {} : onClose}
    >
      <form onSubmit={submit} className="space-y-md">
        <Field label="PDF" hint="Up to 15 MB. Password-protected PDFs cannot be used.">
          <input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-body-md" />
        </Field>
        <Field label="What changed? (optional)">
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Updated refund clause" maxLength={500} />
        </Field>
        {progress !== null && (
          <div className="space-y-xs" aria-live="polite">
            <div className="h-2 rounded bg-surface-container overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-caption text-on-surface-variant">{progress < 100 ? `Uploading… ${progress}%` : "Checking the PDF…"}</p>
          </div>
        )}
        {error && (
          <p className="text-body-md text-error" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-sm">
          <button type="button" className={secondaryBtn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={primaryBtn} disabled={busy}>
            {busy ? "Uploading…" : "Upload"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
