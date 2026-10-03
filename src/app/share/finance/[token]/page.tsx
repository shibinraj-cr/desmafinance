import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { folderChain, formatBytes, formatIstDate } from "@/lib/finance-docs";
import { resolveShare, sharedFolderContents } from "@/lib/finance-docs-store";

export const dynamic = "force-dynamic";

// Financial papers behind a bearer link: never indexed, never previewed.
export const metadata: Metadata = {
  title: "Shared documents — DESMA International",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

type FileRow = { id: string; name: string; size: number };

/**
 * PUBLIC page behind a finance share link (outside the login wall — see
 * middleware). Lists what the link reaches with a download button each, and
 * nothing else: no names of enclosing folders, no uploaders, no actions.
 */
export default async function SharedDocumentsPage({ params }: { params: { token: string } }) {
  const now = new Date();
  const resolved = await resolveShare(params.token, now);

  if (!resolved) {
    return (
      <Shell title="This link is not valid">
        <p>It may have been mistyped. Ask the person who sent it to share it again.</p>
      </Shell>
    );
  }

  const { share, state } = resolved;
  if (state === "revoked") {
    return (
      <Shell title="This link has been switched off">
        <p>The sender has withdrawn access. Ask them for a new link if you still need the documents.</p>
      </Shell>
    );
  }
  if (state === "expired") {
    return (
      <Shell title="This link has expired">
        <p>It was available until {formatIstDate(share.expiresAt)}. Ask the sender for a new link if you still need the documents.</p>
      </Shell>
    );
  }
  if (state === "scheduled") {
    return (
      <Shell title="This link is not open yet">
        <p>The documents will be available from {formatIstDate(share.validFrom)}.</p>
      </Shell>
    );
  }

  await prisma.financeDocShare.update({ where: { id: share.id }, data: { lastAccessedAt: now } });

  const href = (docId: string) => `/api/share/finance/${params.token}/${docId}`;
  const until = `Available until ${formatIstDate(share.expiresAt)}`;

  if (share.document) {
    const d = share.document;
    return (
      <Shell title={share.label || d.name} meta={until}>
        <FileList files={[{ id: d.id, name: d.name, size: d.size }]} href={href} />
      </Shell>
    );
  }

  const root = share.folder!;
  const { folders, documents } = await sharedFolderContents(root.id);

  // Group by subfolder path relative to the shared folder; the shared folder's
  // own files come first under no heading.
  const groups = new Map<string, FileRow[]>();
  for (const d of documents) {
    const path = d.folderId === root.id
      ? ""
      : folderChain(folders, d.folderId, root.id).map((f) => f.name).join(" / ");
    const list = groups.get(path) ?? [];
    list.push({ id: d.id, name: d.name, size: d.size });
    groups.set(path, list);
  }
  const ordered = Array.from(groups.entries()).sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
  const total = documents.length;

  return (
    <Shell
      title={share.label || root.name}
      meta={`${total} ${total === 1 ? "file" : "files"} · ${until}`}
    >
      {total === 0 ? (
        <p>There are no files in this folder yet.</p>
      ) : (
        <div className="space-y-md">
          {ordered.map(([path, files]) => (
            <div key={path || "_root"} className="space-y-xs">
              {path && (
                <h2 className="flex items-center gap-xs text-body-md font-semibold text-on-surface">
                  <span className="material-symbols-outlined text-[18px] text-primary">folder</span>
                  {path}
                </h2>
              )}
              <FileList files={files} href={href} />
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}

function FileList({ files, href }: { files: FileRow[]; href: (id: string) => string }) {
  return (
    <ul className="divide-y divide-outline-variant rounded-lg border border-outline-variant">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-sm px-md py-sm">
          <span className="material-symbols-outlined text-[20px] text-on-surface-variant">draft</span>
          <span className="flex-1 min-w-0 break-all text-on-surface">{f.name}</span>
          <span className="text-caption whitespace-nowrap hidden sm:inline">{formatBytes(f.size)}</span>
          <a
            href={href(f.id)}
            className="inline-flex items-center gap-xs px-sm py-xs bg-primary text-on-primary rounded-md text-caption font-semibold hover:opacity-90"
          >
            <span className="material-symbols-outlined text-[16px]">download</span>
            Download
          </a>
        </li>
      ))}
    </ul>
  );
}

function Shell({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface">
      <div className="mx-auto max-w-3xl px-md sm:px-lg py-xl space-y-md">
        <p className="text-caption font-semibold tracking-wide uppercase text-on-surface-variant">
          DESMA International · Shared documents
        </p>
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg space-y-md">
          <div>
            <h1 className="text-h2 text-on-surface break-words">{title}</h1>
            {meta && <p className="text-body-md text-on-surface-variant mt-xs">{meta}</p>}
          </div>
          <div className="text-body-md text-on-surface-variant space-y-sm">{children}</div>
        </div>
        <p className="text-caption text-on-surface-variant">Download only. Please do not forward this link.</p>
      </div>
    </div>
  );
}
