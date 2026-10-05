"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";
import { btnGhost, btnPrimary, inputCls, PublishPill } from "@/components/sales-training/ui";

type Row = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  videos: number;
  thumb: string | null;
  questions: number;
  passMark: number;
  maxAttempts: number | null;
  passed: number;
};

export function ModulesClient({ modules, canEdit }: { modules: Row[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  async function create() {
    setError(null);
    const res = await fetch("/api/hr/sales-training/modules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setError(j.error || "Could not create the module.");
    router.push(`/hr/sales-training/modules/${j.id}`);
  }

  async function move(index: number, dir: -1 | 1) {
    const ids = modules.map((m) => m.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    const res = await fetch("/api/hr/sales-training/modules", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) return setError("Could not reorder.");
    start(() => router.refresh());
  }

  const visible = modules.filter((m) => showArchived || m.status !== "archived");
  const archived = modules.length - modules.filter((m) => m.status !== "archived").length;
  let liveNo = 0;

  return (
    <div className="space-y-lg">
      {canEdit && (
        <Section title="New module">
          <div className="flex flex-col md:flex-row gap-sm">
            <input
              className={inputCls + " flex-1"}
              placeholder="e.g. Handling the price objection"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && title.trim() && create()}
            />
            <button className={btnPrimary} disabled={!title.trim() || pending} onClick={create}>
              <span className="material-symbols-outlined text-[18px]">add</span>
              Create &amp; add content
            </button>
          </div>
          {error && <p className="text-red-700 text-label-sm mt-sm">{error}</p>}
        </Section>
      )}

      <Section
        title="Curriculum"
        action={
          archived > 0 ? (
            <label className="flex items-center gap-xs text-label-sm text-on-surface-variant">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              Show {archived} archived
            </label>
          ) : undefined
        }
      >
        {visible.length === 0 ? (
          <p className="py-lg text-center text-on-surface-variant">No modules yet — create the first one above.</p>
        ) : (
          <ul className="divide-y divide-outline-variant">
            {visible.map((m) => {
              const idx = modules.indexOf(m);
              const label = m.status === "published" ? `M${++liveNo}` : "—";
              return (
                <li key={m.id} className="py-md flex items-center gap-md">
                  {canEdit && (
                    <div className="flex flex-col">
                      <button aria-label="Move up" className="text-on-surface-variant disabled:opacity-30" disabled={pending || idx === 0} onClick={() => move(idx, -1)}>
                        <span className="material-symbols-outlined text-[18px]">expand_less</span>
                      </button>
                      <button aria-label="Move down" className="text-on-surface-variant disabled:opacity-30" disabled={pending || idx === modules.length - 1} onClick={() => move(idx, 1)}>
                        <span className="material-symbols-outlined text-[18px]">expand_more</span>
                      </button>
                    </div>
                  )}
                  <span className="w-8 text-label-sm font-bold text-on-surface-variant">{label}</span>
                  {m.thumb ? (
                    <img src={`https://i.ytimg.com/vi/${m.thumb}/mqdefault.jpg`} alt="" className="hidden md:block w-28 aspect-video rounded object-cover bg-surface-container" />
                  ) : (
                    <div className="hidden md:flex w-28 aspect-video rounded bg-surface-container items-center justify-center text-on-surface-variant">
                      <span className="material-symbols-outlined">video_library</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-sm flex-wrap">
                      <Link href={`/hr/sales-training/modules/${m.id}`} className="font-semibold text-on-surface hover:underline truncate">
                        {m.title}
                      </Link>
                      <PublishPill status={m.status} />
                    </div>
                    <p className="text-label-sm text-on-surface-variant mt-[2px]">
                      {m.videos} video{m.videos === 1 ? "" : "s"} · {m.questions} question{m.questions === 1 ? "" : "s"} · pass ≥ {m.passMark}% ·{" "}
                      {m.maxAttempts ? `${m.maxAttempts} attempts` : "unlimited attempts"} · {m.passed} passed
                    </p>
                  </div>
                  <Link href={`/hr/sales-training/modules/${m.id}`} className={btnGhost}>
                    {canEdit ? "Edit" : "View"}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
