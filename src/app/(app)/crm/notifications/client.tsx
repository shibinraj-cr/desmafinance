"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

export type CrmNotifItem = {
  id: string;
  title: string;
  body: string;
  kind: string;
  linkUrl: string | null;
  createdAt: string;
  readAt: string | null;
};

export function CrmNotifsClient({
  items,
  crmPrefs,
}: {
  items: CrmNotifItem[];
  /** null when the user has no LeadPulseRole (can't be assigned leads). */
  crmPrefs: { notifyOnAssign: boolean } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  async function markRead(id: string) {
    await fetch(`/api/crm/notifications/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "read" }),
    });
    start(() => router.refresh());
  }

  return (
    <div className="space-y-margin">
      {crmPrefs && <NotifSettings initial={crmPrefs.notifyOnAssign} />}
      <Section title="">
        <ul className="space-y-sm">
          {items.map((n) => (
            <li
              key={n.id}
              className={
                "border rounded-lg p-md " +
                (n.readAt ? "border-outline-variant bg-surface" : "border-primary bg-yellow-50/30")
              }
            >
              <div className="flex items-start justify-between gap-sm">
                <div className="flex-1">
                  <p className="font-bold">{n.title}</p>
                  <p className="text-on-surface-variant text-label-sm mt-xs whitespace-pre-wrap">{n.body}</p>
                  {n.linkUrl && (
                    <a href={n.linkUrl} className="text-blue-700 underline text-label-sm">
                      Open ↗
                    </a>
                  )}
                  <p className="text-caption text-on-surface-variant mt-xs">
                    {new Date(n.createdAt).toLocaleString()} · {n.kind}
                  </p>
                </div>
                {!n.readAt && (
                  <button
                    onClick={() => markRead(n.id)}
                    disabled={pending}
                    className="text-blue-700 underline text-label-sm flex-shrink-0"
                  >
                    Mark read
                  </button>
                )}
              </div>
            </li>
          ))}
          {items.length === 0 && (
            <li className="py-lg text-center text-on-surface-variant">No notifications.</li>
          )}
        </ul>
      </Section>
    </div>
  );
}

/** Per-user CRM notification preferences (shown only to users with a CRM role). */
function NotifSettings({ initial }: { initial: boolean }) {
  const [notifyOnAssign, setNotifyOnAssign] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function toggle(next: boolean) {
    setNotifyOnAssign(next); // optimistic
    setSaving(true);
    try {
      const res = await fetch("/api/crm/notifications/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notifyOnAssign: next }),
      });
      if (!res.ok) setNotifyOnAssign(!next); // revert on failure
    } catch {
      setNotifyOnAssign(!next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Notification settings">
      <label className="flex items-start gap-md cursor-pointer py-xs">
        <input
          type="checkbox"
          checked={notifyOnAssign}
          disabled={saving}
          onChange={(e) => toggle(e.target.checked)}
          className="mt-[3px] h-4 w-4 accent-primary"
        />
        <span>
          <span className="font-bold block">Notify me when a lead is assigned to me</span>
          <span className="text-on-surface-variant text-label-sm">
            You&apos;ll get an in-app notification here each time a new lead is assigned or
            reassigned to you.
          </span>
        </span>
      </label>
    </Section>
  );
}
