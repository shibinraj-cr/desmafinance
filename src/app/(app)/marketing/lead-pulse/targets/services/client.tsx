"use client";

import { useState, useTransition, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Group = {
  id: string;
  name: string;
  description: string | null;
  displayOrder: number;
  isActive: boolean;
};

type Service = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  showInL2Targets: boolean;
  weight: number;
  groupId: string | null;
};

export function ServiceVisibilityClient({
  groups,
  services,
}: {
  groups: Group[];
  services: Service[];
}) {
  const router = useRouter();
  const [serviceState, setServiceState] = useState<Service[]>(services);
  const [groupState, setGroupState] = useState<Group[]>(groups);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState<{ name: string; description: string }>(
    { name: "", description: "" },
  );

  const grouped = useMemo(() => {
    const map = new Map<string, Service[]>();
    for (const s of serviceState) {
      const key = s.groupId ?? "__ungrouped__";
      const arr = map.get(key) ?? [];
      arr.push(s);
      map.set(key, arr);
    }
    return map;
  }, [serviceState]);

  async function toggleVisibility(serviceId: string, next: boolean) {
    setError(null);
    setServiceState((arr) =>
      arr.map((s) => (s.id === serviceId ? { ...s, showInL2Targets: next } : s)),
    );
    startTransition(async () => {
      const res = await fetch("/api/marketing/lead-pulse/targets/services", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serviceId, showInL2Targets: next }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError((d as { error?: string }).error ?? "Update failed.");
        setServiceState((arr) =>
          arr.map((s) => (s.id === serviceId ? { ...s, showInL2Targets: !next } : s)),
        );
      }
    });
  }

  async function setWeight(serviceId: string, next: number) {
    setError(null);
    const safe = Math.max(0, Math.round(next * 10) / 10);
    const prevState = serviceState.find((s) => s.id === serviceId)?.weight ?? 1;
    setServiceState((arr) =>
      arr.map((s) => (s.id === serviceId ? { ...s, weight: safe } : s)),
    );
    startTransition(async () => {
      const res = await fetch("/api/marketing/lead-pulse/targets/services", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serviceId, weight: safe }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError((d as { error?: string }).error ?? "Update failed.");
        setServiceState((arr) =>
          arr.map((s) => (s.id === serviceId ? { ...s, weight: prevState } : s)),
        );
      }
    });
  }

  async function assignGroup(serviceId: string, groupId: string | null) {
    setError(null);
    const prevState = serviceState.find((s) => s.id === serviceId)?.groupId ?? null;
    setServiceState((arr) =>
      arr.map((s) => (s.id === serviceId ? { ...s, groupId } : s)),
    );
    startTransition(async () => {
      const res = await fetch("/api/marketing/lead-pulse/targets/groups", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serviceId, groupId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError((d as { error?: string }).error ?? "Failed to assign group.");
        setServiceState((arr) =>
          arr.map((s) => (s.id === serviceId ? { ...s, groupId: prevState } : s)),
        );
      }
    });
  }

  async function createGroup() {
    if (!newGroup.name.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/marketing/lead-pulse/targets/groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: newGroup.name.trim(),
          description: newGroup.description.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(
          (d as { error?: string }).error === "name_taken"
            ? "A group with that name already exists."
            : "Failed to create the group.",
        );
        return;
      }
      const data = (await res.json()) as { group: Group };
      setGroupState((arr) =>
        [...arr, data.group].sort(
          (a, b) =>
            a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
        ),
      );
      setNewGroup({ name: "", description: "" });
    });
  }

  async function deleteGroup(id: string) {
    if (!confirm("Delete this group? Services in it will become ungrouped.")) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(
        `/api/marketing/lead-pulse/targets/groups?id=${id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(
          (d as { error?: string }).error === "has_targets"
            ? "This group has saved targets and can't be deleted."
            : "Failed to delete the group.",
        );
        return;
      }
      setGroupState((arr) => arr.filter((g) => g.id !== id));
      setServiceState((arr) =>
        arr.map((s) => (s.groupId === id ? { ...s, groupId: null } : s)),
      );
    });
  }

  return (
    <div className="px-[24px] py-[24px] space-y-[16px] max-w-4xl">
      <header className="flex flex-wrap items-end justify-between gap-[12px]">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight">L2 Target Services</h1>
          <p
            className="mt-[4px] text-[13px]"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            Bundle services into groups so the L2 Targets sheet sets one target per
            group (not per service). A service can sit in at most one group.
            Show/hide flips a service&apos;s visibility on the matrix.
          </p>
        </div>
        <Link
          href="/marketing/lead-pulse/targets"
          className="h-[36px] inline-flex items-center px-[14px] rounded-[8px] border text-[13px] font-semibold"
          style={{
            borderColor: "var(--lp-outline-variant)",
            color: "var(--lp-on-surface)",
          }}
        >
          ← Back to L2 Targets
        </Link>
      </header>

      {error && (
        <p className="text-[12px]" style={{ color: "var(--lp-error)" }}>
          {error}
        </p>
      )}

      {/* Create-group form */}
      <div
        className="rounded-[12px] border p-[14px] flex flex-wrap items-end gap-[10px]"
        style={{
          backgroundColor: "var(--lp-surface-container)",
          borderColor: "var(--lp-outline-variant)",
        }}
      >
        <div className="flex-1 min-w-[180px]">
          <label
            className="block text-[10px] uppercase tracking-widest mb-[2px] font-semibold"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            New group name
          </label>
          <input
            value={newGroup.name}
            onChange={(e) => setNewGroup((s) => ({ ...s, name: e.target.value }))}
            placeholder="e.g. Australia"
            className="w-full h-[36px] rounded-[8px] px-[10px] text-[13px]"
          />
        </div>
        <div className="flex-[2] min-w-[200px]">
          <label
            className="block text-[10px] uppercase tracking-widest mb-[2px] font-semibold"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            Description (optional)
          </label>
          <input
            value={newGroup.description}
            onChange={(e) =>
              setNewGroup((s) => ({ ...s, description: e.target.value }))
            }
            placeholder="Short note about what this group covers"
            className="w-full h-[36px] rounded-[8px] px-[10px] text-[13px]"
          />
        </div>
        <button
          onClick={createGroup}
          disabled={busy || !newGroup.name.trim()}
          className="h-[36px] px-[14px] rounded-[8px] text-[13px] font-bold"
          style={{
            backgroundColor: "var(--lp-primary)",
            color: "var(--lp-on-primary)",
            opacity: busy || !newGroup.name.trim() ? 0.5 : 1,
          }}
        >
          Add group
        </button>
      </div>

      {/* Group sections */}
      {groupState.length === 0 && (
        <p className="text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
          No groups yet — create one above, then assign services to it from the
          dropdowns below.
        </p>
      )}

      {groupState.map((g) => {
        const inGroup = grouped.get(g.id) ?? [];
        return (
          <section
            key={g.id}
            className="rounded-[12px] border"
            style={{
              backgroundColor: "var(--lp-surface-container)",
              borderColor: "var(--lp-outline-variant)",
            }}
          >
            <header className="flex flex-wrap items-center justify-between gap-[8px] px-[16px] py-[12px]">
              <div className="flex items-baseline gap-[8px]">
                <h2 className="text-[15px] font-bold" style={{ color: "var(--lp-on-surface)" }}>
                  {g.name}
                </h2>
                <span
                  className="text-[11px]"
                  style={{ color: "var(--lp-on-surface-variant)" }}
                >
                  {inGroup.length} service{inGroup.length === 1 ? "" : "s"}
                </span>
                {g.description && (
                  <span
                    className="text-[11px]"
                    style={{ color: "var(--lp-on-surface-variant)" }}
                  >
                    · {g.description}
                  </span>
                )}
              </div>
              <button
                onClick={() => deleteGroup(g.id)}
                disabled={busy}
                className="text-[11px] underline"
                style={{ color: "var(--lp-error)" }}
              >
                Delete group
              </button>
            </header>
            {inGroup.length === 0 ? (
              <p
                className="px-[16px] pb-[12px] text-[12px]"
                style={{ color: "var(--lp-on-surface-variant)" }}
              >
                No services assigned yet.
              </p>
            ) : (
              <ul
                className="divide-y"
                style={{ borderColor: "var(--lp-outline-variant)" }}
              >
                {inGroup.map((s) => (
                  <ServiceRow
                    key={s.id}
                    service={s}
                    groups={groupState}
                    busy={busy}
                    onToggleVisibility={toggleVisibility}
                    onAssignGroup={assignGroup}
                    onWeightChange={setWeight}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {/* Ungrouped services */}
      <section
        className="rounded-[12px] border"
        style={{
          backgroundColor: "var(--lp-surface-container)",
          borderColor: "var(--lp-outline-variant)",
        }}
      >
        <header className="px-[16px] py-[12px] flex items-baseline gap-[8px]">
          <h2 className="text-[15px] font-bold" style={{ color: "var(--lp-on-surface)" }}>
            Ungrouped
          </h2>
          <span className="text-[11px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            {(grouped.get("__ungrouped__") ?? []).length} service
            {(grouped.get("__ungrouped__") ?? []).length === 1 ? "" : "s"} · pick a
            group below to make them appear on the matrix
          </span>
        </header>
        <ul className="divide-y" style={{ borderColor: "var(--lp-outline-variant)" }}>
          {(grouped.get("__ungrouped__") ?? []).map((s) => (
            <ServiceRow
              key={s.id}
              service={s}
              groups={groupState}
              busy={busy}
              onToggleVisibility={toggleVisibility}
              onAssignGroup={assignGroup}
              onWeightChange={setWeight}
            />
          ))}
          {(grouped.get("__ungrouped__") ?? []).length === 0 && (
            <li
              className="px-[16px] py-[12px] text-[12px]"
              style={{ color: "var(--lp-on-surface-variant)" }}
            >
              All services are assigned to a group.
            </li>
          )}
        </ul>
      </section>

      <p className="text-[11px]" style={{ color: "var(--lp-on-surface-variant)" }}>
        Tip: After every change here, the L2 Targets matrix refreshes
        automatically.
      </p>
      <RefreshHint router={router} />
    </div>
  );
}

function ServiceRow({
  service,
  groups,
  busy,
  onToggleVisibility,
  onAssignGroup,
  onWeightChange,
}: {
  service: Service;
  groups: Group[];
  busy: boolean;
  onToggleVisibility: (id: string, next: boolean) => void;
  onAssignGroup: (id: string, groupId: string | null) => void;
  onWeightChange: (id: string, next: number) => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-[12px] px-[16px] py-[10px]">
      <div className="flex-1 min-w-[200px]">
        <p
          className="text-[13px] font-semibold"
          style={{
            color: service.isActive ? "var(--lp-on-surface)" : "var(--lp-on-surface-variant)",
          }}
        >
          {service.name}
          {!service.isActive && (
            <span
              className="ml-[6px] text-[10px] uppercase tracking-widest"
              style={{ color: "var(--lp-on-surface-variant)" }}
            >
              inactive
            </span>
          )}
        </p>
        {service.description && (
          <p
            className="text-[11px]"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            {service.description}
          </p>
        )}
      </div>
      <select
        value={service.groupId ?? ""}
        onChange={(e) => onAssignGroup(service.id, e.target.value || null)}
        disabled={busy}
        className="h-[32px] rounded-[6px] px-[8px] text-[12px]"
      >
        <option value="">— Ungrouped —</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      <label className="inline-flex items-center gap-[6px]">
        <span
          className="text-[10px] uppercase tracking-widest"
          style={{ color: "var(--lp-on-surface-variant)" }}
        >
          Weight
        </span>
        <input
          type="number"
          min={0}
          step={0.5}
          defaultValue={service.weight}
          disabled={busy}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (!Number.isFinite(v) || v === service.weight) return;
            onWeightChange(service.id, v);
          }}
          className="h-[32px] w-[64px] rounded-[6px] px-[6px] text-[12px] text-right font-mono"
          title="Multiplier applied when crediting this service to the group's actual on the L2 Targets matrix."
        />
      </label>
      <label className="inline-flex items-center gap-[6px] cursor-pointer">
        <span className="text-[11px]" style={{ color: "var(--lp-on-surface-variant)" }}>
          {service.showInL2Targets ? "Shown" : "Hidden"}
        </span>
        <input
          type="checkbox"
          checked={service.showInL2Targets}
          onChange={(e) => onToggleVisibility(service.id, e.target.checked)}
          disabled={busy}
          className="w-[16px] h-[16px] cursor-pointer"
        />
      </label>
    </li>
  );
}

function RefreshHint({ router }: { router: ReturnType<typeof useRouter> }) {
  // Tiny side-effect: refresh on unmount so the targets page picks up
  // the new groupings without manual reload.
  return (
    <button
      onClick={() => router.refresh()}
      className="text-[11px] underline"
      style={{ color: "var(--lp-on-surface-variant)" }}
    >
      Refresh server data
    </button>
  );
}
