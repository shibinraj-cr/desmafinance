"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AGREEMENT_FOLDERS_PAGE } from "@/lib/esign/folders";
import { Icon, api, formatDate, primaryBtn } from "../_ui";
import { DeleteDialog, NameDialog, RowButton } from "./_dialogs";

export type FolderRow = { id: string; name: string; updatedAt: string; documents: number };

export function FoldersList({ rows, isAdmin }: { rows: FolderRow[]; isAdmin: boolean }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<FolderRow | null>(null);
  const [deleting, setDeleting] = useState<FolderRow | null>(null);

  return (
    <div className="space-y-md">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <nav className="flex items-center gap-xs text-body-md" aria-label="Breadcrumb">
          <Link href="/operations/agreements" className="text-primary hover:underline font-semibold">
            Agreements
          </Link>
          <Icon name="chevron_right" className="text-on-surface-variant" />
          <span className="font-semibold">Folders</span>
        </nav>
        <button type="button" className={primaryBtn} onClick={() => setCreating(true)}>
          <Icon name="create_new_folder" /> New folder
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-outline-variant p-xl text-center space-y-sm">
          <Icon name="folder_open" size={40} className="text-on-surface-variant" />
          <h3 className="text-h3 font-bold">No folders yet</h3>
          <p className="text-body-md text-on-surface-variant max-w-lg mx-auto">
            Make a folder for agreements signed outside Desgro, such as the Odoo Sign archive or paper scans, then
            upload the files into it.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full text-body-md">
            <thead className="bg-surface-container-low text-left text-on-surface-variant">
              <tr>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider">Folder</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider">Documents</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider hidden md:table-cell">Updated</th>
                <th className="px-md py-sm text-label-sm uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id} className="border-t border-outline-variant hover:bg-surface-container/50">
                  <td className="px-md py-sm">
                    <Link
                      href={`${AGREEMENT_FOLDERS_PAGE}/${f.id}`}
                      className="flex items-center gap-sm font-semibold hover:underline"
                    >
                      <Icon name="folder" size={20} className="text-primary" />
                      <span className="break-all">{f.name}</span>
                    </Link>
                  </td>
                  <td className="px-md py-sm text-on-surface-variant">{f.documents}</td>
                  <td className="px-md py-sm text-on-surface-variant whitespace-nowrap hidden md:table-cell">
                    {formatDate(f.updatedAt)}
                  </td>
                  <td className="px-md py-sm">
                    <div className="flex items-center justify-end gap-xs">
                      <RowButton icon="edit" label="Rename" onClick={() => setRenaming(f)} />
                      {isAdmin && <RowButton icon="delete" label="Delete" danger onClick={() => setDeleting(f)} />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <NameDialog
          title="New folder"
          initial=""
          submitLabel="Create"
          onClose={() => setCreating(false)}
          onSubmit={async (name) => {
            const { folder } = await api<{ folder: { id: string } }>("/api/esign/folders", "POST", { name });
            router.push(`${AGREEMENT_FOLDERS_PAGE}/${folder.id}`);
          }}
        />
      )}
      {renaming && (
        <NameDialog
          title="Rename folder"
          initial={renaming.name}
          submitLabel="Rename"
          onClose={() => setRenaming(null)}
          onSubmit={async (name) => {
            await api(`/api/esign/folders/${renaming.id}`, "PATCH", { name });
            setRenaming(null);
            router.refresh();
          }}
        />
      )}
      {deleting && (
        <DeleteDialog
          title="Delete folder?"
          name={deleting.name}
          blockedReason={
            deleting.documents > 0
              ? "This folder still has documents in it. Only an empty folder can be deleted, so no agreement is removed by accident."
              : null
          }
          message="The folder will be removed."
          url={`/api/esign/folders/${deleting.id}`}
          onClose={() => setDeleting(null)}
          onDone={() => {
            setDeleting(null);
            router.refresh();
          }}
        />
      )}
      {rows.length > 0 && (
        <p className="text-caption text-on-surface-variant">
          {isAdmin ? "Only an empty folder can be deleted." : "Only an admin can delete folders or documents."}
        </p>
      )}
    </div>
  );
}
