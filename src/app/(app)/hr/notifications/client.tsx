"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

type Notif = {
  id: string;
  title: string;
  body: string;
  linkUrl: string | null;
  kind: string;
  requiresAck: boolean;
  createdAt: string;
  total: number;
  read: number;
  acked: number;
};

export function NotificationsClient({
  notifs,
  canBroadcast,
}: {
  notifs: Notif[];
  canBroadcast: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState({ title: "", body: "", linkUrl: "", requiresAck: false });
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setError(null);
    const res = await fetch("/api/hr/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...draft, linkUrl: draft.linkUrl || null }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "send failed");
      return;
    }
    setDraft({ title: "", body: "", linkUrl: "", requiresAck: false });
    start(() => router.refresh());
  }

  return (
    <div className="space-y-lg">
      {canBroadcast && (
        <Section title="Broadcast announcement">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-sm">
            <label className="flex flex-col gap-xs">
              <span className="text-caption text-on-surface-variant">Title</span>
              <input
                className="px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-xs">
              <span className="text-caption text-on-surface-variant">Link URL (optional)</span>
              <input
                className="px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.linkUrl}
                onChange={(e) => setDraft({ ...draft, linkUrl: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-xs md:col-span-2">
              <span className="text-caption text-on-surface-variant">Body</span>
              <textarea
                rows={3}
                className="px-sm py-sm rounded border border-outline-variant bg-surface"
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-xs text-label-sm">
              <input
                type="checkbox"
                checked={draft.requiresAck}
                onChange={(e) => setDraft({ ...draft, requiresAck: e.target.checked })}
              />
              Require employee acknowledgement
            </label>
            <div className="md:col-span-2 flex items-center gap-sm">
              <button
                onClick={send}
                disabled={pending || !draft.title || !draft.body}
                className="px-md py-sm rounded bg-primary text-on-primary font-bold disabled:opacity-50"
              >
                Send to all employees
              </button>
              {error && <span className="text-red-700 text-label-sm">{error}</span>}
            </div>
          </div>
        </Section>
      )}

      <Section title="Recent">
        <table className="w-full text-label-sm">
          <thead className="text-left text-on-surface-variant border-b border-outline-variant">
            <tr>
              <th className="py-sm pr-md">Title</th>
              <th className="py-sm pr-md">Kind</th>
              <th className="py-sm pr-md">Sent</th>
              <th className="py-sm pr-md">Read</th>
              <th className="py-sm pr-md">Acked</th>
            </tr>
          </thead>
          <tbody>
            {notifs.map((n) => (
              <tr key={n.id} className="border-b border-outline-variant last:border-0">
                <td className="py-sm pr-md font-semibold">
                  {n.title}
                  <div className="text-on-surface-variant text-caption max-w-md truncate">{n.body}</div>
                </td>
                <td className="py-sm pr-md">{n.kind}</td>
                <td className="py-sm pr-md text-on-surface-variant">{new Date(n.createdAt).toLocaleString()}</td>
                <td className="py-sm pr-md">
                  {n.read} / {n.total}
                </td>
                <td className="py-sm pr-md">
                  {n.requiresAck ? `${n.acked} / ${n.total}` : "—"}
                </td>
              </tr>
            ))}
            {notifs.length === 0 && (
              <tr>
                <td colSpan={5} className="py-lg text-center text-on-surface-variant">
                  No notifications yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
