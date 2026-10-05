"use client";

// ════════════════════════════════════════════════════════════════════════════
// MeetingActionReminder — the pop-up an action item's owner sees from its due
// date onward, asking them to update it: done, a new date, or "remind me
// tomorrow". Mounted by the app layout only when the server found something
// due (lib/meeting-notes dueRemindersFor), so everyone else pays nothing.
//
// Closing with ✕ hides it for this visit only — the item is still open, so the
// next full page load asks again. Only an update (done / new date / snooze)
// quiets it for the day, and that lives in the database, not the browser, so a
// second device agrees.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatIstShort } from "@/lib/lead-pulse-dates";

export type ReminderItem = {
  id: string;
  text: string;
  /** YYYY-MM-DD */
  dueOn: string;
  meetingId: string;
  meetingTitle: string;
};

type Update = { action: "done" } | { action: "snooze" } | { action: "reschedule"; dueOn: string };

export function MeetingActionReminder({ items, today }: { items: ReminderItem[]; today: string }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(true);
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState<{ id: string; date: string } | null>(null);

  useEffect(() => setMounted(true), []);

  const visible = items.filter((i) => !handled.has(i.id));

  useEffect(() => {
    if (!open || !visible.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, visible.length]);

  if (!mounted || !open || !visible.length) return null;

  async function update(id: string, body: Update) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/me/meeting-actions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      setHandled((h) => new Set(h).add(id));
      setRescheduling(null);
      router.refresh();
    } catch {
      setError("That didn't save. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-center p-md">
      <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="meeting-reminder-title"
        className="relative w-full max-w-[520px] max-h-[85vh] flex flex-col bg-surface-container-lowest border border-outline-variant rounded-xl shadow-xl"
      >
        <div className="flex items-start gap-md px-lg py-md border-b border-outline-variant">
          <span className="material-symbols-outlined text-accent mt-xs">notifications_active</span>
          <div className="min-w-0 flex-1">
            <h3 id="meeting-reminder-title" className="text-h3 text-on-surface">
              {visible.length === 1 ? "An action item needs an update" : `${visible.length} action items need an update`}
            </h3>
            <p className="text-body-md text-on-surface-variant">From your meetings. Mark it done, or set when it will be.</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="h-9 w-9 grid place-items-center rounded-lg hover:bg-surface-container-low text-on-surface-variant"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <ul className="flex-1 overflow-y-auto divide-y divide-outline-variant px-lg">
          {visible.map((item) => {
            const overdue = item.dueOn < today;
            const isBusy = busy === item.id;
            const picking = rescheduling?.id === item.id;
            return (
              <li key={item.id} className="py-md space-y-sm">
                <div>
                  <p className="text-body-md font-semibold text-on-surface">{item.text}</p>
                  <p className="text-caption text-on-surface-variant">
                    <span className={overdue ? "text-error font-semibold" : ""}>
                      {overdue ? `Overdue since ${formatIstShort(item.dueOn)}` : "Due today"}
                    </span>
                    {" · "}
                    <Link
                      href={`/me/meetings?m=${item.meetingId}`}
                      onClick={() => setOpen(false)}
                      className="text-accent hover:underline"
                    >
                      {item.meetingTitle}
                    </Link>
                  </p>
                </div>
                {picking ? (
                  <div className="flex flex-wrap items-center gap-sm">
                    <input
                      type="date"
                      min={today}
                      value={rescheduling.date}
                      onChange={(e) => setRescheduling({ id: item.id, date: e.target.value })}
                      className="h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
                      aria-label="New due date"
                    />
                    <button
                      type="button"
                      disabled={isBusy || !rescheduling.date || rescheduling.date < today}
                      onClick={() => update(item.id, { action: "reschedule", dueOn: rescheduling.date })}
                      className="h-9 px-md rounded-lg bg-primary text-on-primary font-semibold disabled:opacity-60"
                    >
                      Save date
                    </button>
                    <button
                      type="button"
                      onClick={() => setRescheduling(null)}
                      className="h-9 px-md rounded-lg text-on-surface-variant hover:bg-surface-container-low"
                    >
                      Back
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-sm">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => update(item.id, { action: "done" })}
                      className="h-9 px-md rounded-lg bg-primary text-on-primary font-semibold disabled:opacity-60 inline-flex items-center gap-xs"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                        check
                      </span>
                      Done
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => setRescheduling({ id: item.id, date: "" })}
                      className="h-9 px-md rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low disabled:opacity-60"
                    >
                      New due date
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => update(item.id, { action: "snooze" })}
                      className="h-9 px-md rounded-lg text-on-surface-variant hover:bg-surface-container-low disabled:opacity-60"
                    >
                      Remind me tomorrow
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {error && <p className="px-lg pb-md text-body-md text-error">{error}</p>}
      </div>
    </div>,
    document.body,
  );
}
