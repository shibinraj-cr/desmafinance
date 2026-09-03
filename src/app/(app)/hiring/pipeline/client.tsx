"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshBar } from "@/components/hiring/RefreshBar";
import { CandidateDrawer } from "@/components/hiring/CandidateDrawer";
import type { ApplicationRowDTO } from "@/lib/hiring/candidates";
import { groupCardsByPosition, stageForJobAtPosition, type BoardColumn, type StageLite } from "@/lib/hiring/board";

type Lite = { id: string; title?: string; username?: string };
type Filters = { jobId: string; ownerId: string; department: string };

const btn =
  "h-9 px-md rounded-lg border border-outline-variant text-label-sm text-on-surface-variant hover:bg-surface-container-low transition disabled:opacity-60";
const primaryBtn =
  "h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold hover:bg-primary-container transition disabled:opacity-60";
const selectCls =
  "h-9 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md";

export function PipelineClient({
  columns,
  stages,
  cards,
  jobs,
  owners,
  departments,
  filters,
  canMove,
  canWrite,
  loadedAt,
}: {
  columns: BoardColumn[];
  stages: StageLite[];
  cards: ApplicationRowDTO[];
  jobs: Lite[];
  owners: Lite[];
  departments: string[];
  filters: Filters;
  canMove: boolean;
  canWrite: boolean;
  loadedAt: string;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ card: ApplicationRowDTO; position: number } | null>(null);
  const [reason, setReason] = useState("");

  const byPosition = useMemo(() => groupCardsByPosition(cards, columns), [cards, columns]);

  function go(next: Partial<Filters>) {
    const merged = { ...filters, ...next };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    router.push(qs ? `/hiring/pipeline?${qs}` : "/hiring/pipeline");
  }

  /**
   * Moving a card to a board column resolves to THIS card's job's stage at that
   * position — the board's columns are positions, not stages.
   */
  async function moveCard(card: ApplicationRowDTO, position: number, withReason?: string) {
    const stage = stageForJobAtPosition(stages, card.jobId, position);
    if (!stage) {
      setError(`${card.jobTitle} has no stage at that position, so this card cannot go there.`);
      return;
    }
    if (stage.id === card.stageId) return;
    if (stage.kind === "lost" && !withReason) {
      setPending({ card, position });
      return;
    }

    setBusy(true);
    setError(null);
    const res = await fetch(`/api/hiring/applications/${card.id}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toStageId: stage.id, reason: withReason ?? null }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string };
      setError(d.message ?? "That move did not save — the board has not changed.");
      return;
    }
    setPending(null);
    setReason("");
    router.refresh();
  }

  async function bulkMove(position: number) {
    const chosen = cards.filter((c) => selected.has(c.id));
    if (!chosen.length) return;
    setBusy(true);
    setError(null);

    // Each job resolves its own stage at this position, so one bulk action can
    // span requisitions with differently-named pipelines.
    const byJob = new Map<string, string[]>();
    for (const c of chosen) {
      const stage = stageForJobAtPosition(stages, c.jobId, position);
      if (!stage) continue;
      if (!byJob.has(stage.id)) byJob.set(stage.id, []);
      byJob.get(stage.id)!.push(c.id);
    }

    let moved = 0;
    const failures: string[] = [];
    for (const [stageId, ids] of byJob) {
      const res = await fetch("/api/hiring/applications/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ applicationIds: ids, action: "move", toStageId: stageId }),
      });
      if (!res.ok) {
        failures.push(`${ids.length} could not be moved.`);
        continue;
      }
      const d = (await res.json()) as { moved: number; failures: { message: string }[] };
      moved += d.moved;
      for (const f of d.failures) failures.push(f.message);
    }

    setBusy(false);
    setSelected(new Set());
    if (failures.length) setError(`Moved ${moved}. ${failures.length} did not move: ${failures[0]}`);
    router.refresh();
  }

  const totalShown = cards.length;

  return (
    <div className="space-y-lg">
      {error && (
        <div role="alert" className="rounded-lg border border-error bg-error-container px-md py-sm text-body-md text-on-error-container">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-sm">
        <select className={selectCls} value={filters.jobId} onChange={(e) => go({ jobId: e.target.value })} aria-label="Requisition">
          <option value="">Every open requisition</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.title}
            </option>
          ))}
        </select>
        <select className={selectCls} value={filters.department} onChange={(e) => go({ department: e.target.value })} aria-label="Department">
          <option value="">Every department</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select className={selectCls} value={filters.ownerId} onChange={(e) => go({ ownerId: e.target.value })} aria-label="Requisition owner">
          <option value="">Any owner</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.username}
            </option>
          ))}
        </select>
        <div className="ml-auto">
          <RefreshBar loadedAt={loadedAt} label={`${totalShown} in play`} />
        </div>
      </div>

      {selected.size > 0 && canMove && (
        <div className="rounded-xl border border-outline-variant bg-surface-container-low p-md flex flex-wrap items-center gap-sm">
          <span className="text-body-md text-on-surface">
            {selected.size} selected
          </span>
          <label className="text-label-sm text-on-surface-variant" htmlFor="bulk-move">
            Move to
          </label>
          <select
            id="bulk-move"
            className={selectCls}
            defaultValue=""
            disabled={busy}
            onChange={(e) => {
              if (e.target.value === "") return;
              void bulkMove(Number(e.target.value));
              e.target.value = "";
            }}
          >
            <option value="">Choose a stage…</option>
            {columns
              .filter((c) => c.kind !== "lost")
              .map((c) => (
                <option key={c.position} value={c.position}>
                  {c.label}
                </option>
              ))}
          </select>
          <button type="button" className={btn} onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
          <p className="text-caption text-on-surface-variant w-full">
            Each requisition resolves its own stage at that position, so a bulk move works across
            reqs with differently-named pipelines. Rejections are done one at a time — they need a reason.
          </p>
        </div>
      )}

      {pending && (
        <div className="rounded-xl border border-outline-variant bg-surface-container-low p-md">
          <label className="block text-label-sm text-on-surface-variant mb-xs" htmlFor="board-reject-reason">
            Why is {pending.card.fullName} not moving forward?
          </label>
          <input
            id="board-reject-reason"
            className="w-full max-w-lg h-9 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
          />
          <div className="mt-sm flex gap-xs">
            <button
              type="button"
              className={primaryBtn}
              disabled={!reason.trim() || busy}
              onClick={() => moveCard(pending.card, pending.position, reason)}
            >
              Reject
            </button>
            <button
              type="button"
              className={btn}
              onClick={() => {
                setPending(null);
                setReason("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {columns.length === 0 ? (
        <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest p-xl text-center">
          <div className="text-body-lg text-on-surface mb-xs">No open requisitions</div>
          <p className="text-body-sm text-on-surface-variant">
            The board shows candidates on live and paused reqs. Publish one and they appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto pb-md">
          <div className="flex gap-md min-w-max">
            {columns.map((col) => {
              const list = byPosition.get(col.position) ?? [];
              return (
                <section
                  key={col.position}
                  className={
                    "w-72 flex-shrink-0 rounded-xl transition " +
                    (dropTarget === col.position ? "bg-primary-fixed/40 ring-2 ring-primary" : "")
                  }
                  onDragOver={(e) => {
                    if (!canMove || !dragging) return;
                    e.preventDefault();
                    setDropTarget(col.position);
                  }}
                  onDragLeave={() => setDropTarget((p) => (p === col.position ? null : p))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDropTarget(null);
                    const card = cards.find((c) => c.id === dragging);
                    setDragging(null);
                    if (card) void moveCard(card, col.position);
                  }}
                >
                  <h3 className="text-label-sm uppercase tracking-wider text-on-surface-variant mb-sm px-xs flex items-center justify-between">
                    <span>{col.label}</span>
                    <span className="opacity-60 tabular-nums">{list.length}</span>
                  </h3>

                  <div className="space-y-sm min-h-[4rem]">
                    {list.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-outline-variant p-md text-caption text-on-surface-variant text-center">
                        Empty
                      </div>
                    ) : (
                      list.map((card) => (
                        <Card
                          key={card.id}
                          card={card}
                          columns={columns}
                          canMove={canMove}
                          selected={selected.has(card.id)}
                          onToggle={() =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(card.id)) next.delete(card.id);
                              else next.add(card.id);
                              return next;
                            })
                          }
                          onOpen={() => setOpenId(card.id)}
                          onDragStart={() => setDragging(card.id)}
                          onDragEnd={() => {
                            setDragging(null);
                            setDropTarget(null);
                          }}
                          onMoveTo={(position) => moveCard(card, position)}
                        />
                      ))
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      {openId && (
        <CandidateDrawer
          applicationId={openId}
          canMove={canMove}
          canWrite={canWrite}
          onClose={() => setOpenId(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

function Card({
  card,
  columns,
  canMove,
  selected,
  onToggle,
  onOpen,
  onDragStart,
  onDragEnd,
  onMoveTo,
}: {
  card: ApplicationRowDTO;
  columns: BoardColumn[];
  canMove: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMoveTo: (position: number) => void;
}) {
  return (
    <div
      draggable={canMove}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={
        "rounded-lg border bg-surface-container-lowest p-md transition " +
        (selected ? "border-primary ring-1 ring-primary" : "border-outline-variant hover:border-primary")
      }
    >
      <div className="flex items-start gap-sm">
        {canMove && (
          <input
            type="checkbox"
            className="mt-xs accent-primary"
            checked={selected}
            onChange={onToggle}
            aria-label={`Select ${card.fullName}`}
          />
        )}
        <button type="button" onClick={onOpen} className="flex-1 min-w-0 text-left">
          <div className="text-body-md font-medium text-on-surface truncate">{card.fullName}</div>
          <div className="text-caption text-on-surface-variant truncate">{card.jobTitle}</div>
        </button>
        {card.aiScore != null && (
          <span className="text-body-sm font-semibold text-on-surface tabular-nums">{card.aiScore}</span>
        )}
      </div>

      <div className="mt-sm flex items-center justify-between text-label-sm text-on-surface-variant">
        <span className="truncate">{card.ownerName ?? "Unassigned"}</span>
        <span className={card.slaBreached ? "text-error font-semibold" : ""}>
          {card.slaBreached && <span title="Past this stage's SLA">⚑ </span>}
          {card.daysInStage}d
        </span>
      </div>

      {canMove && (
        // The keyboard equivalent of dragging. Every drag interaction needs one,
        // and a select is the plainest control that does the same job.
        <label className="mt-sm block">
          <span className="sr-only">Move {card.fullName} to another stage</span>
          <select
            className="w-full h-8 px-sm rounded-lg border border-outline-variant bg-surface-container-low text-label-sm"
            value=""
            onChange={(e) => {
              if (e.target.value === "") return;
              onMoveTo(Number(e.target.value));
              e.target.value = "";
            }}
          >
            <option value="">Move to…</option>
            {columns
              .filter((c) => c.position !== card.stagePosition)
              .map((c) => (
                <option key={c.position} value={c.position}>
                  {c.label}
                </option>
              ))}
          </select>
        </label>
      )}
    </div>
  );
}
