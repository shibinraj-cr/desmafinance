"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

type Policy = {
  id: string;
  title: string;
  version: string;
  body: string;
  externalUrl: string | null;
  category: string | null;
  requiresAck: boolean;
  status: string;
  publishedAt: string | null;
  ackCount: number;
  totalEligible: number;
};

const BLANK = {
  title: "",
  version: "v1",
  body: "",
  externalUrl: "",
  category: "",
  requiresAck: true,
  publish: false,
};

export function PoliciesClient({ policies, canEdit }: { policies: Policy[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState(BLANK);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const res = await fetch("/api/hr/policies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "save failed");
      return;
    }
    setDraft(BLANK);
    start(() => router.refresh());
  }
  async function publish(id: string) {
    if (!confirm("Publish this policy? It will notify every employee and require their e-sign.")) return;
    const res = await fetch(`/api/hr/policies/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publish: true }),
    });
    if (res.ok) start(() => router.refresh());
  }
  async function remove(id: string) {
    if (!confirm("Delete this policy?")) return;
    const res = await fetch(`/api/hr/policies/${id}`, { method: "DELETE" });
    if (res.ok) start(() => router.refresh());
  }

  return (
    <div className="space-y-lg">
      {canEdit && (
        <Section title="Author new policy">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-sm">
            <label className="flex flex-col gap-xs md:col-span-2">
              <span className="text-caption text-on-surface-variant">Title</span>
              <input
                className="px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-xs">
              <span className="text-caption text-on-surface-variant">Version</span>
              <input
                className="px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.version}
                onChange={(e) => setDraft({ ...draft, version: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-xs">
              <span className="text-caption text-on-surface-variant">Category</span>
              <input
                className="px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-xs md:col-span-4">
              <span className="text-caption text-on-surface-variant">Body (markdown / plain text)</span>
              <textarea
                rows={6}
                className="px-sm py-sm rounded border border-outline-variant bg-surface font-mono text-label-sm"
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-xs md:col-span-3">
              <span className="text-caption text-on-surface-variant">External URL (optional, e.g. PDF link)</span>
              <input
                className="px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.externalUrl}
                onChange={(e) => setDraft({ ...draft, externalUrl: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-xs text-label-sm">
              <input
                type="checkbox"
                checked={draft.requiresAck}
                onChange={(e) => setDraft({ ...draft, requiresAck: e.target.checked })}
              />
              Require e-sign
            </label>
            <label className="flex items-center gap-xs text-label-sm md:col-span-4">
              <input
                type="checkbox"
                checked={draft.publish}
                onChange={(e) => setDraft({ ...draft, publish: e.target.checked })}
              />
              Publish immediately (notifies all employees)
            </label>
            <div className="md:col-span-4 flex gap-sm">
              <button
                onClick={save}
                disabled={pending || !draft.title || !draft.body}
                className="px-md py-sm rounded bg-primary text-on-primary font-bold disabled:opacity-50"
              >
                Save policy
              </button>
              {error && <span className="text-red-700 text-label-sm">{error}</span>}
            </div>
          </div>
        </Section>
      )}

      <Section title="All policies">
        <table className="w-full text-label-sm">
          <thead className="text-left text-on-surface-variant border-b border-outline-variant">
            <tr>
              <th className="py-sm pr-md">Title</th>
              <th className="py-sm pr-md">Version</th>
              <th className="py-sm pr-md">Category</th>
              <th className="py-sm pr-md">Status</th>
              <th className="py-sm pr-md">E-signs</th>
              {canEdit && <th className="py-sm pr-md text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {policies.map((p) => (
              <tr key={p.id} className="border-b border-outline-variant last:border-0">
                <td className="py-sm pr-md font-semibold">{p.title}</td>
                <td className="py-sm pr-md">{p.version}</td>
                <td className="py-sm pr-md text-on-surface-variant">{p.category ?? "—"}</td>
                <td className="py-sm pr-md">
                  <span
                    className={
                      "inline-block px-xs py-[2px] rounded text-[11px] font-bold " +
                      (p.status === "published"
                        ? "bg-green-50 text-green-800"
                        : "bg-yellow-50 text-yellow-800")
                    }
                  >
                    {p.status}
                  </span>
                </td>
                <td className="py-sm pr-md">
                  {p.requiresAck ? `${p.ackCount} / ${p.totalEligible}` : "—"}
                </td>
                {canEdit && (
                  <td className="py-sm pr-md text-right whitespace-nowrap">
                    {p.status === "draft" && (
                      <button onClick={() => publish(p.id)} className="text-blue-700 underline mr-sm">
                        Publish
                      </button>
                    )}
                    <button onClick={() => remove(p.id)} className="text-red-700 underline">
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {policies.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 6 : 5} className="py-lg text-center text-on-surface-variant">
                  No policies yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
