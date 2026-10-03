"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SHARE_STATE_LABEL, type ShareState } from "@/lib/finance-docs";
import { api, CopyButton } from "../_ui";

type Row = {
  id: string;
  path: string;
  label: string | null;
  kind: "folder" | "document";
  targetName: string;
  targetHref: string;
  period: string;
  state: ShareState;
  downloads: number;
  lastAccessed: string | null;
  createdBy: string | null;
  createdAt: string;
};

const STATE_TONE: Record<ShareState, string> = {
  active: "bg-green-100 text-green-800",
  scheduled: "bg-amber-100 text-amber-800",
  expired: "bg-surface-container text-on-surface-variant",
  revoked: "bg-error/10 text-error",
};

export function SharesTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [showClosed, setShowClosed] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = rows.filter((r) => r.state === "active" || r.state === "scheduled");
  const shown = showClosed ? rows : open;
  const closedCount = rows.length - open.length;

  return (
    <section className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-sm px-md py-sm border-b border-outline-variant">
        <p className="text-body-md font-semibold">
          {open.length} open {open.length === 1 ? "link" : "links"}
        </p>
        {closedCount > 0 && (
          <label className="flex items-center gap-xs text-body-md text-on-surface-variant">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            Show expired and revoked ({closedCount})
          </label>
        )}
      </div>
      {error && <p className="px-md py-sm text-body-md text-error">{error}</p>}
      {shown.length === 0 ? (
        <p className="px-md py-xl text-center text-body-md text-on-surface-variant">
          No open links. Share a document or folder from Documents to create one.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-body-md">
            <thead className="bg-surface-container text-on-surface-variant text-caption uppercase tracking-wide">
              <tr>
                <th className="text-left font-semibold px-md py-sm">Shared</th>
                <th className="text-left font-semibold px-md py-sm">Valid</th>
                <th className="text-left font-semibold px-md py-sm hidden md:table-cell">Downloads</th>
                <th className="text-left font-semibold px-md py-sm hidden lg:table-cell">Created</th>
                <th className="text-right font-semibold px-md py-sm">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {shown.map((r) => {
                const live = r.state === "active" || r.state === "scheduled";
                return (
                  <tr key={r.id}>
                    <td className="px-md py-sm">
                      <Link href={r.targetHref} className="flex items-center gap-sm font-semibold hover:underline">
                        <span className="material-symbols-outlined text-[20px] text-on-surface-variant">
                          {r.kind === "folder" ? "folder" : "draft"}
                        </span>
                        <span className="break-all">{r.targetName}</span>
                      </Link>
                      {r.label && <p className="text-caption text-on-surface-variant pl-[28px]">{r.label}</p>}
                    </td>
                    <td className="px-md py-sm whitespace-nowrap">
                      <span className={`inline-block px-sm py-[2px] rounded-full text-caption font-semibold ${STATE_TONE[r.state]}`}>
                        {SHARE_STATE_LABEL[r.state]}
                      </span>
                      <p className="text-caption text-on-surface-variant mt-[2px]">{r.period}</p>
                    </td>
                    <td className="px-md py-sm text-on-surface-variant hidden md:table-cell whitespace-nowrap">
                      {r.downloads}
                      {r.lastAccessed ? ` · last ${r.lastAccessed}` : ""}
                    </td>
                    <td className="px-md py-sm text-on-surface-variant hidden lg:table-cell whitespace-nowrap">
                      {r.createdAt}
                      {r.createdBy ? ` · ${r.createdBy}` : ""}
                    </td>
                    <td className="px-md py-sm">
                      {live && (
                        <div className="flex items-center justify-end gap-sm">
                          <CopyButton text={typeof window === "undefined" ? r.path : window.location.origin + r.path} label="Copy" />
                          <button
                            type="button"
                            disabled={revoking === r.id}
                            className="text-error hover:underline disabled:opacity-50"
                            onClick={async () => {
                              if (!window.confirm("Revoke this link? Anyone holding it loses access immediately.")) return;
                              setRevoking(r.id);
                              setError(null);
                              try {
                                await api(`/api/finance/documents/shares/${r.id}`, "POST");
                                router.refresh();
                              } catch (e) {
                                setError(e instanceof Error ? e.message : "Could not revoke");
                              } finally {
                                setRevoking(null);
                              }
                            }}
                          >
                            Revoke
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
