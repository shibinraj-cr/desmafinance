/**
 * Finance Documents — the pure rules behind /finance/documents.
 *
 * Everything here is free of I/O so it can be tested on its own; the Blob and
 * database calls live in finance-docs-store.ts and the API routes.
 *
 * Two decisions worth knowing before changing anything:
 *
 * 1. **Files never leave through a storage URL.** The Blob store is private.
 *    A signed-in user downloads through /api/finance/documents/[id]/file (page
 *    grant checked), an outsider through /api/share/finance/[token]/[docId]
 *    (share checked). Both routes resolve the document from the database, so a
 *    caller can never name an arbitrary blob.
 *
 * 2. **A share link is a period, not just an expiry.** It opens at the start of
 *    its first IST day and closes at the end of its last, so "valid 1–15 Oct"
 *    means what an accountant reading it would assume.
 */

export const FINANCE_DOCS_PAGE = "/finance/documents";

/** Every uploaded file lives under this prefix in the Blob store. */
export const FINANCE_DOCS_BLOB_PREFIX = "finance-docs/";

/** Bank statements and audit packs run large; 100 MB covers them with room. */
export const MAX_FINANCE_DOC_BYTES = 100 * 1024 * 1024;

/** Above this, files go up in parts (the SDK splits and retries them). */
export const MULTIPART_THRESHOLD_BYTES = 20 * 1024 * 1024;

/**
 * Files at or below this size are streamed through our own route, which lets
 * us set the download filename from the (renamable) display name. Larger ones
 * are handed a short-lived presigned storage URL instead, because a Vercel
 * function response is capped at 4.5 MB.
 */
export const STREAM_LIMIT_BYTES = 4 * 1024 * 1024;

export const MAX_NAME_LENGTH = 200;

/** The longest a share link may stay open, counted from its first day. */
export const MAX_SHARE_DAYS = 366;

/**
 * Tidy a user-typed folder or document name. Returns null when nothing usable
 * is left. Slashes are swapped out because a name containing one would read as
 * a path in breadcrumbs and in a downloaded filename.
 */
export function cleanName(raw: string): string | null {
  const name = raw
    // Whitespace first, so a tab or newline becomes a space before the
    // control-character strip would delete it outright.
    .replace(/\s+/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "-")
    .trim();
  if (!name || name === "." || name === "..") return null;
  return name.slice(0, MAX_NAME_LENGTH);
}

/** The extension including its dot ("Invoice.PDF" → ".PDF"), or "". */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  const ext = name.slice(dot);
  return /^\.[A-Za-z0-9]{1,8}$/.test(ext) ? ext : "";
}

/**
 * A rename that drops the extension keeps the old one: "GST return" for a file
 * that was "gstr3b.pdf" becomes "GST return.pdf", so the download still opens
 * in the right app. A rename that gives a new extension is taken as meant.
 */
export function renamedDocumentName(raw: string, previous: string): string | null {
  const name = cleanName(raw);
  if (!name) return null;
  if (extensionOf(name)) return name;
  const ext = extensionOf(previous);
  return ext ? (name + ext).slice(0, MAX_NAME_LENGTH + ext.length) : name;
}

/** Lower-case, plain-character version of a filename for use in a blob key. */
export function safeBlobFileName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned.slice(-80) || "document";
}

/**
 * Whether a pathname a browser asks to upload to is one we will issue a token
 * for: under our prefix, one level deep, no dot segments.
 */
export function isFinanceDocUploadPath(pathname: string): boolean {
  if (!pathname.startsWith(FINANCE_DOCS_BLOB_PREFIX)) return false;
  const rest = pathname.slice(FINANCE_DOCS_BLOB_PREFIX.length);
  return /^[a-z0-9][a-z0-9._-]*$/.test(rest) && !rest.includes("..");
}

/** A `Content-Disposition` value that survives non-ASCII names. */
export function contentDisposition(kind: "inline" | "attachment", filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Folder tree ────────────────────────────────────────────────────────────

export type FolderNode = { id: string; name: string; parentId: string | null };

/** The folder and every folder beneath it. Safe on a malformed (cyclic) tree. */
export function descendantFolderIds(folders: FolderNode[], rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const f of folders) {
    if (!f.parentId) continue;
    const list = children.get(f.parentId) ?? [];
    list.push(f.id);
    children.set(f.parentId, list);
  }
  const out = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const child of children.get(id) ?? []) {
      if (out.has(child)) continue;
      out.add(child);
      queue.push(child);
    }
  }
  return out;
}

/**
 * Top-down chain of folders ending at `id` — the breadcrumb. When `stopAt` is
 * given the chain starts just below it, which is how a shared folder shows its
 * subfolders without revealing what it sits inside.
 */
export function folderChain(folders: FolderNode[], id: string | null, stopAt?: string): FolderNode[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: FolderNode[] = [];
  const seen = new Set<string>();
  let cur = id ? byId.get(id) : undefined;
  while (cur && !seen.has(cur.id) && cur.id !== stopAt) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return chain;
}

// ─── Share links ────────────────────────────────────────────────────────────

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" for the IST calendar day containing `d`. */
export function istDateKey(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function parseDateKey(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  // Reject roll-overs such as 2026-02-31.
  return new Date(utc).toISOString().slice(0, 10) === key ? utc : null;
}

/**
 * Turn the dates picked in the share dialog into the instant the link opens and
 * the instant it closes. Returns the reason instead when the period is unusable.
 */
export function sharePeriod(
  fromKey: string,
  untilKey: string,
  now: Date,
): { validFrom: Date; expiresAt: Date } | { error: string } {
  const from = parseDateKey(fromKey);
  const until = parseDateKey(untilKey);
  if (from === null || until === null) return { error: "Pick valid dates" };
  if (until < from) return { error: "The link must end on or after the day it starts" };
  if ((until - from) / DAY_MS + 1 > MAX_SHARE_DAYS) {
    return { error: `A link can stay open for at most ${MAX_SHARE_DAYS} days` };
  }
  if (fromKey < istDateKey(now)) return { error: "The link cannot start in the past" };

  const validFrom = new Date(from - IST_OFFSET_MS);
  const expiresAt = new Date(until + DAY_MS - IST_OFFSET_MS - 1);
  // A link starting today opens now rather than at midnight already passed.
  return { validFrom: validFrom < now ? now : validFrom, expiresAt };
}

export type ShareState = "scheduled" | "active" | "expired" | "revoked";

export function shareState(
  share: { validFrom: Date; expiresAt: Date; revokedAt: Date | null },
  now: Date,
): ShareState {
  if (share.revokedAt) return "revoked";
  if (now >= share.expiresAt) return "expired";
  if (now < share.validFrom) return "scheduled";
  return "active";
}

export const SHARE_STATE_LABEL: Record<ShareState, string> = {
  scheduled: "Not open yet",
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
};

/** A link-safe random credential (32 bytes, base64url). */
export function newShareToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export function sharePath(token: string): string {
  return `/share/finance/${token}`;
}

/** The format the share UI and public page show dates in: "3 Oct 2026". */
export function formatIstDate(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}
