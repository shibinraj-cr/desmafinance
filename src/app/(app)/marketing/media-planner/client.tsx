"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  MEDIA_CATEGORIES,
  MEDIA_CATEGORY_CODES,
  MEDIA_ITEM_STATUSES,
  MEDIA_PLATFORMS,
  MEDIA_PLATFORM_CODES,
  MEDIA_STATUS_LABELS,
  MEDIA_THUMBNAIL_MAX_BYTES,
  MEDIA_THUMBNAIL_TYPES,
  categoryLabel,
  isSafeHttpUrl,
  linkPlatform,
  platformMeta,
  type MediaCategory,
  type MediaItemDto,
  type MediaPlatform,
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

/** Filter value for items nobody has filed under a category yet. */
const UNCATEGORISED = "none";

/**
 * The same post on several platforms is one item per platform. In the
 * all-platforms calendar those siblings collapse into one chip — same title,
 * day, slot and category — so a day reads as posts, not as 4× duplicates.
 */
function postKey(it: MediaItemDto): string {
  return [it.title.trim().toLowerCase(), it.publishDate ?? "", it.publishTime ?? "", it.category ?? ""].join("|");
}

function platformOrder(p: string): number {
  const i = (MEDIA_PLATFORM_CODES as readonly string[]).indexOf(p);
  return i < 0 ? 99 : i;
}

/** Small platform tag (YT / IG / FB / IN). */
function PlatformPill({ platform, size = 8.5 }: { platform: string; size?: number }) {
  const meta = platformMeta(platform);
  return (
    <span
      className="shrink-0 rounded-[3px] px-[3px] font-extrabold tracking-wider leading-[1.35]"
      style={{ backgroundColor: tint(meta.color, 0.2), color: meta.color, fontSize: size }}
      title={meta.label}
    >
      {meta.pill}
    </span>
  );
}

/** rgba() tint of a #rrggbb accent, for chip fills and borders. */
function tint(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * A cover image that quietly disappears when it can't load — a YouTube
 * thumbnail 404s until the video goes public, and a cell shouldn't show a
 * broken-image icon for a scheduled Short.
 */
function Thumb({
  src,
  className,
  style,
}: {
  src: string | null;
  className: string;
  style?: CSSProperties;
}) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  // i.ytimg.com answers a not-yet-public video with a 404 that still carries a
  // 120×90 grey placeholder, so onError never fires for it.
  const unusable = (img: HTMLImageElement) =>
    img.naturalWidth === 0 ||
    (!!src && src.includes("i.ytimg.com") && img.naturalWidth === 120 && img.naturalHeight === 90);

  useEffect(() => {
    setFailed(false);
    // A cached image can finish loading before hydration attaches onLoad and
    // onError, so check whatever has already settled.
    const img = ref.current;
    if (img?.complete && unusable(img)) setFailed(true);
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!src || failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={src}
      alt=""
      onError={() => setFailed(true)}
      onLoad={(e) => {
        if (unusable(e.currentTarget)) setFailed(true);
      }}
      className={`${className} object-cover shrink-0`}
      style={style}
    />
  );
}

/** Open-link icon that doesn't trigger the chip/card it sits in. */
function LinkOut({ href, size = 11 }: { href: string; size?: number }) {
  if (!isSafeHttpUrl(href)) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={`Open on ${linkPlatform(href)}`}
      aria-label={`Open on ${linkPlatform(href)}`}
      className="shrink-0 leading-none hover:opacity-100 opacity-70"
      style={{ color: "var(--lp-primary)", fontSize: size }}
    >
      ↗
    </a>
  );
}

type Draft = {
  id: string | null;
  title: string;
  /** The item's platform (edit), or every platform to create it on (new). */
  platforms: MediaPlatform[];
  category: MediaCategory | "";
  status: MediaItemStatus;
  publishDate: string;
  publishTime: string;
  shootDate: string;
  hook: string;
  link: string;
  ownerId: string;
  seedChecklist: boolean;
};

function draftFromItem(item: MediaItemDto): Draft {
  return {
    id: item.id,
    title: item.title,
    platforms: [(item.platform as MediaPlatform) ?? "youtube"],
    category: (item.category as MediaCategory | null) ?? "",
    status: (item.status as MediaItemStatus) ?? "idea",
    publishDate: item.publishDate ?? "",
    publishTime: item.publishTime ?? "",
    shootDate: item.shootDate ?? "",
    hook: item.hook ?? "",
    link: item.link ?? "",
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
  // "" = every platform; otherwise one platform's own calendar.
  const [platformFilter, setPlatformFilter] = useState<MediaPlatform | "">("");
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [ownerFilter, setOwnerFilter] = useState<string>("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [newStep, setNewStep] = useState("");
  const [busy, setBusy] = useState(false);
  const thumbInput = useRef<HTMLInputElement>(null);
  // Days whose cell is expanded to list every item instead of the first four.
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set());
  const toggleDay = (d: string) =>
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });

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

  const matchesCategory = (it: MediaItemDto) =>
    categoryFilter.length === 0 || categoryFilter.includes(it.category ?? UNCATEGORISED);
  const matchesFilters = (it: MediaItemDto) =>
    (!platformFilter || it.platform === platformFilter) &&
    matchesCategory(it) &&
    (!ownerFilter || it.ownerId === ownerFilter);

  const visibleItems = useMemo(() => items.filter(matchesFilters), [items, platformFilter, categoryFilter, ownerFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter-chip counts for the month on screen: platforms count under the
  // category filter, categories under the platform filter.
  const monthPrefixForCounts = `${year}-${String(month).padStart(2, "0")}`;
  const filterCounts = useMemo(() => {
    const platforms = new Map<string, number>();
    const categories = new Map<string, number>();
    for (const it of items) {
      if (!it.publishDate?.startsWith(monthPrefixForCounts)) continue;
      if (ownerFilter && it.ownerId !== ownerFilter) continue;
      if (matchesCategory(it)) platforms.set(it.platform, (platforms.get(it.platform) ?? 0) + 1);
      if (!platformFilter || it.platform === platformFilter) {
        const c = it.category ?? UNCATEGORISED;
        categories.set(c, (categories.get(c) ?? 0) + 1);
      }
    }
    return { platforms, categories };
  }, [items, monthPrefixForCounts, ownerFilter, platformFilter, categoryFilter]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Calendar entries per day: one per post (its platform items grouped) when
  // showing every platform, one per item when a single platform is picked.
  const itemsByDate = useMemo(() => {
    const m = new Map<string, MediaItemDto[][]>();
    const byKey = new Map<string, MediaItemDto[]>();
    for (const it of visibleItems) {
      if (!it.publishDate) continue;
      const key = platformFilter ? it.id : postKey(it);
      let group = byKey.get(key);
      if (!group) {
        group = [];
        byKey.set(key, group);
        const arr = m.get(it.publishDate) ?? [];
        arr.push(group);
        m.set(it.publishDate, arr);
      }
      group.push(it);
    }
    for (const group of Array.from(byKey.values())) {
      group.sort((a, b) => platformOrder(a.platform) - platformOrder(b.platform));
    }
    // Within a day, in posting order; untimed items last.
    for (const arr of Array.from(m.values())) {
      arr.sort((a, b) => (a[0].publishTime ?? "99:99").localeCompare(b[0].publishTime ?? "99:99"));
    }
    return m;
  }, [visibleItems, platformFilter]);

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

  // Posts going out this week, per platform and per category.
  const cadence = useMemo(() => {
    const week = items.filter((i) => i.publishDate && i.publishDate >= weekStart && i.publishDate <= weekEnd);
    const platforms = MEDIA_PLATFORM_CODES.map((code) => ({
      code,
      count: week.filter((i) => i.platform === code).length,
    }));
    const categories = [...MEDIA_CATEGORY_CODES, UNCATEGORISED]
      .map((code) => ({
        code,
        count: week.filter((i) => (i.category ?? UNCATEGORISED) === code).length,
      }))
      .filter((c) => c.count > 0 || c.code !== UNCATEGORISED);
    const max = Math.max(1, ...platforms.map((p) => p.count));
    return { platforms, categories, max };
  }, [items, weekStart, weekEnd]);

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
      platforms: platformFilter ? [platformFilter] : [...MEDIA_PLATFORM_CODES],
      category: "",
      status: "idea",
      publishDate: publishDate ?? todayStr,
      publishTime: "",
      shootDate: "",
      hook: "",
      link: "",
      ownerId: selfId,
      seedChecklist: true,
    });
  }

  function openItem(item: MediaItemDto) {
    setNewStep("");
    setDraft(draftFromItem(item));
  }

  const drawerItem = draft?.id ? items.find((i) => i.id === draft.id) ?? null : null;
  // The same post's items on the other platforms.
  const siblings = useMemo(() => {
    if (!drawerItem) return [];
    const key = postKey(drawerItem);
    return items
      .filter((i) => i.id !== drawerItem.id && postKey(i) === key)
      .sort((a, b) => platformOrder(a.platform) - platformOrder(b.platform));
  }, [drawerItem, items]);

  // ---- API calls ----
  async function saveDraft() {
    if (!draft || !draft.title.trim()) return;
    if (draft.platforms.length === 0) {
      alert("Pick at least one platform.");
      return;
    }
    if (draft.link.trim() && !isSafeHttpUrl(draft.link.trim())) {
      alert("The link must start with https:// (or http://).");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        title: draft.title.trim(),
        category: draft.category || null,
        status: draft.status,
        publishDate: draft.publishDate || null,
        publishTime: draft.publishTime || null,
        shootDate: draft.shootDate || null,
        hook: draft.hook || null,
        link: draft.link.trim() || null,
        ownerId: draft.ownerId || null,
        ...(draft.id ? {} : { seedChecklist: draft.seedChecklist }),
      };
      // A new post is created once per chosen platform; an edit changes one item.
      const targets = draft.id ? [draft.platforms[0]] : draft.platforms;
      let failed = 0;
      for (const platform of targets) {
        const res = await fetch(
          draft.id ? `/api/marketing/media-plan/${draft.id}` : "/api/marketing/media-plan",
          {
            method: draft.id ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, platform }),
          },
        );
        if (!res.ok) {
          failed += 1;
          continue;
        }
        const { item } = (await res.json()) as { item: MediaItemDto };
        replaceItem(item);
      }
      if (failed) {
        alert(failed === targets.length ? "Failed to save." : `Saved, but ${failed} platform(s) failed.`);
        return;
      }
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

  async function uploadThumbnail(file: File) {
    if (!draft?.id) return;
    if (!(MEDIA_THUMBNAIL_TYPES as readonly string[]).includes(file.type)) {
      alert("Thumbnail must be a JPEG, PNG or WebP image.");
      return;
    }
    if (file.size > MEDIA_THUMBNAIL_MAX_BYTES) {
      alert("Thumbnail must be under 2 MB.");
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`/api/marketing/media-plan/${draft.id}/thumbnail`, { method: "POST", body });
      if (!res.ok) {
        alert("Failed to upload the thumbnail.");
        return;
      }
      const { item } = (await res.json()) as { item: MediaItemDto };
      replaceItem(item);
    } finally {
      setBusy(false);
    }
  }

  async function removeThumbnail() {
    if (!draft?.id) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/marketing/media-plan/${draft.id}/thumbnail`, { method: "DELETE" });
      if (!res.ok) {
        alert("Failed to remove the thumbnail.");
        return;
      }
      const { item } = (await res.json()) as { item: MediaItemDto };
      replaceItem(item);
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
            Plan, produce and publish — YouTube, Instagram, Facebook and LinkedIn, by content category.
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

      {/* Filters: platform tabs, then category chips */}
      <div className="flex flex-wrap items-center gap-[8px]">
        {(["", ...MEDIA_PLATFORM_CODES] as const).map((code) => {
          const active = platformFilter === code;
          const meta = code ? MEDIA_PLATFORMS[code] : null;
          const color = meta?.color ?? "#facc15";
          const count = code
            ? filterCounts.platforms.get(code) ?? 0
            : Array.from(filterCounts.platforms.values()).reduce((a, b) => a + b, 0);
          return (
            <button
              key={code || "all"}
              onClick={() => setPlatformFilter(code)}
              className="flex items-center gap-[7px] rounded-[8px] px-[14px] py-[7px] text-[13px] font-bold border"
              style={
                active
                  ? { borderColor: color, color, backgroundColor: tint(color, 0.13) }
                  : { borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface-variant)" }
              }
            >
              {meta && <span className="inline-block w-[8px] h-[8px] rounded-full" style={{ backgroundColor: meta.color }} />}
              {meta ? meta.label : "All platforms"}
              <span className="text-[11px] font-mono font-semibold opacity-75">{count}</span>
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
      <div className="flex flex-wrap items-center gap-[6px]">
        <button
          onClick={() => setCategoryFilter([])}
          className="rounded-full px-[11px] py-[4px] text-[11.5px] font-semibold border"
          style={
            categoryFilter.length === 0
              ? { borderColor: "var(--lp-primary)", color: "var(--lp-primary)", backgroundColor: "rgba(250, 204, 21, 0.10)" }
              : { borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface-variant)" }
          }
        >
          All categories
        </button>
        {[...MEDIA_CATEGORY_CODES, UNCATEGORISED].map((code) => {
          const count = filterCounts.categories.get(code) ?? 0;
          if (code === UNCATEGORISED && count === 0 && !categoryFilter.includes(code)) return null;
          const active = categoryFilter.includes(code);
          return (
            <button
              key={code}
              onClick={() =>
                setCategoryFilter((arr) => (arr.includes(code) ? arr.filter((c) => c !== code) : [...arr, code]))
              }
              className="rounded-full px-[11px] py-[4px] text-[11.5px] font-semibold border"
              style={
                active
                  ? { borderColor: "var(--lp-primary)", color: "var(--lp-primary)", backgroundColor: "rgba(250, 204, 21, 0.10)" }
                  : { borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface-variant)", opacity: count ? 1 : 0.55 }
              }
            >
              {code === UNCATEGORISED ? "Uncategorised" : MEDIA_CATEGORIES[code as MediaCategory].label}
              <span className="ml-[6px] font-mono opacity-75">{count}</span>
            </button>
          );
        })}
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
                const expanded = expandedDays.has(c.date);
                const shown = expanded ? dayItems : dayItems.slice(0, 4);
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
                    <div className="flex flex-col gap-[3px] overflow-hidden min-w-0">
                      {shown.map((group) => {
                        const it = group[0];
                        const meta = platformMeta(it.platform);
                        const done = group.every((g) => g.status === "published");
                        const multi = group.length > 1;
                        const accent = multi ? "#facc15" : meta.color;
                        return (
                          <div
                            key={it.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => openItem(it)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                openItem(it);
                              }
                            }}
                            className="flex items-stretch gap-[5px] rounded-[6px] pl-[3px] pr-[5px] py-[3px] text-[10.5px] font-semibold text-left border cursor-pointer min-w-0"
                            style={{
                              backgroundColor: tint(accent, multi ? 0.07 : 0.13),
                              borderColor: tint(accent, 0.3),
                              color: "var(--lp-on-surface)",
                              opacity: done ? 0.6 : 1,
                            }}
                            title={`${group.map((g) => platformMeta(g.platform).label).join(", ")} · ${categoryLabel(it.category)}${it.publishTime ? ` · ${it.publishTime}` : ""} — ${it.title}`}
                          >
                            <span
                              className="inline-block w-[3px] self-stretch rounded-full shrink-0"
                              style={{ backgroundColor: accent }}
                            />
                            <Thumb src={it.thumbnailUrl} className="w-[20px] h-[34px] rounded-[3px]" />
                            <span className="min-w-0 grow">
                              <span className="leading-[1.2] line-clamp-2 break-words">
                                {done ? `✓ ${it.title}` : it.title}
                              </span>
                              <span className="flex flex-wrap items-center gap-[3px] mt-[2px]">
                                {group.map((g) => (
                                  <PlatformPill key={g.id} platform={g.platform} />
                                ))}
                                {it.category && (
                                  <span className="text-[9px] font-normal truncate" style={{ color: "var(--lp-outline)" }}>
                                    {categoryLabel(it.category, "short")}
                                  </span>
                                )}
                              </span>
                              {(it.publishTime || it.link) && (
                                <span className="flex items-center gap-[4px] mt-[1px]">
                                  {it.publishTime && (
                                    <span className="font-mono text-[9.5px] font-normal" style={{ color: "var(--lp-outline)" }}>
                                      {it.publishTime}
                                    </span>
                                  )}
                                  {it.link && <LinkOut href={it.link} size={10} />}
                                </span>
                              )}
                            </span>
                          </div>
                        );
                      })}
                      {dayItems.length > 4 && (
                        <button
                          onClick={() => toggleDay(c.date)}
                          className="text-left text-[10px] font-semibold"
                          style={{ color: "var(--lp-primary)" }}
                        >
                          {expanded ? "Show less" : `+${dayItems.length - 4} more`}
                        </button>
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
                            {platformMeta(item.platform).label} · {categoryLabel(item.category, "short")}
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
                  This week
                </h2>
                <span className="text-[10px]" style={{ color: "var(--lp-outline)" }}>
                  {shortDate(weekStart)} – {shortDate(weekEnd)}
                </span>
              </div>
              {cadence.platforms.map((c) => {
                const meta = MEDIA_PLATFORMS[c.code];
                return (
                  <div key={c.code}>
                    <div className="flex items-center justify-between mb-[4px]">
                      <span className="flex items-center gap-[7px] text-[11.5px] font-semibold" style={{ color: "var(--lp-on-surface-variant)" }}>
                        <span className="inline-block w-[7px] h-[7px] rounded-full" style={{ backgroundColor: meta.color }} />
                        {meta.label}
                      </span>
                      <span className="text-[11.5px] font-bold font-mono" style={{ color: "var(--lp-on-surface)" }}>
                        {c.count}
                      </span>
                    </div>
                    <div className="h-[5px] rounded-full overflow-hidden" style={{ backgroundColor: "rgba(255, 255, 255, 0.07)" }}>
                      <div
                        className="h-full rounded-full"
                        style={{ backgroundColor: meta.color, width: `${Math.round((c.count / cadence.max) * 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              <div className="pt-[4px] space-y-[3px]">
                {cadence.categories.map((c) => (
                  <div key={c.code} className="flex items-center justify-between text-[11px]">
                    <span style={{ color: "var(--lp-on-surface-variant)", opacity: c.count ? 1 : 0.5 }}>
                      {c.code === UNCATEGORISED ? "Uncategorised" : MEDIA_CATEGORIES[c.code as MediaCategory].label}
                    </span>
                    <span className="font-mono font-bold" style={{ color: c.count ? "var(--lp-on-surface)" : "var(--lp-outline)" }}>
                      {c.count}
                    </span>
                  </div>
                ))}
              </div>
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
                  const meta = platformMeta(it.platform);
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
                        <span className="flex items-center gap-[5px] min-w-0">
                          <span
                            className="text-[9px] font-extrabold tracking-wider rounded-[4px] px-[6px] py-[2px]"
                            style={{ backgroundColor: tint(meta.color, 0.13), color: meta.color }}
                          >
                            {meta.pill}
                          </span>
                          <span className="text-[9.5px] truncate" style={{ color: "var(--lp-outline)" }}>
                            {categoryLabel(it.category, "short")}
                          </span>
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
                      <div className="flex items-start gap-[8px]">
                        <Thumb src={it.thumbnailUrl} className="w-[36px] h-[56px] rounded-[5px]" />
                        <p className="min-w-0 grow text-[12px] font-semibold leading-snug" style={{ color: "var(--lp-on-surface)" }}>
                          {it.title}
                        </p>
                        {it.link && <LinkOut href={it.link} size={13} />}
                      </div>
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
                  backgroundColor: tint(platformMeta(draft.platforms[0] ?? "").color, 0.15),
                  color: platformMeta(draft.platforms[0] ?? "").color,
                }}
              >
                {draft.id
                  ? platformMeta(draft.platforms[0]).label.toUpperCase()
                  : `${draft.platforms.length} PLATFORM${draft.platforms.length === 1 ? "" : "S"}`}
              </span>
              {draft.category && (
                <span
                  className="text-[9px] font-extrabold tracking-wider rounded-[4px] px-[7px] py-[3px]"
                  style={{ backgroundColor: "rgba(250, 204, 21, 0.10)", color: "var(--lp-primary)" }}
                >
                  {categoryLabel(draft.category, "short").toUpperCase()}
                </span>
              )}
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

            <div>
              <label className="block text-[10px] uppercase tracking-widest font-semibold mb-[4px]" style={{ color: "var(--lp-outline)" }}>
                {draft.id ? "Platform" : "Platforms — one item per platform"}
              </label>
              <div className="flex flex-wrap gap-[6px]">
                {MEDIA_PLATFORM_CODES.map((code) => {
                  const meta = MEDIA_PLATFORMS[code];
                  const on = draft.platforms.includes(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          platforms: draft.id
                            ? [code]
                            : on
                              ? draft.platforms.filter((p) => p !== code)
                              : MEDIA_PLATFORM_CODES.filter((p) => p === code || draft.platforms.includes(p)),
                        })
                      }
                      className="flex items-center gap-[6px] rounded-[8px] px-[11px] py-[6px] text-[12px] font-semibold border"
                      style={
                        on
                          ? { borderColor: meta.color, color: meta.color, backgroundColor: tint(meta.color, 0.13) }
                          : { borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface-variant)" }
                      }
                    >
                      <span className="inline-block w-[7px] h-[7px] rounded-full" style={{ backgroundColor: meta.color }} />
                      {meta.label}
                    </button>
                  );
                })}
              </div>
              {drawerItem && siblings.length > 0 && (
                <p className="mt-[6px] flex flex-wrap items-center gap-[6px] text-[11px]" style={{ color: "var(--lp-outline)" }}>
                  Same post on:
                  {siblings.map((sib) => (
                    <button
                      key={sib.id}
                      type="button"
                      onClick={() => openItem(sib)}
                      className="underline-offset-2 hover:underline font-semibold"
                      style={{ color: platformMeta(sib.platform).color }}
                    >
                      {platformMeta(sib.platform).label}
                    </button>
                  ))}
                </p>
              )}
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-widest font-semibold mb-[4px]" style={{ color: "var(--lp-outline)" }}>
                Category
              </label>
              <select
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value as MediaCategory | "" })}
                className={inputClass}
                style={inputStyle}
              >
                <option value="">Uncategorised</option>
                {MEDIA_CATEGORY_CODES.map((c) => (
                  <option key={c} value={c}>
                    {MEDIA_CATEGORIES[c].label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-[10px]">
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

            <div>
              <label className="block text-[10px] uppercase tracking-widest font-semibold mb-[4px]" style={{ color: "var(--lp-outline)" }}>
                Post link
              </label>
              <div className="flex gap-[8px]">
                <input
                  type="url"
                  value={draft.link}
                  onChange={(e) => setDraft({ ...draft, link: e.target.value })}
                  placeholder="https://youtube.com/shorts/… or the Instagram post"
                  className={inputClass}
                  style={inputStyle}
                />
                {draft.link.trim() && isSafeHttpUrl(draft.link.trim()) && (
                  <a
                    href={draft.link.trim()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 rounded-[8px] px-[10px] py-[8px] text-[12px] font-bold border whitespace-nowrap"
                    style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-primary)" }}
                  >
                    Open {linkPlatform(draft.link.trim())} ↗
                  </a>
                )}
              </div>
            </div>

            {draft.id && drawerItem && (
              <div>
                <label className="block text-[10px] uppercase tracking-widest font-semibold mb-[4px]" style={{ color: "var(--lp-outline)" }}>
                  Thumbnail
                </label>
                <div className="flex items-end gap-[12px]">
                  {drawerItem.thumbnailUrl ? (
                    <Thumb
                      src={drawerItem.thumbnailUrl}
                      className="w-[90px] h-[160px] rounded-[8px] border"
                      style={{ borderColor: "var(--lp-outline-variant)" }}
                    />
                  ) : (
                    <div
                      className="w-[90px] h-[160px] rounded-[8px] border border-dashed flex items-center justify-center text-[10px] text-center px-[6px]"
                      style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-outline)" }}
                    >
                      No thumbnail
                    </div>
                  )}
                  <div className="space-y-[6px]">
                    <input
                      ref={thumbInput}
                      type="file"
                      accept={MEDIA_THUMBNAIL_TYPES.join(",")}
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) uploadThumbnail(f);
                      }}
                    />
                    <button
                      onClick={() => thumbInput.current?.click()}
                      disabled={busy}
                      className="block rounded-[8px] px-[12px] py-[6px] text-[12px] font-bold border"
                      style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-primary)" }}
                    >
                      {drawerItem.hasUploadedThumbnail ? "Replace image" : "Upload image"}
                    </button>
                    {drawerItem.hasUploadedThumbnail && (
                      <button
                        onClick={removeThumbnail}
                        disabled={busy}
                        className="block text-[11px] underline"
                        style={{ color: "var(--lp-outline)" }}
                      >
                        Remove
                      </button>
                    )}
                    <p className="text-[10px] leading-relaxed max-w-[220px]" style={{ color: "var(--lp-outline)" }}>
                      JPEG, PNG or WebP, under 2 MB. A YouTube link shows YouTube&apos;s thumbnail once the video is public.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {draft.id === null ? (
              <label className="flex items-center gap-[8px] text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
                <input
                  type="checkbox"
                  checked={draft.seedChecklist}
                  onChange={(e) => setDraft({ ...draft, seedChecklist: e.target.checked })}
                />
                Seed the standard production checklist for this category
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
