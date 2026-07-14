"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export type MyTaskRow = {
  id: string;
  title: string;
  status: string;
  dueAt: string | null;
  completedByName: string | null;
  projectId: string;
  candidateName: string;
  serviceName: string;
  stepSeq: number | null;
  stepName: string | null;
};

const LABELS: Record<string, string> = {
  overdue: "Overdue",
  today: "Today",
  upcoming: "Upcoming",
  no_due: "No due date",
  done: "Recently done",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function MyTasksClient({ groups }: { groups: { key: string; rows: MyTaskRow[] }[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(r: MyTaskRow) {
    const done = r.status === "done";
    setBusyId(r.id);
    setError(null);
    const res = await fetch(`/api/operations/action-items/${r.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: done ? "reopen" : "complete" }),
    });
    setBusyId(null);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      setError(d.message || d.error || "Action failed.");
      return;
    }
    router.refresh();
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest p-xl text-center text-on-surface-variant">
        No tasks assigned to you.
      </div>
    );
  }

  return (
    <div className="space-y-lg">
      {error && <div className="text-label-sm text-error">{error}</div>}
      {groups.map((g) => (
        <section key={g.key}>
          <h2 className={"text-label-sm uppercase tracking-wider mb-sm " + (g.key === "overdue" ? "text-error" : "text-on-surface-variant")}>
            {LABELS[g.key] ?? g.key} · {g.rows.length}
          </h2>
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest divide-y divide-outline-variant/60">
            {g.rows.map((r) => {
              const done = r.status === "done" || r.status === "cancelled";
              return (
                <div key={r.id} className="px-md py-sm flex items-start gap-sm">
                  <button
                    disabled={r.status === "cancelled" || busyId === r.id}
                    onClick={() => toggle(r)}
                    title={r.status === "done" ? "Reopen" : "Mark done"}
                    className="mt-[1px] shrink-0 disabled:opacity-40"
                  >
                    <span className={"material-symbols-outlined text-[20px] leading-none " + (r.status === "done" ? "text-primary" : "text-on-surface-variant")}>
                      {r.status === "done" ? "check_box" : "check_box_outline_blank"}
                    </span>
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className={"text-body-sm " + (done ? "line-through text-on-surface-variant" : "text-on-surface")}>{r.title}</div>
                    <div className="text-label-sm text-on-surface-variant">
                      <Link href={`/operations/projects/${r.projectId}`} className="text-primary hover:underline">
                        {r.candidateName}
                      </Link>
                      {" · "}
                      {r.serviceName}
                      {r.stepName && <> · step {r.stepSeq}: {r.stepName}</>}
                      {r.dueAt && <> · due {fmtDate(r.dueAt)}</>}
                      {r.status === "cancelled" && <> · cancelled</>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
