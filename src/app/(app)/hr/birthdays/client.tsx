"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";
import type { CelebrationEntry, CelebrationKind } from "@/lib/celebrations";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

type Settings = {
  autoWishEnabled: boolean;
  reminderDays: number;
  channel: string;
  template: string;
  bandEnabled: boolean;
  greetingEnabled: boolean;
  anniversaryEnabled: boolean;
  showAge: boolean;
  anniversaryTemplate: string;
};

export function BirthdayCalendarClient({
  canManage,
  monthNum,
  monthLabel,
  monthly,
  upcoming,
  todayList,
  settings,
}: {
  canManage: boolean;
  monthNum: number;
  monthLabel: string;
  monthly: CelebrationEntry[];
  upcoming: CelebrationEntry[];
  todayList: CelebrationEntry[];
  settings: Settings;
}) {
  const router = useRouter();
  const [openSettings, setOpenSettings] = useState(false);
  const [sLocal, setSLocal] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function saveSettings() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/hr/birthdays/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sLocal),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Failed");
      }
      setOpenSettings(false);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function sendToday() {
    if (!confirm("Send today's birthday wishes now? Already-sent recipients are skipped.")) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/hr/birthdays/send-wishes", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setMsg(`Sent ${data.sent} · skipped ${data.skipped}`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Section
        title="Today"
        action={
          canManage && (
            <div className="flex items-center gap-sm">
              <button
                type="button"
                onClick={sendToday}
                disabled={busy}
                className="px-md py-xs rounded-lg bg-primary text-on-primary text-label-sm font-semibold disabled:opacity-50"
              >
                {busy ? "Sending…" : "Send today's wishes"}
              </button>
              <button
                type="button"
                onClick={() => setOpenSettings(true)}
                className="px-md py-xs rounded-lg bg-surface-container border border-outline-variant text-label-sm"
              >
                Settings
              </button>
              <a
                href="/api/hr/birthdays/export"
                className="px-md py-xs rounded-lg bg-surface-container border border-outline-variant text-label-sm"
              >
                Export CSV
              </a>
            </div>
          )
        }
      >
        {todayList.length === 0 ? (
          <p className="py-md text-center text-on-surface-variant">Nothing to celebrate today.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-base">
            {todayList.map((e) => (
              <CelebrationCard key={`${e.employeeId}:${e.kind}`} e={e} highlight />
            ))}
          </div>
        )}
        {msg && <p className="mt-base text-label-sm font-semibold">{msg}</p>}
      </Section>

      <Section
        title={`${monthLabel} (${monthly.length})`}
        action={
          <div className="flex items-center gap-xs">
            {MONTH_NAMES.map((m, i) => (
              <Link
                key={m}
                href={`/hr/birthdays?month=${i + 1}`}
                className={`px-xs py-[1px] rounded text-caption font-semibold ${i + 1 === monthNum ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant"}`}
              >
                {m}
              </Link>
            ))}
          </div>
        }
      >
        {monthly.length === 0 ? (
          <p className="py-lg text-center text-on-surface-variant">
            Nothing to celebrate in {monthLabel}.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-base">
            {monthly.map((e) => (
              <CelebrationCard key={`${e.employeeId}:${e.kind}`} e={e} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Upcoming (next 30 days)">
        {upcoming.length === 0 ? (
          <p className="py-md text-center text-on-surface-variant">Nothing coming up.</p>
        ) : (
          <div className="space-y-xs">
            {upcoming.map((e) => (
              <div
                key={`${e.employeeId}:${e.kind}`}
                className="flex items-center gap-sm border border-outline-variant rounded-lg px-md py-sm"
              >
                <OccasionAvatar kind={e.kind} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-xs flex-wrap">
                    <p className="font-semibold truncate">
                      {e.name} <span className="text-on-surface-variant">· {e.empCode}</span>
                    </p>
                    <OccasionChip kind={e.kind} />
                  </div>
                  <p className="text-caption text-on-surface-variant">
                    {e.designation ?? "—"} · {e.department ?? "—"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-h3 font-extrabold tabular-nums">{e.monthDay}</p>
                  <p className="text-caption text-on-surface-variant whitespace-nowrap">
                    {e.delta === 0 ? "Today" : e.delta === 1 ? "Tomorrow" : `in ${e.delta} days`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {openSettings && canManage && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-md">
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-lg w-full max-w-lg space-y-base max-h-[90vh] overflow-y-auto">
            <h3 className="text-h3">Celebration settings</h3>

            <div className="space-y-base">
              <p className="text-caption uppercase tracking-wider text-on-surface-variant font-semibold">
                In the app
              </p>
              <label className="flex items-start gap-sm">
                <input
                  type="checkbox"
                  className="mt-[3px]"
                  checked={sLocal.bandEnabled}
                  onChange={(e) => setSLocal({ ...sLocal, bandEnabled: e.target.checked })}
                />
                <span>
                  <span className="font-semibold">Announce on the band</span>
                  <span className="block text-caption text-on-surface-variant">
                    Everyone sees today&apos;s celebrations in the strip under the header, on every
                    page. Off means only the celebrant hears about it.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-sm">
                <input
                  type="checkbox"
                  className="mt-[3px]"
                  checked={sLocal.greetingEnabled}
                  onChange={(e) => setSLocal({ ...sLocal, greetingEnabled: e.target.checked })}
                />
                <span>
                  <span className="font-semibold">Greet the celebrant</span>
                  <span className="block text-caption text-on-surface-variant">
                    A one-time confetti greeting on their first page load of the day.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-sm">
                <input
                  type="checkbox"
                  className="mt-[3px]"
                  checked={sLocal.anniversaryEnabled}
                  onChange={(e) => setSLocal({ ...sLocal, anniversaryEnabled: e.target.checked })}
                />
                <span>
                  <span className="font-semibold">Include work anniversaries</span>
                  <span className="block text-caption text-on-surface-variant">
                    Every completed year, not only round-numbered ones.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-sm">
                <input
                  type="checkbox"
                  className="mt-[3px]"
                  checked={sLocal.showAge}
                  onChange={(e) => setSLocal({ ...sLocal, showAge: e.target.checked })}
                />
                <span>
                  <span className="font-semibold">Show age on the band</span>
                  <span className="block text-caption text-on-surface-variant">
                    Off by default. A date of birth is on file for payroll, not for publication —
                    turn this on only if the team has agreed to it.
                  </span>
                </span>
              </label>
              <label className="block space-y-xs">
                <span className="text-caption uppercase tracking-wider text-on-surface-variant">
                  Anniversary wording (supports <code>{`{{name}}`}</code>,{" "}
                  <code>{`{{years}}`}</code>, <code>{`{{dept}}`}</code>)
                </span>
                <textarea
                  rows={3}
                  value={sLocal.anniversaryTemplate}
                  onChange={(e) => setSLocal({ ...sLocal, anniversaryTemplate: e.target.value })}
                  className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
                />
              </label>
              <p className="text-caption text-on-surface-variant">
                Anyone can keep themselves off the band entirely from My Account — that switch is
                theirs, and it overrides everything here.
              </p>
            </div>

            <hr className="border-outline-variant" />
            <p className="text-caption uppercase tracking-wider text-on-surface-variant font-semibold">
              Outbound wishes
            </p>
            <label className="flex items-center gap-sm">
              <input
                type="checkbox"
                checked={sLocal.autoWishEnabled}
                onChange={(e) => setSLocal({ ...sLocal, autoWishEnabled: e.target.checked })}
              />
              <span className="font-semibold">Enable auto-wishes</span>
            </label>
            <div className="grid grid-cols-2 gap-base">
              <label className="block space-y-xs">
                <span className="text-caption uppercase tracking-wider text-on-surface-variant">
                  Reminder days in advance
                </span>
                <input
                  type="number"
                  min={0}
                  max={30}
                  value={sLocal.reminderDays}
                  onChange={(e) => setSLocal({ ...sLocal, reminderDays: Number(e.target.value) })}
                  className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
                />
              </label>
              <label className="block space-y-xs">
                <span className="text-caption uppercase tracking-wider text-on-surface-variant">
                  Channel
                </span>
                <select
                  value={sLocal.channel}
                  onChange={(e) => setSLocal({ ...sLocal, channel: e.target.value })}
                  className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
                >
                  <option value="email">Email</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="both">Email + WhatsApp</option>
                  <option value="disabled">Disabled</option>
                </select>
              </label>
            </div>
            <label className="block space-y-xs">
              <span className="text-caption uppercase tracking-wider text-on-surface-variant">
                Template (supports <code>{`{{name}}`}</code>, <code>{`{{dept}}`}</code>)
              </span>
              <textarea
                rows={3}
                value={sLocal.template}
                onChange={(e) => setSLocal({ ...sLocal, template: e.target.value })}
                className="w-full bg-surface-container border border-outline-variant rounded-lg px-sm py-xs"
              />
            </label>
            <div className="flex justify-end gap-sm pt-sm">
              <button
                type="button"
                onClick={() => setOpenSettings(false)}
                className="px-md py-sm rounded-lg text-on-surface-variant"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={saveSettings}
                className="px-md py-sm rounded-lg bg-primary text-on-primary font-semibold disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CelebrationCard({ e, highlight }: { e: CelebrationEntry; highlight?: boolean }) {
  return (
    <div
      className={`flex items-center gap-sm rounded-xl border p-md ${highlight ? "border-primary bg-yellow-50" : "border-outline-variant bg-surface-container-lowest"}`}
    >
      <Avatar name={e.name} photoUrl={e.photoUrl} />
      <div className="flex-1 min-w-0">
        <p className="font-bold truncate">{e.name}</p>
        <p className="text-caption text-on-surface-variant truncate">
          {e.empCode} · {e.designation ?? "—"}
        </p>
        <div className="mt-[2px]">
          <OccasionChip kind={e.kind} />
        </div>
      </div>
      <div className="text-right">
        <p className="text-h3 font-extrabold tabular-nums">{e.monthDay}</p>
        <p className="text-caption text-on-surface-variant whitespace-nowrap">
          {e.kind === "birthday"
            ? `turning ${e.age}`
            : `${e.years} year${e.years === 1 ? "" : "s"}`}
        </p>
      </div>
    </div>
  );
}

/**
 * The occasion in words. HR sees the same wording as everyone else, so a
 * conversation about "the chip on the celebrations page" means one thing.
 */
function OccasionChip({ kind }: { kind: CelebrationKind }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-wider px-xs py-[1px] rounded-full bg-surface-container border border-outline-variant text-on-surface-variant whitespace-nowrap">
      {kind === "birthday" ? "Birthday" : "Work anniversary"}
    </span>
  );
}

/** Cake or party popper, for the compact rows that have no room for a photo. */
function OccasionAvatar({ kind }: { kind: CelebrationKind }) {
  return (
    <div className="w-12 h-12 flex-none rounded-full bg-primary text-on-primary flex items-center justify-center text-h3">
      {kind === "birthday" ? "🎂" : "🎉"}
    </div>
  );
}

function Avatar({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
  if (photoUrl) {
    return <img src={photoUrl} alt={name} className="w-12 h-12 rounded-full object-cover" />;
  }
  return (
    <div className="w-12 h-12 rounded-full bg-primary text-on-primary flex items-center justify-center font-bold">
      {initials || "?"}
    </div>
  );
}
