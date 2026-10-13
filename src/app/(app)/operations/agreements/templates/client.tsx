"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TEMPLATE_CATEGORIES } from "@/lib/esign/templates";
import {
  Field,
  Icon,
  Modal,
  api,
  checkPdfFile,
  formatDate,
  inputCls,
  primaryBtn,
  secondaryBtn,
  taCls,
  uploadTemplatePdf,
} from "../_ui";

export type TemplateRow = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  active: boolean;
  updatedAt: string;
  version: number | null;
  numPages: number | null;
  fieldCount: number;
  sentCount: number;
};

export function TemplatesClient({ templates, blobReady }: { templates: TemplateRow[]; blobReady: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const archivedCount = templates.filter((t) => !t.active).length;
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return templates.filter(
      (t) =>
        (showArchived || t.active) &&
        (!category || t.category === category) &&
        (!needle || t.name.toLowerCase().includes(needle) || (t.description ?? "").toLowerCase().includes(needle)),
    );
  }, [templates, q, category, showArchived]);

  async function clone(t: TemplateRow) {
    setBusyId(t.id);
    setError(null);
    try {
      const res = await api<{ template: { id: string } }>(`/api/esign/templates/${t.id}/clone`, "POST", {});
      router.push(`/operations/agreements/templates/${res.template.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not copy the template.");
      setBusyId(null);
    }
  }

  async function setActive(t: TemplateRow, active: boolean) {
    if (!active && !window.confirm(`Archive "${t.name}"? It will no longer be offered when sending agreements. You can restore it later.`)) {
      return;
    }
    setBusyId(t.id);
    setError(null);
    try {
      await api(`/api/esign/templates/${t.id}`, "PATCH", { active });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the template.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-md">
      {!blobReady && (
        <div className="rounded-lg border border-outline-variant bg-surface-container-low p-md text-body-md">
          File storage is not set up on this deployment, so PDFs cannot be uploaded yet.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-sm">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <span className="absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant">
            <Icon name="search" />
          </span>
          <input
            className={inputCls + " pl-xl"}
            placeholder="Search templates"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search templates"
          />
        </div>
        <select
          className={inputCls.replace("w-full", "w-auto")}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {TEMPLATE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {archivedCount > 0 && (
          <label className="inline-flex items-center gap-xs text-body-md">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived ({archivedCount})
          </label>
        )}
        <div className="flex-1" />
        <button type="button" className={primaryBtn} onClick={() => setCreating(true)} disabled={!blobReady}>
          <Icon name="add" /> New template
        </button>
      </div>

      {error && (
        <p className="text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      {templates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-outline-variant p-xl text-center space-y-sm">
          <Icon name="draw" size={40} className="text-on-surface-variant" />
          <h3 className="text-h3 font-bold">No agreement templates yet</h3>
          <p className="text-body-md text-on-surface-variant max-w-lg mx-auto">
            Upload a master agreement PDF once, mark where the client signs and which details come from the CRM,
            and it can be sent to any client without editing the PDF again.
          </p>
          <button type="button" className={primaryBtn} onClick={() => setCreating(true)} disabled={!blobReady}>
            <Icon name="upload_file" /> Upload the first template
          </button>
        </div>
      ) : visible.length === 0 ? (
        <p className="text-body-md text-on-surface-variant py-lg text-center">No templates match these filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full text-body-md">
            <thead className="bg-surface-container-low text-left text-on-surface-variant">
              <tr>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider">Template</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider">Category</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider">Version</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider text-right">Fields</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider text-right">Sent</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider">Updated</th>
                <th className="px-md py-sm" />
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <tr key={t.id} className={"border-t border-outline-variant " + (t.active ? "" : "opacity-60")}>
                  <td className="px-md py-sm align-top">
                    <Link href={`/operations/agreements/templates/${t.id}`} className="font-semibold hover:underline">
                      {t.name}
                    </Link>
                    {!t.active && (
                      <span className="ml-sm text-caption px-xs py-[1px] rounded bg-surface-container text-on-surface-variant">
                        Archived
                      </span>
                    )}
                    {t.description && (
                      <p className="text-caption text-on-surface-variant line-clamp-2 max-w-md">{t.description}</p>
                    )}
                  </td>
                  <td className="px-md py-sm align-top whitespace-nowrap">{t.category}</td>
                  <td className="px-md py-sm align-top whitespace-nowrap">
                    {t.version ? `v${t.version} · ${t.numPages} page${t.numPages === 1 ? "" : "s"}` : "—"}
                  </td>
                  <td className="px-md py-sm align-top text-right tabular-nums">{t.fieldCount}</td>
                  <td className="px-md py-sm align-top text-right tabular-nums">{t.sentCount}</td>
                  <td className="px-md py-sm align-top whitespace-nowrap">{formatDate(t.updatedAt)}</td>
                  <td className="px-md py-sm align-top">
                    <div className="flex justify-end gap-xs">
                      {t.active && (
                        <Link
                          href={`/operations/agreements/templates/${t.id}/builder`}
                          className={secondaryBtn + " !py-xs"}
                          title="Place fields on the PDF"
                        >
                          <Icon name="edit_document" /> Fields
                        </Link>
                      )}
                      <button
                        type="button"
                        className={secondaryBtn + " !py-xs"}
                        onClick={() => clone(t)}
                        disabled={busyId === t.id || !t.version}
                        title="Copy this template"
                        aria-label={`Copy ${t.name}`}
                      >
                        <Icon name="content_copy" />
                      </button>
                      <button
                        type="button"
                        className={secondaryBtn + " !py-xs"}
                        onClick={() => setActive(t, !t.active)}
                        disabled={busyId === t.id}
                        title={t.active ? "Archive" : "Restore"}
                        aria-label={`${t.active ? "Archive" : "Restore"} ${t.name}`}
                      >
                        <Icon name={t.active ? "archive" : "unarchive"} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <NewTemplateModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewTemplateModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>(TEMPLATE_CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give the template a name.");
    const fileError = checkPdfFile(file);
    if (fileError || !file) return setError(fileError);
    setError(null);
    setProgress(0);
    try {
      const pathname = await uploadTemplatePdf(file, setProgress);
      const res = await api<{ template: { id: string } }>("/api/esign/templates", "POST", {
        name,
        category,
        description: description || null,
        pathname,
        fileName: file.name,
      });
      router.push(`/operations/agreements/templates/${res.template.id}/builder`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed. Try again.");
      setProgress(null);
    }
  }

  return (
    <Modal title="New agreement template" subtitle="Upload the master PDF. You will place the fields next." onClose={busy ? () => {} : onClose}>
      <form onSubmit={submit} className="space-y-md">
        <Field label="Name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="AHPRA Agreement" autoFocus />
        </Field>
        <Field label="Category">
          <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
            {TEMPLATE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Description (optional)">
          <textarea className={taCls} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="PDF" hint="Up to 15 MB. Password-protected PDFs cannot be used.">
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-body-md"
          />
        </Field>
        {progress !== null && (
          <div className="space-y-xs" aria-live="polite">
            <div className="h-2 rounded bg-surface-container overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-caption text-on-surface-variant">
              {progress < 100 ? `Uploading… ${progress}%` : "Checking the PDF…"}
            </p>
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
            {busy ? "Uploading…" : "Upload and place fields"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
