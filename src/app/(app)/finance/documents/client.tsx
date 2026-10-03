"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import {
  FINANCE_DOCS_BLOB_PREFIX,
  FINANCE_DOCS_PAGE,
  MAX_FINANCE_DOC_BYTES,
  MULTIPART_THRESHOLD_BYTES,
  formatBytes,
  istDateKey,
  safeBlobFileName,
} from "@/lib/finance-docs";
import { api, CopyButton, inputCls, Modal, primaryBtn, secondaryBtn } from "./_ui";

type FolderRow = { id: string; name: string; updatedAt: string; items: number };
type DocRow = {
  id: string;
  name: string;
  size: number;
  contentType: string;
  createdAt: string;
  uploadedBy: string | null;
};

type Target = { kind: "folder"; row: FolderRow } | { kind: "document"; row: DocRow };

/** A file waiting to go up, with the folders it sits in relative to here. */
type Pending = { file: File; dirs: string[] };

type UploadItem = {
  key: string;
  name: string;
  size: number;
  progress: number;
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
};

/** OS clutter that comes along when a whole folder is dropped. */
const IGNORED_FILES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);
const isIgnored = (name: string) => IGNORED_FILES.has(name.toLowerCase()) || name.startsWith("~$");

const UPLOAD_CONCURRENCY = 3;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function docIcon(contentType: string, name: string): string {
  const n = name.toLowerCase();
  if (contentType === "application/pdf" || n.endsWith(".pdf")) return "picture_as_pdf";
  if (contentType.startsWith("image/")) return "image";
  if (/\.(xlsx?|csv|ods)$/.test(n) || contentType.includes("spreadsheet")) return "table_chart";
  if (/\.(docx?|odt|rtf)$/.test(n) || contentType.includes("word")) return "description";
  if (/\.(zip|rar|7z)$/.test(n)) return "folder_zip";
  return "draft";
}

/** Walk a dropped folder (Chrome/Edge/Safari/Firefox all expose entries). */
async function collectEntry(entry: FileSystemEntry, dirs: string[], out: Pending[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    if (!isIgnored(file.name)) out.push({ file, dirs });
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns results in batches; keep reading until it is empty.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) await collectEntry(child, [...dirs, entry.name], out);
    }
  }
}

export function DocumentsBrowser({
  folderId,
  chain,
  folders,
  documents,
  storageReady,
}: {
  folderId: string | null;
  chain: { id: string; name: string }[];
  folders: FolderRow[];
  documents: DocRow[];
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

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [renaming, setRenaming] = useState<Target | null>(null);
  const [deleting, setDeleting] = useState<Target | null>(null);
  const [sharing, setSharing] = useState<Target | null>(null);

  const q = query.trim().toLowerCase();
  const shownFolders = q ? folders.filter((f) => f.name.toLowerCase().includes(q)) : folders;
  const shownDocs = q ? documents.filter((d) => d.name.toLowerCase().includes(q)) : documents;

  const folderHref = (id: string | null) => (id ? `${FINANCE_DOCS_PAGE}?folder=${id}` : FINANCE_DOCS_PAGE);

  const patchUpload = (key: string, patch: Partial<UploadItem>) =>
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...patch } : u)));

  async function runUploads(pending: Pending[]) {
    if (!pending.length) return;
    if (!storageReady) {
      setError("File storage is not set up yet (BLOB_READ_WRITE_TOKEN is missing).");
      return;
    }
    setError(null);
    setBusy(true);

    const stamp = Date.now();
    const items: UploadItem[] = pending.map((p, i) => ({
      key: `${stamp}-${i}`,
      name: [...p.dirs, p.file.name].join(" / "),
      size: p.file.size,
      progress: 0,
      status: p.file.size > MAX_FINANCE_DOC_BYTES ? "error" : "queued",
      error: p.file.size > MAX_FINANCE_DOC_BYTES ? "Larger than 100 MB" : undefined,
    }));
    setUploads((list) => [...items, ...list.filter((u) => u.status !== "done")]);

    // One promise per folder path, so ten files in "Bank/HDFC" create the
    // folder once even though they upload in parallel.
    const folderIds = new Map<string, Promise<string | null>>();
    const ensureFolder = (dirs: string[]): Promise<string | null> => {
      if (!dirs.length) return Promise.resolve(folderId);
      const key = dirs.join("/");
      let p = folderIds.get(key);
      if (!p) {
        p = ensureFolder(dirs.slice(0, -1)).then(async (parentId) => {
          const { folder } = await api<{ folder: { id: string } }>("/api/finance/documents/folders", "POST", {
            name: dirs[dirs.length - 1],
            parentId,
            reuse: true,
          });
          return folder.id;
        });
        folderIds.set(key, p);
      }
      return p;
    };

    const queue = pending.map((p, i) => ({ ...p, item: items[i] })).filter((p) => p.item.status === "queued");
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const { file, dirs, item } = next;
        patchUpload(item.key, { status: "uploading" });
        try {
          const targetFolder = await ensureFolder(dirs);
          const blob = await upload(`${FINANCE_DOCS_BLOB_PREFIX}${safeBlobFileName(file.name)}`, file, {
            access: "private",
            handleUploadUrl: "/api/finance/documents/upload",
            contentType: file.type || undefined,
            multipart: file.size > MULTIPART_THRESHOLD_BYTES,
            onUploadProgress: ({ percentage }) => patchUpload(item.key, { progress: Math.round(percentage) }),
          });
          await api("/api/finance/documents", "POST", {
            pathname: blob.pathname,
            name: file.name,
            folderId: targetFolder,
          });
          patchUpload(item.key, { status: "done", progress: 100 });
        } catch (e) {
          patchUpload(item.key, { status: "error", error: e instanceof Error ? e.message : "Upload failed" });
        }
      }
    };
    await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker));

    setBusy(false);
    router.refresh();
  }

  function onPickFiles(list: FileList | null, withPaths: boolean) {
    if (!list) return;
    const pending: Pending[] = [];
    for (const file of Array.from(list)) {
      if (isIgnored(file.name)) continue;
      // A folder pick reports "Top/Sub/file.pdf"; keep the folders, drop the file.
      const rel = withPaths ? (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "" : "";
      const dirs = rel ? rel.split("/").slice(0, -1).filter(Boolean) : [];
      pending.push({ file, dirs });
    }
    void runUploads(pending);
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    const entries = Array.from(e.dataTransfer.items)
      .map((it) => (it.kind === "file" ? it.webkitGetAsEntry?.() : null))
      .filter((x): x is FileSystemEntry => !!x);
    const pending: Pending[] = [];
    if (entries.length) {
      for (const entry of entries) await collectEntry(entry, [], pending);
    } else {
      for (const file of Array.from(e.dataTransfer.files)) if (!isIgnored(file.name)) pending.push({ file, dirs: [] });
    }
    void runUploads(pending);
  }

  const doneCount = uploads.filter((u) => u.status === "done").length;
  const failed = uploads.filter((u) => u.status === "error");
  const empty = folders.length === 0 && documents.length === 0;

  return (
    <>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <nav className="flex flex-wrap items-center gap-xs text-body-md min-w-0" aria-label="Folder path">
          <Link href={folderHref(null)} className="text-primary hover:underline font-semibold">
            All documents
          </Link>
          {chain.map((f, i) => (
            <span key={f.id} className="flex items-center gap-xs min-w-0">
              <span className="material-symbols-outlined text-[18px] text-on-surface-variant">chevron_right</span>
              {i === chain.length - 1 ? (
                <span className="font-semibold truncate">{f.name}</span>
              ) : (
                <Link href={folderHref(f.id)} className="text-primary hover:underline truncate">
                  {f.name}
                </Link>
              )}
            </span>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-sm">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this folder"
            className={`${inputCls} w-48`}
          />
          <button type="button" className={secondaryBtn} onClick={() => setNewFolderOpen(true)}>
            <span className="material-symbols-outlined text-[18px]">create_new_folder</span>
            New folder
          </button>
          <button type="button" className={secondaryBtn} disabled={busy} onClick={() => folderInput.current?.click()}>
            <span className="material-symbols-outlined text-[18px]">drive_folder_upload</span>
            Upload folder
          </button>
          <button type="button" className={primaryBtn} disabled={busy} onClick={() => filesInput.current?.click()}>
            <span className="material-symbols-outlined text-[18px]">upload_file</span>
            Upload files
          </button>
          <input
            ref={filesInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              onPickFiles(e.target.files, false);
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
              onPickFiles(e.target.files, true);
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
      {error && (
        <p className="rounded-lg border border-error/40 bg-error/5 px-md py-sm text-body-md text-error">{error}</p>
      )}

      {/* Upload progress */}
      {uploads.length > 0 && (
        <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-md space-y-sm">
          <div className="flex items-center justify-between gap-sm">
            <p className="text-body-md font-semibold">
              {busy ? "Uploading…" : "Uploads"} {doneCount} of {uploads.length} done
              {failed.length ? ` · ${failed.length} failed` : ""}
            </p>
            {!busy && (
              <button type="button" className="text-body-md text-primary hover:underline" onClick={() => setUploads([])}>
                Clear
              </button>
            )}
          </div>
          <ul className="max-h-56 overflow-y-auto divide-y divide-outline-variant">
            {uploads.map((u) => (
              <li key={u.key} className="py-xs flex items-center gap-sm text-body-md">
                <span
                  className={`material-symbols-outlined text-[18px] ${
                    u.status === "done" ? "text-green-700" : u.status === "error" ? "text-error" : "text-on-surface-variant"
                  }`}
                >
                  {u.status === "done" ? "check_circle" : u.status === "error" ? "error" : "progress_activity"}
                </span>
                <span className="flex-1 min-w-0 truncate" title={u.name}>
                  {u.name}
                </span>
                <span className="text-caption text-on-surface-variant whitespace-nowrap">
                  {u.status === "error" ? u.error : u.status === "uploading" ? `${u.progress}%` : formatBytes(u.size)}
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
        {empty ? (
          <div className="py-xl px-md text-center space-y-sm">
            <span className="material-symbols-outlined text-[40px] text-on-surface-variant">folder_open</span>
            <p className="text-body-lg font-semibold">This folder is empty</p>
            <p className="text-body-md text-on-surface-variant">
              Drag files or a whole folder here, or use the buttons above.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body-md">
              <thead className="bg-surface-container text-on-surface-variant text-caption uppercase tracking-wide">
                <tr>
                  <th className="text-left font-semibold px-md py-sm">Name</th>
                  <th className="text-left font-semibold px-md py-sm hidden md:table-cell">Size</th>
                  <th className="text-left font-semibold px-md py-sm hidden md:table-cell">Added</th>
                  <th className="text-right font-semibold px-md py-sm">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {shownFolders.map((f) => (
                  <tr key={f.id} className="hover:bg-surface-container/50">
                    <td className="px-md py-sm">
                      <Link href={folderHref(f.id)} className="flex items-center gap-sm font-semibold hover:underline">
                        <span className="material-symbols-outlined text-[20px] text-primary">folder</span>
                        <span className="break-all">{f.name}</span>
                      </Link>
                    </td>
                    <td className="px-md py-sm text-on-surface-variant hidden md:table-cell">
                      {f.items} {f.items === 1 ? "item" : "items"}
                    </td>
                    <td className="px-md py-sm text-on-surface-variant hidden md:table-cell">{formatDate(f.updatedAt)}</td>
                    <td className="px-md py-sm">
                      <RowActions
                        onShare={() => setSharing({ kind: "folder", row: f })}
                        onRename={() => setRenaming({ kind: "folder", row: f })}
                        onDelete={() => setDeleting({ kind: "folder", row: f })}
                      />
                    </td>
                  </tr>
                ))}
                {shownDocs.map((d) => (
                  <tr key={d.id} className="hover:bg-surface-container/50">
                    <td className="px-md py-sm">
                      <a
                        href={`/api/finance/documents/${d.id}/file?inline=1`}
                        target="_blank"
                        rel="noopener"
                        className="flex items-center gap-sm hover:underline"
                        title="Open"
                      >
                        <span className="material-symbols-outlined text-[20px] text-on-surface-variant">
                          {docIcon(d.contentType, d.name)}
                        </span>
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
                      <RowActions
                        downloadHref={`/api/finance/documents/${d.id}/file`}
                        onShare={() => setSharing({ kind: "document", row: d })}
                        onRename={() => setRenaming({ kind: "document", row: d })}
                        onDelete={() => setDeleting({ kind: "document", row: d })}
                      />
                    </td>
                  </tr>
                ))}
                {q && !shownFolders.length && !shownDocs.length && (
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

      {newFolderOpen && (
        <NameDialog
          title="New folder"
          initial=""
          submitLabel="Create"
          onClose={() => setNewFolderOpen(false)}
          onSubmit={async (name) => {
            await api("/api/finance/documents/folders", "POST", { name, parentId: folderId });
            setNewFolderOpen(false);
            router.refresh();
          }}
        />
      )}
      {renaming && (
        <NameDialog
          title={renaming.kind === "folder" ? "Rename folder" : "Rename document"}
          initial={renaming.row.name}
          submitLabel="Rename"
          hint={
            renaming.kind === "document"
              ? "Leave the extension off and the current one is kept."
              : undefined
          }
          onClose={() => setRenaming(null)}
          onSubmit={async (name) => {
            const url =
              renaming.kind === "folder"
                ? `/api/finance/documents/folders/${renaming.row.id}`
                : `/api/finance/documents/${renaming.row.id}`;
            await api(url, "PATCH", { name });
            setRenaming(null);
            router.refresh();
          }}
        />
      )}
      {deleting && (
        <DeleteDialog
          target={deleting}
          onClose={() => setDeleting(null)}
          onDone={() => {
            setDeleting(null);
            router.refresh();
          }}
        />
      )}
      {sharing && <ShareDialog target={sharing} onClose={() => setSharing(null)} />}
    </>
  );
}

function RowActions({
  downloadHref,
  onShare,
  onRename,
  onDelete,
}: {
  downloadHref?: string;
  onShare: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const btn = "p-xs rounded-md hover:bg-surface-container text-on-surface-variant hover:text-on-surface";
  return (
    <div className="flex items-center justify-end gap-xs">
      {downloadHref && (
        <a href={downloadHref} className={btn} title="Download" aria-label="Download">
          <span className="material-symbols-outlined text-[20px]">download</span>
        </a>
      )}
      <button type="button" className={btn} onClick={onShare} title="Share link" aria-label="Share link">
        <span className="material-symbols-outlined text-[20px]">share</span>
      </button>
      <button type="button" className={btn} onClick={onRename} title="Rename" aria-label="Rename">
        <span className="material-symbols-outlined text-[20px]">edit</span>
      </button>
      <button type="button" className={`${btn} hover:text-error`} onClick={onDelete} title="Delete" aria-label="Delete">
        <span className="material-symbols-outlined text-[20px]">delete</span>
      </button>
    </div>
  );
}

function NameDialog({
  title,
  initial,
  submitLabel,
  hint,
  onClose,
  onSubmit,
}: {
  title: string;
  initial: string;
  submitLabel: string;
  hint?: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="space-y-md"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setSaving(true);
          setError(null);
          try {
            await onSubmit(name);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not save");
            setSaving(false);
          }
        }}
      >
        <div className="space-y-xs">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => {
              // Select the name without its extension, like a file manager does.
              const dot = e.target.value.lastIndexOf(".");
              e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
            }}
            maxLength={200}
            className={inputCls}
          />
          {hint && <p className="text-caption text-on-surface-variant">{hint}</p>}
          {error && <p className="text-caption text-error">{error}</p>}
        </div>
        <div className="flex justify-end gap-sm">
          <button type="button" className="px-md py-sm text-on-surface-variant hover:underline" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={primaryBtn} disabled={saving || !name.trim()}>
            {saving ? "Saving…" : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteDialog({ target, onClose, onDone }: { target: Target; onClose: () => void; onDone: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFolder = target.kind === "folder";
  const blocked = isFolder && (target.row as FolderRow).items > 0;

  return (
    <Modal
      title={isFolder ? "Delete folder?" : "Delete document?"}
      subtitle={target.row.name}
      onClose={onClose}
    >
      <p className="text-body-md text-on-surface-variant">
        {blocked
          ? "This folder still has things in it. Only an empty folder can be deleted, so nothing gets removed by accident."
          : isFolder
            ? "The folder and any share links to it will be removed."
            : "The file is removed permanently, and any share link to it stops working. This cannot be undone."}
      </p>
      {error && <p className="text-caption text-error">{error}</p>}
      <div className="flex justify-end gap-sm">
        <button type="button" className="px-md py-sm text-on-surface-variant hover:underline" onClick={onClose}>
          {blocked ? "Close" : "Cancel"}
        </button>
        {!blocked && (
          <button
            type="button"
            disabled={saving}
            className="inline-flex items-center px-md py-sm bg-error text-white rounded-md text-body-md font-semibold hover:opacity-90 disabled:opacity-50"
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                const url = isFolder
                  ? `/api/finance/documents/folders/${target.row.id}`
                  : `/api/finance/documents/${target.row.id}`;
                await api(url, "DELETE");
                onDone();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not delete");
                setSaving(false);
              }
            }}
          >
            {saving ? "Deleting…" : "Delete"}
          </button>
        )}
      </div>
    </Modal>
  );
}

const PRESETS = [
  { days: 1, label: "Today only" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

function addDays(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function ShareDialog({ target, onClose }: { target: Target; onClose: () => void }) {
  const today = istDateKey(new Date());
  const [label, setLabel] = useState("");
  const [from, setFrom] = useState(today);
  const [until, setUntil] = useState(addDays(today, 6));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const isFolder = target.kind === "folder";

  if (link) {
    return (
      <Modal title="Link ready" subtitle={target.row.name} onClose={onClose}>
        <p className="text-body-md text-on-surface-variant">
          Anyone with this link can download {isFolder ? "everything in this folder, including its subfolders" : "this document"}{" "}
          from {from === today ? "now" : from} until the end of {until} (IST). They cannot change or delete anything.
        </p>
        <input readOnly value={link} className={inputCls} onFocus={(e) => e.target.select()} />
        <div className="flex justify-end gap-sm">
          <Link href={`${FINANCE_DOCS_PAGE}/shares`} className="px-md py-sm text-primary hover:underline">
            All shared links
          </Link>
          <CopyButton text={link} />
          <button type="button" className={primaryBtn} onClick={onClose}>
            Done
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={isFolder ? "Share folder" : "Share document"}
      subtitle={target.row.name}
      onClose={onClose}
    >
      <form
        className="space-y-md"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError(null);
          try {
            const { share } = await api<{ share: { path: string } }>("/api/finance/documents/shares", "POST", {
              ...(isFolder ? { folderId: target.row.id } : { documentId: target.row.id }),
              label: label.trim() || undefined,
              from,
              until,
            });
            setLink(`${window.location.origin}${share.path}`);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not create the link");
          } finally {
            setSaving(false);
          }
        }}
      >
        <label className="block space-y-xs">
          <span className="text-body-md font-semibold">Shared with (optional)</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Auditor, FY 2025-26"
            maxLength={200}
            className={inputCls}
          />
        </label>
        <div className="space-y-xs">
          <span className="text-body-md font-semibold">Link works</span>
          <div className="flex flex-wrap gap-xs">
            {PRESETS.map((p) => {
              const active = from === today && until === addDays(today, p.days - 1);
              return (
                <button
                  key={p.days}
                  type="button"
                  onClick={() => {
                    setFrom(today);
                    setUntil(addDays(today, p.days - 1));
                  }}
                  className={`px-sm py-xs rounded-full border text-caption font-semibold ${
                    active ? "border-primary bg-primary/10 text-primary" : "border-outline-variant hover:bg-surface-container"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-sm">
            <label className="space-y-xs">
              <span className="text-caption text-on-surface-variant">From</span>
              <input
                type="date"
                value={from}
                min={today}
                onChange={(e) => setFrom(e.target.value)}
                className={inputCls}
                required
              />
            </label>
            <label className="space-y-xs">
              <span className="text-caption text-on-surface-variant">Until (end of day)</span>
              <input
                type="date"
                value={until}
                min={from}
                onChange={(e) => setUntil(e.target.value)}
                className={inputCls}
                required
              />
            </label>
          </div>
          <p className="text-caption text-on-surface-variant">
            Download only. You can revoke the link at any time from Shared links.
          </p>
        </div>
        {error && <p className="text-caption text-error">{error}</p>}
        <div className="flex justify-end gap-sm">
          <button type="button" className="px-md py-sm text-on-surface-variant hover:underline" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={primaryBtn} disabled={saving}>
            {saving ? "Creating…" : "Create link"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
