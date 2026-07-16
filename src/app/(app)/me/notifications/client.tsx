"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";

type Item = {
  id: string;
  title: string;
  body: string;
  kind: string;
  linkUrl: string | null;
  requiresAck: boolean;
  createdAt: string;
  readAt: string | null;
  acknowledgedAt: string | null;
};

export function MeNotifsClient({ items }: { items: Item[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  async function markRead(id: string) {
    await fetch(`/api/me/notifications/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "read" }),
    });
    start(() => router.refresh());
  }
  async function acknowledge(id: string) {
    await fetch(`/api/me/notifications/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "acknowledge" }),
    });
    start(() => router.refresh());
  }

  return (
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
              <div className="flex flex-col gap-xs items-end">
                {!n.readAt && (
                  <button
                    onClick={() => markRead(n.id)}
                    disabled={pending}
                    className="text-blue-700 underline text-label-sm"
                  >
                    Mark read
                  </button>
                )}
                {n.requiresAck &&
                  (n.acknowledgedAt ? (
                    <span className="text-green-700 text-label-sm">
                      Acknowledged {new Date(n.acknowledgedAt).toLocaleDateString()}
                    </span>
                  ) : (
                    <button
                      onClick={() => acknowledge(n.id)}
                      disabled={pending}
                      className="px-sm py-xs rounded bg-primary text-on-primary font-bold text-label-sm"
                    >
                      Acknowledge
                    </button>
                  ))}
              </div>
            </div>
          </li>
        ))}
        {items.length === 0 && (
          <li className="py-lg text-center text-on-surface-variant">No notifications.</li>
        )}
      </ul>
    </Section>
  );
}
