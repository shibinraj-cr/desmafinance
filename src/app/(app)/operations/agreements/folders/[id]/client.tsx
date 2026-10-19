"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { MULTIPART_THRESHOLD_BYTES, formatBytes } from "@/lib/finance-docs";
import {
  AGREEMENT_FOLDERS_PAGE,
  MAX_AGREEMENT_DOC_BYTES,
  agreementDocName,
  agreementDocTypeOf,
  agreementUploadPath,
  sameDocumentKey,
  type AgreementDocType,
} from "@/lib/esign/folders";
import { Icon, api, formatDate, inputCls, primaryBtn, secondaryBtn } from "../../_ui";
import { DeleteDialog, NameDialog, RowButton } from "../_dialogs";

export type DocRow = {
  id: string;
  name: string;
  size: number;
  contentType: string;
  createdAt: string;
  uploadedBy: string | null;
};

type UploadItem = {
  key: string;
  name: string;
  size: number;
  progress: number;
  status: "queued" | "uploading" | "done" | "skipped" | "error";
  note?: string;
  /** A failure worth trying again (a dropped connection), not a refused file. */
  retryable?: boolean;
};

/** A file that passed the checks and is ready to go up. */
type Ready = { key: string; file: File; type: AgreementDocType; name: string };

/** OS clutter that comes along when a whole folder is dropped. */
const IGNORED_FILES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);
const isIgnored = (name: string) => IGNORED_FILES.has(name.toLowerCase()) || name.startsWith("~$") || name.startsWith("._");

const UPLOAD_CONCURRENCY = 3;

/** Walk a dropped folder; every file inside, at any depth, is filed here. */
async function collectEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    if (!isIgnored(file.name)) out.push(file);
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns results in batches; keep reading until it is empty.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) await collectEntry(child, out);
    }
  }
}

export function FolderBrowser({
  folder,
  documents,
  isAdmin,
  storageReady,
}: {
  folder: { id: string; name: string };
  documents: DocRow[];
  isAdmin: boolean;
  storageReady: boolean;
}) {
  const router = useRouter();
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<DocRow | null>(null);
  const [deleting, setDeleting] = useState<DocRow | null>(null);

  // What is already filed here, kept current as uploads finish so a second
  // drop before the page refreshes still skips them.
  const filed = useRef(new Set(documents.map((d) => sameDocumentKey(d.name, d.size))));
  useEffect(() => {
    for (const d of documents) filed.current.add(sameDocumentKey(d.name, d.size));
  }, [documents]);
  const retryQueue = useRef(new Map<string, Ready>());

  // Leaving the page stops the uploads still in flight.
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const q = query.trim().toLowerCase();
  const shown = q ? documents.filter((d) => d.name.toLowerCase().includes(q)) : documents;

  const patchUpload = (key: string, patch: Partial<UploadItem>) =>
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...patch } : u)));

  async function send(queue: Ready[]) {
    setBusy(true);
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const { key, file, type, name } = next;
        patchUpload(key, { status: "uploading", progress: 0, note: undefined });
        let settled = false;
        try {
          const blob = await upload(agreementUploadPath(name, type), file, {
            access: "private",
            handleUploadUrl: "/api/esign/documents/upload",
            contentType: type,
            multipart: file.size > MULTIPART_THRESHOLD_BYTES,
            onUploadProgress: ({ percentage }) => {
              // The SDK throttles progress events, so one can land after the
              // upload settled; it must not overwrite the final state.
              if (!settled) patchUpload(key, { progress: Math.round(percentage) });
            },
          });
          settled = true;
          await api("/api/esign/documents", "POST", { pathname: blob.pathname, name, folderId: folder.id });
          filed.current.add(sameDocumentKey(name, file.size));
          retryQueue.current.delete(key);
          patchUpload(key, { status: "done", progress: 100 });
        } catch (e) {
          settled = true;
          retryQueue.current.set(key, next);
          patchUpload(key, { status: "error", note: e instanceof Error ? e.message : "Upload failed", retryable: true });
        }
      }
    };
    await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker));
    setBusy(false);
    router.refresh();
  }

  async function runUploads(files: File[]) {
    if (!files.length) return;
    if (!storageReady) {
      setError("File storage is not set up yet (BLOB_READ_WRITE_TOKEN is missing).");
      return;
    }
    setError(null);

    const stamp = Date.now();
    const seen = new Set<string>();
    const items: UploadItem[] = [];
    const queue: Ready[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const key = `${stamp}-${i}`;
      const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      const type = agreementDocTypeOf(file, head);
      const name = (type && agreementDocName(file.name, type)) || file.name;
      const base = { key, name, size: file.size, progress: 0 };
      const dupKey = sameDocumentKey(name, file.size);
      if (!type) {
        items.push({ ...base, status: "error", note: "Only PDF, JPG or PNG files" });
      } else if (file.size > MAX_AGREEMENT_DOC_BYTES) {
        items.push({ ...base, status: "error", note: "Larger than 50 MB" });
      } else if (filed.current.has(dupKey) || seen.has(dupKey)) {
        items.push({ ...base, status: "skipped", note: "Already in this folder" });
      } else {
        seen.add(dupKey);
        items.push({ ...base, status: "queued" });
        queue.push({ key, file, type, name });
      }
    }
    setUploads((list) => [...items, ...list.filter((u) => u.status === "error" && u.retryable)]);
    if (queue.length) await send(queue);
  }

  function retryFailed() {
    const queue = uploads
      .filter((u) => u.status === "error" && u.retryable)
      .map((u) => retryQueue.current.get(u.key))
      .filter((r): r is Ready => !!r);
    for (const r of queue) patchUpload(r.key, { status: "queued", progress: 0, note: undefined, retryable: false });
    if (queue.length) void send(queue);
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    const entries = Array.from(e.dataTransfer.items)
      .map((it) => (it.kind === "file" ? it.webkitGetAsEntry?.() : null))
      .filter((x): x is FileSystemEntry => !!x);
    const files: File[] = [];
    if (entries.length) {
      for (const entry of entries) await collectEntry(entry, files);
    } else {
      for (const file of Array.from(e.dataTransfer.files)) if (!isIgnored(file.name)) files.push(file);
    }
    void runUploads(files);
  }

  function onPick(list: FileList | null) {
    if (!list) return;
    void runUploads(Array.from(list).filter((f) => !isIgnored(f.name)));
  }

  const done = uploads.filter((u) => u.status === "done").length;
  const skipped = uploads.filter((u) => u.status === "skipped").length;
  const failed = uploads.filter((u) => u.status === "error");
  const retryable = failed.filter((u) => u.retryable).length;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <nav className="flex flex-wrap items-center gap-xs text-body-md min-w-0" aria-label="Breadcrumb">
          <Link href="/operations/agreements" className="text-primary hover:underline font-semibold">
            Agreements
          </Link>
          <Icon name="chevron_right" className="text-on-surface-variant" />
          <Link href={AGREEMENT_FOLDERS_PAGE} className="text-primary hover:underline font-semibold">
            Folders
          </Link>
          <Icon name="chevron_right" className="text-on-surface-variant" />
          <span className="font-semibold truncate">{folder.name}</span>
        </nav>
        <div className="flex flex-wrap items-center gap-sm">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this folder"
            aria-label="Search this folder"
            className={`${inputCls} w-56`}
          />
          <button type="button" className={secondaryBtn} disabled={busy} onClick={() => folderInput.current?.click()}>
            <Icon name="drive_folder_upload" /> Upload folder
          </button>
          <button type="button" className={primaryBtn} disabled={busy} onClick={() => filesInput.current?.click()}>
            <Icon name="upload_file" /> Upload files
          </button>
          <input
            ref={filesInput}
            type="file"
            multiple
            hidden
            accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
            onChange={(e) => {
              onPick(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={folderInput}
            type="file"
            multiple
            hidden
            // Not in React's typings, but every current browser supports it.
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            onChange={(e) => {
              onPick(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {!storageReady && (
        <p className="rounded-lg border border-error/40 bg-error/5 px-md py-sm text-body-md text-error">
          File storage is not configured on this deployment, so uploads and downloads will not work yet.
        </p>
      )}
      {error && <p className="rounded-lg border border-error/40 bg-error/5 px-md py-sm text-body-md text-error">{error}</p>}

      {uploads.length > 0 && (
        <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-md space-y-sm">
          <div className="flex flex-wrap items-center justify-between gap-sm">
            <p className="text-body-md font-semibold">
              {busy ? "Uploading… keep this page open. " : ""}
              {done} of {uploads.length - skipped} uploaded
              {skipped ? ` · ${skipped} already here` : ""}
              {failed.length ? ` · ${failed.length} failed` : ""}
            </p>
            {!busy && (
              <div className="flex items-center gap-md">
                {retryable > 0 && (
                  <button type="button" className="text-body-md text-primary font-semibold hover:underline" onClick={retryFailed}>
                    Retry {retryable} failed
                  </button>
                )}
                <button type="button" className="text-body-md text-primary hover:underline" onClick={() => setUploads([])}>
                  Clear
                </button>
              </div>
            )}
          </div>
          <ul className="max-h-64 overflow-y-auto divide-y divide-outline-variant">
            {uploads.map((u) => (
              <li key={u.key} className="py-xs flex items-center gap-sm text-body-md">
                <Icon
                  name={
                    u.status === "done"
                      ? "check_circle"
                      : u.status === "error"
                        ? "error"
                        : u.status === "skipped"
                          ? "do_not_disturb_on"
                          : "progress_activity"
                  }
                  className={
                    u.status === "done" ? "text-green-700" : u.status === "error" ? "text-error" : "text-on-surface-variant"
                  }
                />
                <span className="flex-1 min-w-0 truncate" title={u.name}>
                  {u.name}
                </span>
                <span className="text-caption text-on-surface-variant whitespace-nowrap">
                  {u.note ?? (u.status === "uploading" ? `${u.progress}%` : formatBytes(u.size))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Listing, also the drop zone */}
      <section
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
        }}
        onDrop={onDrop}
        className={`rounded-xl border bg-surface-container-lowest overflow-hidden transition ${
          dragOver ? "border-primary ring-2 ring-primary/30" : "border-outline-variant"
        }`}
      >
        {documents.length === 0 ? (
          <div className="py-xl px-md text-center space-y-sm">
            <Icon name="folder_open" size={40} className="text-on-surface-variant" />
            <p className="text-body-lg font-semibold">This folder is empty</p>
            <p className="text-body-md text-on-surface-variant">
              Drag PDFs, or a whole folder of them, here, or use the buttons above. Files inside sub-folders are filed
              here too.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body-md">
              <thead className="bg-surface-container-low text-left text-on-surface-variant">
                <tr>
                  <th className="px-md py-sm text-label-sm uppercase tracking-wider">Name</th>
                  <th className="px-md py-sm text-label-sm uppercase tracking-wider hidden md:table-cell">Size</th>
                  <th className="px-md py-sm text-label-sm uppercase tracking-wider hidden md:table-cell">Added</th>
                  <th className="px-md py-sm text-label-sm uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => (
                  <tr key={d.id} className="border-t border-outline-variant hover:bg-surface-container/50">
                    <td className="px-md py-sm">
                      <a
                        href={`/api/esign/documents/${d.id}/file?inline=1`}
                        target="_blank"
                        rel="noopener"
                        className="flex items-center gap-sm hover:underline"
                        title="Open"
                      >
                        <Icon
                          name={d.contentType === "application/pdf" ? "picture_as_pdf" : "image"}
                          size={20}
                          className="text-on-surface-variant"
                        />
                        <span className="break-all">{d.name}</span>
                      </a>
                      <span className="md:hidden text-caption text-on-surface-variant pl-[28px]">
                        {formatBytes(d.size)} · {formatDate(d.createdAt)}
                      </span>
                    </td>
                    <td className="px-md py-sm text-on-surface-variant hidden md:table-cell whitespace-nowrap">
                      {formatBytes(d.size)}
                    </td>
                    <td className="px-md py-sm text-on-surface-variant hidden md:table-cell whitespace-nowrap">
                      {formatDate(d.createdAt)}
                      {d.uploadedBy ? ` · ${d.uploadedBy}` : ""}
                    </td>
                    <td className="px-md py-sm">
                      <div className="flex items-center justify-end gap-xs">
                        <RowButton icon="download" label="Download" href={`/api/esign/documents/${d.id}/file`} />
                        <RowButton icon="edit" label="Rename" onClick={() => setRenaming(d)} />
                        {isAdmin && <RowButton icon="delete" label="Delete" danger onClick={() => setDeleting(d)} />}
                      </div>
                    </td>
                  </tr>
                ))}
                {q && !shown.length && (
                  <tr>
                    <td colSpan={4} className="px-md py-lg text-center text-on-surface-variant">
                      Nothing in this folder matches “{query.trim()}”.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {renaming && (
        <NameDialog
          title="Rename document"
          initial={renaming.name}
          submitLabel="Rename"
          hint="Leave the extension off and the current one is kept."
          onClose={() => setRenaming(null)}
          onSubmit={async (name) => {
            await api(`/api/esign/documents/${renaming.id}`, "PATCH", { name });
            setRenaming(null);
            router.refresh();
          }}
        />
      )}
      {deleting && (
        <DeleteDialog
          title="Delete document?"
          name={deleting.name}
          message="The signed file is removed permanently. This cannot be undone."
          url={`/api/esign/documents/${deleting.id}`}
          onClose={() => setDeleting(null)}
          onDone={() => {
            setDeleting(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
