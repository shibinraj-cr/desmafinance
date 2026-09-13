"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ErrorNote, Icon, formatDateTime, sopApi } from "@/components/sop/ui";

type NotificationRow = {
  id: string;
  kind: string;
  title: string;
  body: string;
  linkUrl: string | null;
  readAt: string | null;
  createdAt: string;
};

/**
 * SOP notifications (§22), on the page where they are acted on.
 *
 * Deliberately not a separate screen: every one of these is "an SOP needs
 * something from you", and that is what My SOPs already is. A notifications
 * page next to a My SOPs page would split one job across two destinations.
 *
 * The panel is absent entirely when there is nothing unread and nothing recent,
 * so it costs no space on an ordinary day.
 */
export function NotificationPanel({ notifications }: { notifications: NotificationRow[] }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unread = notifications.filter((n) => !n.readAt);
  if (notifications.length === 0) return null;

  const shown = expanded ? notifications : unread.length > 0 ? unread : notifications.slice(0, 3);

  async function markRead(ids?: string[]) {
    setBusy(true);
    setError(null);
    const r = await sopApi("/api/sop/notifications", "PATCH", ids ? { ids } : {});
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.refresh();
  }

  return (
    <section className="rounded-xl border border-outline-variant bg-surface-container-lowest">
      <div className="flex flex-wrap items-center justify-between gap-md px-lg py-md border-b border-outline-variant">
        <div className="flex items-center gap-xs">
          <Icon name="notifications" size={20} className="text-on-surface-variant" />
          <h3 className="text-h3 text-on-surface">Notifications</h3>
          {unread.length > 0 && (
            <span className="px-xs rounded-full bg-primary text-on-primary text-caption font-semibold">
              {unread.length} unread
            </span>
          )}
        </div>
        <div className="flex items-center gap-xs">
          {unread.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => markRead()}
              className="text-label-sm text-accent hover:underline disabled:opacity-60"
            >
              Mark all read
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-label-sm text-on-surface-variant hover:text-on-surface"
          >
            {expanded ? "Show less" : "Show all"}
          </button>
        </div>
      </div>

      <div className="p-lg space-y-sm">
        {error && <ErrorNote>{error}</ErrorNote>}
        <ul className="divide-y divide-outline-variant">
          {shown.map((n) => (
            <li key={n.id} className="py-sm first:pt-0 last:pb-0 flex items-start gap-sm">
              <span
                className={
                  "mt-1.5 h-2 w-2 rounded-full shrink-0 " + (n.readAt ? "bg-outline-variant" : "bg-primary")
                }
                aria-label={n.readAt ? "Read" : "Unread"}
              />
              <div className="min-w-0 flex-1">
                <div className="text-body-md text-on-surface font-medium">{n.title}</div>
                <div className="text-body-sm text-on-surface-variant">{n.body}</div>
                <div className="text-caption text-on-surface-variant mt-px">
                  {formatDateTime(n.createdAt)}
                </div>
              </div>
              {n.linkUrl && (
                <Link
                  href={n.linkUrl}
                  onClick={() => {
                    if (!n.readAt) void markRead([n.id]);
                  }}
                  className="text-label-sm text-accent hover:underline whitespace-nowrap"
                >
                  Open
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
