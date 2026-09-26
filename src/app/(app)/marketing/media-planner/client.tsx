"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MEDIA_FORMATS,
  MEDIA_FORMAT_CODES,
  MEDIA_ITEM_STATUSES,
  MEDIA_STATUS_LABELS,
  MEDIA_WEEKLY_TARGETS,
  type MediaFormat,
  type MediaItemDto,
  type MediaItemStatus,
  type MediaTaskDto,
} from "@/lib/media-plan-shared";

type UserOpt = { id: string; username: string };

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function fmtDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function parseUtc(ds: string): Date {
  const [y, m, d] = ds.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addDaysStr(ds: string, days: number): string {
  const dt = parseUtc(ds);
  dt.setUTCDate(dt.getUTCDate() + days);
  return fmtDate(dt);
}

/** "THU 25" — the task-rail date tag. */
function shortTag(ds: string): string {
  const dt = parseUtc(ds);
  return `${WEEKDAY_LABELS[dt.getUTCDay()].toUpperCase()} ${dt.getUTCDate()}`;
}

/** "26 Sep" — compact card meta. */
function shortDate(ds: string): string {
  const dt = parseUtc(ds);
  return `${dt.getUTCDate()} ${MONTH_LABELS[dt.getUTCMonth()].slice(0, 3)}`;
}

function formatMeta(format: string): { label: string; pill: string; color: string } {
  return (
    MEDIA_FORMATS[format as MediaFormat] ?? {
      label: format,
      pill: format.toUpperCase(),
      color: "#9a9078",
    }
  );
}

/** rgba() tint of a #rrggbb accent, for chip fills and borders. */
function tint(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type Draft = {
  id: string | null;
  title: string;
  format: MediaFormat;
  status: MediaItemStatus;
  publishDate: string;
  publishTime: string;
  shootDate: string;
  hook: string;
  ownerId: string;
  seedChecklist: boolean;
};

function draftFromItem(item: MediaItemDto): Draft {
  return {
    id: item.id,
    title: item.title,
    format: (item.format as MediaFormat) ?? "reel",
    status: (item.status as MediaItemStatus) ?? "idea",
    publishDate: item.publishDate ?? "",
    publishTime: item.publishTime ?? "",
    shootDate: item.shootDate ?? "",
    hook: item.hook ?? "",
    ownerId: item.ownerId ?? "",
    seedChecklist: false,
  };
}

const inputStyle = {
  backgroundColor: "var(--lp-surface-container-high)",
  borderColor: "var(--lp-outline-variant)",
  color: "var(--lp-on-surface)",
} as const;

const inputClass =
  "w-full rounded-[8px] px-[10px] py-[8px] text-[13px] border outline-none focus:border-[#facc15]";

export function MediaPlannerClient({
  year,
  month,
  todayStr,
  items: initialItems,
  users,
  selfId,
}: {
  year: number;
  month: number;
  todayStr: string;
  items: MediaItemDto[];
  users: UserOpt[];
  selfId: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState<MediaItemDto[]>(initialItems);
  const [view, setView] = useState<"calendar" | "board">("calendar");
  const [formatFilter, setFormatFilter] = useState<string[]>([]);
  const [ownerFilter, setOwnerFilter] = useState<string>("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [newStep, setNewStep] = useState("");
  const [busy, setBusy] = useState(false);

  const usernameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users) m.set(u.id, u.username);
    return m;
  }, [users]);

  function replaceItem(next: MediaItemDto) {
    setItems((arr) => {
      const idx = arr.findIndex((i) => i.id === next.id);
      if (idx < 0) return [...arr, next];
      const copy = arr.slice();
      copy[idx] = next;
      return copy;
    });
  }

  function replaceTask(itemId: string, task: MediaTaskDto) {
    setItems((arr) =>
      arr.map((i) =>
        i.id === itemId
          ? {
              ...i,
              tasks: i.tasks.some((t) => t.id === task.id)
                ? i.tasks.map((t) => (t.id === task.id ? task : t))
                : [...i.tasks, task],
            }
          : i,
      ),
    );
  }

  const matchesFilters = (it: MediaItemDto) =>
    (formatFilter.length === 0 || formatFilter.includes(it.format)) &&
    (!ownerFilter || it.ownerId === ownerFilter);

  const visibleItems = useMemo(() => items.filter(matchesFilters), [items, formatFilter, ownerFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Calendar grid (leading/trailing days of adjacent months shown dim) ----
  const cells = useMemo(() => {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const start = new Date(first);
    start.setUTCDate(1 - first.getUTCDay());
    const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const last = new Date(Date.UTC(year, month - 1, dim));
    const end = new Date(last);
    end.setUTCDate(dim + (6 - last.getUTCDay()));
    const out: { date: string; day: number; inMonth: boolean; weekday: number }[] = [];
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      out.push({
        date: fmtDate(d),
        day: d.getUTCDate(),
        inMonth: d.getUTCMonth() === month - 1,
        weekday: d.getUTCDay(),
      });
    }
    return out;
  }, [year, month]);

  const itemsByDate = useMemo(() => {
    const m = new Map<string, MediaItemDto[]>();
    for (const it of visibleItems) {
      if (!it.publishDate) continue;
      const arr = m.get(it.publishDate) ?? [];
      arr.push(it);
      m.set(it.publishDate, arr);
    }
    return m;
  }, [visibleItems]);

  // Open production steps on unshipped items — the execution list.
  const openSteps = useMemo(() => {
    const out: { task: MediaTaskDto; item: MediaItemDto }[] = [];
    for (const it of visibleItems) {
      if (it.status === "published") continue;
      for (const t of it.tasks) if (t.status === "open") out.push({ task: t, item: it });
    }
    out.sort((a, b) => {
      if (!a.task.dueDate && !b.task.dueDate) return 0;
      if (!a.task.dueDate) return 1;
      if (!b.task.dueDate) return -1;
      return a.task.dueDate.localeCompare(b.task.dueDate);
    });
    return out;
  }, [visibleItems]);

  const dueCountByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const { task } of openSteps) {
      if (!task.dueDate) continue;
      m.set(task.dueDate, (m.get(task.dueDate) ?? 0) + 1);
    }
    return m;
  }, [openSteps]);

  // ---- KPIs (unfiltered) ----
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;
  const weekStart = addDaysStr(todayStr, -parseUtc(todayStr).getUTCDay());
  const weekEnd = addDaysStr(weekStart, 6);
  const kpi = useMemo(() => {
    const planned = items.filter((i) => i.publishDate?.startsWith(monthPrefix));
    const published = planned.filter((i) => i.status === "published");
    const inProduction = items.filter(
      (i) => i.status !== "idea" && i.status !== "published" && i.status !== "scheduled",
    );
    let dueThisWeek = 0;
    let overdue = 0;
    for (const it of items) {
      if (it.status === "published") continue;
      for (const t of it.tasks) {
        if (t.status !== "open" || !t.dueDate) continue;
        if (t.dueDate < todayStr) overdue += 1;
        if (t.dueDate >= weekStart && t.dueDate <= weekEnd) dueThisWeek += 1;
      }
    }
    return { planned: planned.length, published: published.length, inProduction: inProduction.length, dueThisWeek, overdue };
  }, [items, monthPrefix, todayStr, weekStart, weekEnd]);

  const cadence = useMemo(
    () =>
      MEDIA_FORMAT_CODES.map((code) => {
        const count = items.filter(
          (i) => i.format === code && i.publishDate && i.publishDate >= weekStart && i.publishDate <= weekEnd,
        ).length;
        const target = MEDIA_WEEKLY_TARGETS[code];
        return { code, count, target, pct: Math.min(100, Math.round((count / Math.max(1, target)) * 100)) };
      }),
    [items, weekStart, weekEnd],
  );

  // ---- Navigation ----
  function navigate(deltaMonths: number) {
    let y = year;
    let m = month + deltaMonths;
    while (m < 1) { m += 12; y -= 1; }
    while (m > 12) { m -= 12; y += 1; }
    router.push(`/marketing/media-planner?year=${y}&month=${m}`);
  }

  function openNew(publishDate?: string) {
    setNewStep("");
    setDraft({
      id: null,
      title: "",
      format: "reel",
      status: "idea",
      publishDate: publishDate ?? todayStr,
      publishTime: "",
      shootDate: "",
      hook: "",
      ownerId: selfId,
      seedChecklist: true,
    });
  }

  function openItem(item: MediaItemDto) {
    setNewStep("");
    setDraft(draftFromItem(item));
  }

  const drawerItem = draft?.id ? items.find((i) => i.id === draft.id) ?? null : null;

  // ---- API calls ----
  async function saveDraft() {
    if (!draft || !draft.title.trim()) return;
    setBusy(true);
    try {
      const payload = {
        title: draft.title.trim(),
        format: draft.format,
        status: draft.status,
        publishDate: draft.publishDate || null,
        publishTime: draft.publishTime || null,
        shootDate: draft.shootDate || null,
        hook: draft.hook || null,
        ownerId: draft.ownerId || null,
        ...(draft.id ? {} : { seedChecklist: draft.seedChecklist }),
      };
      const res = await fetch(
        draft.id ? `/api/marketing/media-plan/${draft.id}` : "/api/marketing/media-plan",
        {
          method: draft.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        alert("Failed to save.");
        return;
      }
      const { item } = (await res.json()) as { item: MediaItemDto };
      replaceItem(item);
      setDraft(null);
    } finally {
      setBusy(false);
    }
  }

  async function markPublished() {
    if (!draft?.id) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/marketing/media-plan/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "published" }),
      });
      if (!res.ok) {
        alert("Failed to mark published.");
        return;
      }
      const { item } = (await res.json()) as { item: MediaItemDto };
      replaceItem(item);
      setDraft(null);
    } finally {
      setBusy(false);
    }
  }

  async function deleteItem() {
    if (!draft?.id) return;
    if (!confirm("Delete this content item and its checklist?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/marketing/media-plan/${draft.id}`, { method: "DELETE" });
      if (!res.ok) {
        alert("Failed to delete.");
        return;
      }
      setItems((arr) => arr.filter((i) => i.id !== draft.id));
      setDraft(null);
    } finally {
      setBusy(false);
    }
  }

  async function patchTask(itemId: string, taskId: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/marketing/media-plan/${itemId}/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      alert("Failed to update the step.");
      return;
    }
    const { task } = (await res.json()) as { task: MediaTaskDto };
    replaceTask(itemId, task);
  }

  async function addStep() {
    if (!draft?.id || !newStep.trim()) return;
    const res = await fetch(`/api/marketing/media-plan/${draft.id}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newStep.trim() }),
    });
    if (!res.ok) {
      alert("Failed to add the step.");
      return;
    }
    const { task } = (await res.json()) as { task: MediaTaskDto };
    replaceTask(draft.id, task);
    setNewStep("");
  }

  async function removeStep(itemId: string, taskId: string) {
    const res = await fetch(`/api/marketing/media-plan/${itemId}/tasks/${taskId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      alert("Failed to remove the step.");
      return;
    }
    setItems((arr) =>
      arr.map((i) => (i.id === itemId ? { ...i, tasks: i.tasks.filter((t) => t.id !== taskId) } : i)),
    );
  }

  // ---- Render ----
  return (
    <div className="px-[24px] py-[24px] space-y-[16px]">
      <header className="flex flex-wrap items-end justify-between gap-[16px]">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight">Media Planner</h1>
          <p className="mt-[4px] text-[13px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            Plan, produce and publish — YouTube shorts &amp; videos, Insta reels and posters.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-[8px]">
          <div
            className="flex rounded-[8px] border overflow-hidden"
            style={{ borderColor: "var(--lp-outline-variant)" }}
          >
            {(["calendar", "board"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className="px-[14px] py-[6px] text-[13px] font-semibold"
                style={
                  view === v
                    ? { backgroundColor: "rgba(250, 204, 21, 0.14)", color: "var(--lp-primary)" }
                    : { color: "var(--lp-on-surface-variant)" }
                }
              >
                {v === "calendar" ? "Calendar" : "Board"}
              </button>
            ))}
          </div>
          <button
            onClick={() => navigate(-1)}
            className="rounded-[8px] px-[10px] py-[6px] text-[13px] border"
            style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface)" }}
          >
            ‹ Prev
          </button>
          <div
            className="rounded-[8px] px-[12px] py-[6px] text-[14px] font-semibold border"
            style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-primary)" }}
          >
            {MONTH_LABELS[month - 1]} {year}
          </div>
          <button
            onClick={() => navigate(1)}
            className="rounded-[8px] px-[10px] py-[6px] text-[13px] border"
            style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface)" }}
          >
            Next ›
          </button>
          <button
            onClick={() => {
              const y = Number(todayStr.slice(0, 4));
              const m = Number(todayStr.slice(5, 7));
              router.push(`/marketing/media-planner?year=${y}&month=${m}`);
            }}
            className="rounded-[8px] px-[10px] py-[6px] text-[13px] border"
            style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface)" }}
          >
            Today
          </button>
          <button
            onClick={() => openNew()}
            className="rounded-[8px] px-[14px] py-[7px] text-[13px] font-bold"
            style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
          >
            + Plan content
          </button>
        </div>
      </header>

      {/* KPI band */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-[12px]">
        {[
          {
            label: `PLANNED · ${MONTH_LABELS[month - 1].slice(0, 3).toUpperCase()}`,
            value: kpi.planned,
            sub: `${kpi.published} published`,
            color: "var(--lp-primary)",
            subColor: "var(--lp-on-surface-variant)",
          },
          {
            label: "PUBLISHED",
            value: kpi.published,
            sub: kpi.planned ? `${Math.round((kpi.published / kpi.planned) * 100)}% of plan` : "—",
            color: "var(--lp-primary)",
            subColor: "var(--lp-on-surface-variant)",
          },
          {
            label: "IN PRODUCTION",
            value: kpi.inProduction,
            sub: "script → approval",
            color: "var(--lp-primary)",
            subColor: "var(--lp-on-surface-variant)",
          },
          {
            label: "TASKS DUE THIS WEEK",
            value: kpi.dueThisWeek,
            sub: kpi.overdue ? `${kpi.overdue} overdue` : "none overdue",
            color: kpi.overdue ? "var(--lp-error)" : "var(--lp-primary)",
            subColor: kpi.overdue ? "var(--lp-error)" : "var(--lp-on-surface-variant)",
          },
        ].map((k) => (
          <div
            key={k.label}
            className="rounded-[12px] border p-[14px]"
            style={{
              backgroundColor: "var(--lp-surface-container)",
              borderColor: "var(--lp-outline-variant)",
            }}
          >
            <p
              className="text-[10px] uppercase tracking-widest"
              style={{ color: "var(--lp-on-surface-variant)" }}
            >
              {k.label}
            </p>
            <p className="mt-[6px] text-[26px] font-bold tabular-nums leading-none" style={{ color: k.color }}>
              {k.value}
            </p>
            <p className="mt-[6px] text-[11px]" style={{ color: k.subColor }}>
              {k.sub}
            </p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-[8px]">
        <button
          onClick={() => setFormatFilter([])}
          className="rounded-full px-[12px] py-[5px] text-[12px] font-semibold border"
          style={
            formatFilter.length === 0
              ? { borderColor: "var(--lp-primary)", color: "var(--lp-primary)", backgroundColor: "rgba(250, 204, 21, 0.10)" }
              : { borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface-variant)" }
          }
        >
          All formats
        </button>
        {MEDIA_FORMAT_CODES.map((code) => {
          const meta = MEDIA_FORMATS[code];
          const active = formatFilter.includes(code);
          return (
            <button
              key={code}
              onClick={() =>
                setFormatFilter((arr) =>
                  arr.includes(code) ? arr.filter((c) => c !== code) : [...arr, code],
                )
              }
              className="flex items-center gap-[6px] rounded-full px-[12px] py-[5px] text-[12px] font-semibold border"
              style={
                active
                  ? { borderColor: meta.color, color: meta.color, backgroundColor: tint(meta.color, 0.12) }
                  : { borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface-variant)" }
              }
            >
              <span className="inline-block w-[7px] h-[7px] rounded-full" style={{ backgroundColor: meta.color }} />
              {meta.label}s
            </button>
          );
        })}
        <div className="grow" />
        <select
          value={ownerFilter}
          onChange={(e) => setOwnerFilter(e.target.value)}
          className="rounded-[8px] px-[10px] py-[6px] text-[12px] border outline-none"
          style={inputStyle}
        >
          <option value="">Owner · Everyone</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.username}
            </option>
          ))}
        </select>
      </div>

      {view === "calendar" ? (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-[16px]">
          {/* Calendar */}
          <section
            className="rounded-[12px] border p-[14px]"
            style={{
              backgroundColor: "var(--lp-surface-container)",
              borderColor: "var(--lp-outline-variant)",
            }}
          >
            <div
              className="grid grid-cols-7 gap-[6px] text-[11px] uppercase tracking-widest mb-[6px]"
              style={{ color: "var(--lp-on-surface-variant)" }}
            >
              {WEEKDAY_LABELS.map((w, i) => (
                <div key={w} className="px-[6px] py-[4px]" style={i === 0 ? { color: "var(--lp-cyan)" } : undefined}>
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-[6px]">
              {cells.map((c) => {
                const dayItems = itemsByDate.get(c.date) ?? [];
                const due = dueCountByDate.get(c.date) ?? 0;
                const isToday = c.date === todayStr;
                const isSun = c.weekday === 0;
                return (
                  <div
                    key={c.date}
                    className="group min-h-[112px] rounded-[8px] border p-[7px] flex flex-col gap-[4px]"
                    style={{
                      backgroundColor: isToday
                        ? "rgba(250, 204, 21, 0.07)"
                        : isSun
                          ? "rgba(51, 228, 255, 0.05)"
                          : "var(--lp-surface-container-high)",
                      borderColor: isToday ? "var(--lp-primary)" : "var(--lp-outline-variant)",
                      opacity: c.inMonth ? 1 : 0.45,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className="text-[12px] font-semibold tabular-nums"
                        style={{ color: isToday ? "var(--lp-primary)" : "var(--lp-on-surface-variant)" }}
                      >
                        {c.day}
                      </span>
                      <span className="flex items-center gap-[6px]">
                        {isToday && (
                          <span className="text-[9px] uppercase tracking-widest" style={{ color: "var(--lp-primary)" }}>
                            Today
                          </span>
                        )}
                        <button
                          onClick={() => openNew(c.date)}
                          aria-label={`Plan content for ${c.date}`}
                          className="w-[18px] h-[18px] rounded-[5px] text-[13px] leading-none opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ backgroundColor: "rgba(250, 204, 21, 0.15)", color: "var(--lp-primary)" }}
                        >
                          +
                        </button>
                      </span>
                    </div>
                    <div className="flex flex-col gap-[3px] overflow-hidden">
                      {dayItems.slice(0, 3).map((it) => {
                        const meta = formatMeta(it.format);
                        const done = it.status === "published";
                        return (
                          <button
                            key={it.id}
                            onClick={() => openItem(it)}
                            className="flex items-center gap-[5px] rounded-[6px] px-[6px] py-[2px] text-[10.5px] font-semibold text-left truncate border"
                            style={{
                              backgroundColor: tint(meta.color, 0.13),
                              borderColor: tint(meta.color, 0.35),
                              color: "var(--lp-on-surface)",
                              opacity: done ? 0.55 : 1,
                            }}
                            title={`${meta.label} — ${it.title}`}
                          >
                            <span
                              className="inline-block w-[6px] h-[6px] rounded-full shrink-0"
                              style={{ backgroundColor: meta.color }}
                            />
                            <span className="truncate">{done ? `✓ ${it.title}` : it.title}</span>
                          </button>
                        );
                      })}
                      {dayItems.length > 3 && (
                        <span className="text-[10px]" style={{ color: "var(--lp-on-surface-variant)" }}>
                          +{dayItems.length - 3} more
                        </span>
                      )}
                    </div>
                    {due > 0 && (
                      <span
                        className="mt-auto text-[9px] font-bold"
                        style={{ color: c.date < todayStr ? "var(--lp-error)" : "var(--lp-primary)" }}
                      >
                        {due} step{due === 1 ? "" : "s"} due
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Right rail */}
          <aside className="space-y-[16px]">
            <section
              className="rounded-[12px] border p-[14px]"
              style={{
                backgroundColor: "var(--lp-surface-container)",
                borderColor: "var(--lp-outline-variant)",
              }}
            >
              <div className="flex items-center justify-between mb-[6px]">
                <h2 className="text-[10px] uppercase tracking-widest font-bold" style={{ color: "var(--lp-on-surface-variant)" }}>
                  Tasks &amp; reminders
                </h2>
                <span className="text-[11px] font-bold" style={{ color: "var(--lp-primary)" }}>
                  This week · {kpi.dueThisWeek}
                </span>
              </div>
              {openSteps.length === 0 ? (
                <p className="text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
                  No open production steps. Plan something!
                </p>
              ) : (
                <ul>
                  {openSteps.slice(0, 8).map(({ task, item }) => {
                    const overdue = !!task.dueDate && task.dueDate < todayStr;
                    const today = task.dueDate === todayStr;
                    const tag = !task.dueDate ? "—" : overdue ? "OVERDUE" : today ? "TODAY" : shortTag(task.dueDate);
                    const tagColor = overdue
                      ? "var(--lp-error)"
                      : today
                        ? "var(--lp-primary)"
                        : "var(--lp-on-surface-variant)";
                    return (
                      <li
                        key={task.id}
                        className="flex items-start gap-[10px] py-[8px] border-b last:border-b-0"
                        style={{ borderColor: "rgba(245, 197, 24, 0.08)" }}
                      >
                        <span className="shrink-0 w-[58px] pt-[2px] text-[9px] font-extrabold tracking-wider" style={{ color: tagColor }}>
                          {tag}
                        </span>
                        <button onClick={() => openItem(item)} className="min-w-0 text-left">
                          <span className="block text-[12px] font-semibold leading-snug" style={{ color: "var(--lp-on-surface)" }}>
                            {task.name} — {item.title}
                          </span>
                          <span className="block text-[10.5px]" style={{ color: "var(--lp-outline)" }}>
                            {formatMeta(item.format).label}
                            {task.assignedToId ? ` · ${usernameById.get(task.assignedToId) ?? "unknown"}` : ""}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <button
                onClick={() => setView("board")}
                className="mt-[8px] text-[11px] font-bold"
                style={{ color: "var(--lp-primary)" }}
              >
                View production board →
              </button>
            </section>

            <section
              className="rounded-[12px] border p-[14px] space-y-[10px]"
              style={{
                backgroundColor: "var(--lp-surface-container)",
                borderColor: "var(--lp-outline-variant)",
              }}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] uppercase tracking-widest font-bold" style={{ color: "var(--lp-on-surface-variant)" }}>
                  Weekly cadence
                </h2>
                <span className="text-[10px]" style={{ color: "var(--lp-outline)" }}>
                  {shortDate(weekStart)} – {shortDate(weekEnd)}
                </span>
              </div>
              {cadence.map((c) => {
                const meta = MEDIA_FORMATS[c.code];
                return (
                  <div key={c.code}>
                    <div className="flex items-center justify-between mb-[4px]">
                      <span className="flex items-center gap-[7px] text-[11.5px] font-semibold" style={{ color: "var(--lp-on-surface-variant)" }}>
                        <span className="inline-block w-[7px] h-[7px] rounded-full" style={{ backgroundColor: meta.color }} />
                        {meta.label}s
                      </span>
                      <span className="text-[11.5px] font-bold font-mono" style={{ color: "var(--lp-on-surface)" }}>
                        {c.count} / {c.target}
                      </span>
                    </div>
                    <div className="h-[5px] rounded-full overflow-hidden" style={{ backgroundColor: "rgba(255, 255, 255, 0.07)" }}>
                      <div className="h-full rounded-full" style={{ backgroundColor: meta.color, width: `${c.pct}%` }} />
                    </div>
                  </div>
                );
              })}
              <p className="text-[10px] leading-relaxed" style={{ color: "var(--lp-outline)" }}>
                Reminders go out 9:00 AM IST — in-app, to each step&apos;s assignee.
              </p>
            </section>
          </aside>
        </div>
      ) : (
        /* Production board */
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-[12px] items-start">
          {MEDIA_ITEM_STATUSES.map((status) => {
            const colItems = visibleItems
              .filter((i) => i.status === status)
              .sort((a, b) => (a.publishDate ?? "9999").localeCompare(b.publishDate ?? "9999"));
            return (
              <div key={status} className="space-y-[8px]">
                <div className="flex items-center justify-between px-[2px]">
                  <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--lp-on-surface-variant)" }}>
                    {MEDIA_STATUS_LABELS[status]}
                  </span>
                  <span
                    className="text-[10px] font-bold rounded-full px-[7px]"
                    style={{ backgroundColor: "rgba(250, 204, 21, 0.10)", color: "var(--lp-primary)" }}
                  >
                    {colItems.length}
                  </span>
                </div>
                {colItems.map((it) => {
                  const meta = formatMeta(it.format);
                  const openDue = it.tasks
                    .filter((t) => t.status === "open" && t.dueDate)
                    .map((t) => t.dueDate as string)
                    .sort()[0];
                  const overdue = !!openDue && openDue < todayStr && it.status !== "published";
                  const dueToday = openDue === todayStr;
                  return (
                    <button
                      key={it.id}
                      onClick={() => openItem(it)}
                      className="w-full text-left rounded-[8px] border p-[10px] space-y-[6px]"
                      style={{
                        backgroundColor: "var(--lp-surface-container-low)",
                        borderColor: "var(--lp-outline-variant)",
                        opacity: it.status === "published" ? 0.65 : 1,
                      }}
                    >
                      <div className="flex items-center justify-between gap-[6px]">
                        <span
                          className="text-[9px] font-extrabold tracking-wider rounded-[4px] px-[6px] py-[2px]"
                          style={{ backgroundColor: tint(meta.color, 0.13), color: meta.color }}
                        >
                          {meta.pill}
                        </span>
                        {overdue ? (
                          <span className="text-[9px] font-extrabold" style={{ color: "var(--lp-error)" }}>
                            OVERDUE
                          </span>
                        ) : dueToday ? (
                          <span className="text-[9px] font-extrabold" style={{ color: "var(--lp-primary)" }}>
                            TODAY
                          </span>
                        ) : null}
                      </div>
                      <p className="text-[12px] font-semibold leading-snug" style={{ color: "var(--lp-on-surface)" }}>
                        {it.title}
                      </p>
                      <p className="text-[10px]" style={{ color: "var(--lp-outline)" }}>
                        {it.ownerId ? usernameById.get(it.ownerId) ?? "unassigned" : "unassigned"}
                        {it.publishDate ? ` · ${shortDate(it.publishDate)}` : ""}
                        {it.publishTime ? ` · ${it.publishTime}` : ""}
                      </p>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* Item drawer */}
      {draft && (
        <div
          className="fixed inset-0 z-50"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.55)" }}
          onClick={() => setDraft(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute right-0 top-0 h-full w-full max-w-[480px] overflow-y-auto border-l p-[20px] space-y-[14px] lp-scope"
            style={{
              backgroundColor: "var(--lp-surface, #171309)",
              borderColor: "rgba(245, 197, 24, 0.18)",
              color: "var(--lp-on-surface, #ebe2d0)",
            }}
          >
            <div className="flex items-center gap-[8px]">
              <span
                className="text-[9px] font-extrabold tracking-wider rounded-[4px] px-[7px] py-[3px]"
                style={{
                  backgroundColor: tint(formatMeta(draft.format).color, 0.15),
                  color: formatMeta(draft.format).color,
                }}
              >
                {formatMeta(draft.format).pill}
              </span>
              <span
                className="text-[9px] font-extrabold tracking-wider rounded-[4px] px-[7px] py-[3px]"
                style={{ backgroundColor: "rgba(51, 228, 255, 0.10)", color: "var(--lp-cyan)" }}
              >
                {MEDIA_STATUS_LABELS[draft.status].toUpperCase()}
              </span>
              <div className="grow" />
              <button
                onClick={() => setDraft(null)}
                aria-label="Close"
                className="w-[30px] h-[30px] rounded-[8px] border text-[14px]"
                style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface-variant)" }}
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-widest font-semibold mb-[4px]" style={{ color: "var(--lp-outline)" }}>
                Title
              </label>
              <input
                autoFocus={!draft.id}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="e.g. Nurse success story — reel"
                className={inputClass}
                style={inputStyle}
              />
            </div>

            <div className="grid grid-cols-2 gap-[10px]">
              <div>
                <label className="block text-[10px] uppercase tracking-widest font-semibold mb-[4px]" style={{ color: "var(--lp-outline)" }}>
                  Format
                </label>
                <select
                  value={draft.format}
                  onChange={(e) => setDraft({ ...draft, format: e.target.value as MediaFormat })}
                  className={inputClass}
                  style={inputStyle}
                >
                  {MEDIA_FORMAT_CODES.map((c) => (
                    <option key={c} value={c}>
                      {MEDIA_FORMATS[c].label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest font-semibold mb-[4px]" style={{ color: "var(--lp-outline)" }}>
                  Stage
                </label>
                <select
                  value={draft.status}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value as MediaItemStatus })}
                  className={inputClass}
                  style={inputStyle}
                >
                  {MEDIA_ITEM_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {MEDIA_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest font-semibold mb-[4px]" style={{ color: "var(--lp-outline)" }}>
                  Owner
                </label>
                <select
                  value={draft.ownerId}
                  onChange={(e) => setDraft({ ...draft, ownerId: e.target.value })}
                  className={inputClass}
                  style={inputStyle}
                >
                  <option value="">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.username}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest font-semibold mb-[4px]" style={{ color: "var(--lp-outline)" }}>
                  Publish slot (IST)
                </label>
                <input
                  type="time"
                  value={draft.publishTime}
                  onChange={(e) => setDraft({ ...draft, publishTime: e.target.value })}
                  className={`${inputClass} lp-date-input`}
                  style={inputStyle}
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest font-semibold mb-[4px]" style={{ color: "var(--lp-outline)" }}>
                  Shoot date
                </label>
                <input
                  type="date"
                  value={draft.shootDate}
                  onChange={(e) => setDraft({ ...draft, shootDate: e.target.value })}
                  className={`${inputClass} lp-date-input`}
                  style={inputStyle}
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest font-semibold mb-[4px]" style={{ color: "var(--lp-outline)" }}>
                  Publish date
                </label>
                <input
                  type="date"
                  value={draft.publishDate}
                  onChange={(e) => setDraft({ ...draft, publishDate: e.target.value })}
                  className={`${inputClass} lp-date-input`}
                  style={inputStyle}
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-widest font-semibold mb-[4px]" style={{ color: "var(--lp-outline)" }}>
                Hook &amp; caption
              </label>
              <textarea
                rows={3}
                value={draft.hook}
                onChange={(e) => setDraft({ ...draft, hook: e.target.value })}
                placeholder="The hook, the caption, hashtags…"
                className={`${inputClass} resize-none`}
                style={inputStyle}
              />
            </div>

            {draft.id === null ? (
              <label className="flex items-center gap-[8px] text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
                <input
                  type="checkbox"
                  checked={draft.seedChecklist}
                  onChange={(e) => setDraft({ ...draft, seedChecklist: e.target.checked })}
                />
                Seed the standard production checklist for this format
              </label>
            ) : (
              drawerItem && (
                <section
                  className="rounded-[12px] border p-[12px]"
                  style={{
                    backgroundColor: "var(--lp-surface-container)",
                    borderColor: "var(--lp-outline-variant)",
                  }}
                >
                  <div className="flex items-center justify-between mb-[4px]">
                    <h3 className="text-[10px] uppercase tracking-widest font-bold" style={{ color: "var(--lp-outline)" }}>
                      Production checklist
                    </h3>
                    <span className="text-[10px] font-bold" style={{ color: "var(--lp-primary)" }}>
                      {drawerItem.tasks.filter((t) => t.status === "done").length} of {drawerItem.tasks.length} done
                    </span>
                  </div>
                  <ul>
                    {drawerItem.tasks.map((t) => {
                      const done = t.status === "done";
                      const overdue = !done && !!t.dueDate && t.dueDate < todayStr;
                      return (
                        <li
                          key={t.id}
                          className="flex items-center gap-[8px] py-[7px] border-b last:border-b-0"
                          style={{ borderColor: "rgba(245, 197, 24, 0.10)" }}
                        >
                          <button
                            onClick={() =>
                              patchTask(drawerItem.id, t.id, { status: done ? "open" : "done" })
                            }
                            aria-label={done ? `Reopen ${t.name}` : `Mark ${t.name} done`}
                            className="shrink-0 w-[18px] h-[18px] rounded-full border flex items-center justify-center text-[11px] leading-none"
                            style={
                              done
                                ? { borderColor: "var(--lp-primary)", color: "var(--lp-primary)", backgroundColor: "rgba(250, 204, 21, 0.12)" }
                                : { borderColor: "var(--lp-outline)", color: "transparent" }
                            }
                          >
                            ✓
                          </button>
                          <span
                            className="min-w-0 grow text-[12.5px] font-semibold truncate"
                            style={{
                              color: done ? "var(--lp-outline)" : "var(--lp-on-surface)",
                              textDecoration: done ? "line-through" : "none",
                            }}
                          >
                            {t.name}
                          </span>
                          {overdue && (
                            <span className="text-[9px] font-extrabold" style={{ color: "var(--lp-error)" }}>
                              OVERDUE
                            </span>
                          )}
                          <input
                            type="date"
                            value={t.dueDate ?? ""}
                            onChange={(e) =>
                              patchTask(drawerItem.id, t.id, { dueDate: e.target.value || null })
                            }
                            className="lp-date-input rounded-[6px] px-[6px] py-[3px] text-[11px] border outline-none w-[118px]"
                            style={inputStyle}
                          />
                          <select
                            value={t.assignedToId ?? ""}
                            onChange={(e) =>
                              patchTask(drawerItem.id, t.id, { assignedToId: e.target.value || null })
                            }
                            className="rounded-[6px] px-[4px] py-[3px] text-[11px] border outline-none max-w-[90px]"
                            style={inputStyle}
                          >
                            <option value="">—</option>
                            {users.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.username}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => removeStep(drawerItem.id, t.id)}
                            aria-label={`Remove ${t.name}`}
                            className="shrink-0 text-[12px]"
                            style={{ color: "var(--lp-outline)" }}
                          >
                            ✕
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="flex gap-[8px] mt-[8px]">
                    <input
                      value={newStep}
                      onChange={(e) => setNewStep(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addStep();
                      }}
                      placeholder="Add a step…"
                      className="grow rounded-[8px] px-[10px] py-[6px] text-[12px] border outline-none"
                      style={inputStyle}
                    />
                    <button
                      onClick={addStep}
                      disabled={!newStep.trim()}
                      className="rounded-[8px] px-[12px] py-[6px] text-[12px] font-bold border"
                      style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-primary)" }}
                    >
                      Add
                    </button>
                  </div>
                  <p className="mt-[8px] text-[10px] leading-relaxed" style={{ color: "var(--lp-outline)" }}>
                    Steps with a due date get a 9:00 AM IST in-app reminder to their assignee, and show as
                    overdue here and on the calendar until ticked.
                  </p>
                </section>
              )
            )}

            <div className="flex items-center gap-[8px] pt-[4px]">
              {draft.id && (
                <button
                  onClick={deleteItem}
                  disabled={busy}
                  className="text-[12px] underline font-semibold"
                  style={{ color: "var(--lp-error)" }}
                >
                  Delete
                </button>
              )}
              <div className="grow" />
              {draft.id && draft.status !== "published" && (
                <button
                  onClick={markPublished}
                  disabled={busy}
                  className="rounded-[8px] px-[12px] py-[7px] text-[13px] font-semibold border"
                  style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface-variant)" }}
                >
                  Mark published
                </button>
              )}
              <button
                onClick={saveDraft}
                disabled={busy || !draft.title.trim()}
                className="rounded-[8px] px-[16px] py-[7px] text-[13px] font-bold disabled:opacity-50"
                style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
              >
                {busy ? "Saving…" : draft.id ? "Save changes" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
