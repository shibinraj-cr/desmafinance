"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  LEAD_PULSE_ROLE_SLUGS,
  leadPulseRoleBadgeClass,
  leadPulseRoleLabel,
  type LeadPulseRoleSlug,
} from "@/lib/lead-pulse-rbac";

type RosterRow = {
  id: string;
  userId: string;
  username: string;
  email: string | null;
  role: LeadPulseRoleSlug;
  displayName: string;
  regionFocus: string[];
  active: boolean;
};

type RegionOption = { code: string; label: string };

const errorLabels: Record<string, string> = {
  user_not_found: "That user no longer exists.",
  invalid_region_code: "Invalid region code.",
  validation_failed: "Check the values entered.",
  forbidden: "Only supervisors and DESGRO admins can do that.",
  not_found: "Roster entry no longer exists.",
};

export function TeamRosterEditor({
  roster,
  regions,
}: {
  roster: RosterRow[];
  regions: RegionOption[];
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | LeadPulseRoleSlug>("all");

  const filtered = useMemo(() => {
    return roster.filter((r) => {
      if (filter !== "all" && r.role !== filter) return false;
      if (search) {
        const s = search.toLowerCase();
        return (
          r.displayName.toLowerCase().includes(s) ||
          r.username.toLowerCase().includes(s) ||
          (r.email ?? "").toLowerCase().includes(s)
        );
      }
      return true;
    });
  }, [roster, filter, search]);

  return (
    <div className="space-y-[16px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        {(["all", ...LEAD_PULSE_ROLE_SLUGS] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className="h-[32px] px-[16px] rounded-full text-[13px] font-semibold transition border"
            style={
              filter === f
                ? {
                    backgroundColor: "var(--lp-primary)",
                    color: "var(--lp-on-primary)",
                    borderColor: "var(--lp-primary)",
                  }
                : {
                    backgroundColor: "var(--lp-surface-container)",
                    color: "var(--lp-on-surface-variant)",
                    borderColor: "var(--lp-outline-variant)",
                  }
            }
          >
            {f === "all" ? "All" : leadPulseRoleLabel(f) + "s"}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, username, or email…"
          className="ml-auto h-[36px] w-full sm:w-[280px] px-[16px] rounded-[8px] border text-[13px] outline-none transition"
          style={{
            backgroundColor: "var(--lp-surface-container-low)",
            borderColor: "var(--lp-outline-variant)",
            color: "var(--lp-on-surface)",
          }}
        />
      </div>

      <div
        className="rounded-[12px] border overflow-hidden"
        style={{
          backgroundColor: "var(--lp-surface-container)",
          borderColor: "var(--lp-outline-variant)",
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr
                className="text-left"
                style={{ backgroundColor: "var(--lp-surface-container-low)" }}
              >
                <Th>BDE Name</Th>
                <Th>Username · Email</Th>
                <Th>Role</Th>
                <Th>Regions</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-[16px] py-[24px] text-center"
                    style={{ color: "var(--lp-on-surface-variant)" }}
                  >
                    No matching BDEs. Use <strong>Add BDE</strong> to roster a user.
                  </td>
                </tr>
              )}
              {filtered.map((r) => (
                <RosterRow key={r.id} row={r} regions={regions} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={"px-[16px] py-[10px] text-[11px] font-bold uppercase tracking-widest " + className}
      style={{ color: "var(--lp-on-surface-variant)" }}
    >
      {children}
    </th>
  );
}

function RosterRow({ row, regions }: { row: RosterRow; regions: RegionOption[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(row);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    setBusy(true);
    const res = await fetch(`/api/marketing/lead-pulse/roles/${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role: draft.role,
        displayName: draft.displayName,
        regionFocus: draft.regionFocus,
        active: draft.active,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(errorLabels[data?.error as string] ?? "Failed.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  async function toggleActive() {
    setBusy(true);
    await fetch(`/api/marketing/lead-pulse/roles/${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !row.active }),
    });
    setBusy(false);
    router.refresh();
  }

  async function remove() {
    if (!confirm(`Remove ${row.displayName} from Lead Pulse roster?`)) return;
    setBusy(true);
    const res = await fetch(`/api/marketing/lead-pulse/roles/${row.id}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(errorLabels[data?.error as string] ?? "Failed.");
      return;
    }
    router.refresh();
  }

  function toggleRegion(code: string) {
    setDraft((d) => ({
      ...d,
      regionFocus: d.regionFocus.includes(code)
        ? d.regionFocus.filter((c) => c !== code)
        : [...d.regionFocus, code],
    }));
  }

  return (
    <>
      <tr
        className="border-t"
        style={{
          borderColor: "var(--lp-outline-variant)",
          opacity: row.active ? 1 : 0.5,
        }}
      >
        <td className="px-[16px] py-[10px] font-semibold">
          {editing ? (
            <input
              value={draft.displayName}
              onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
              className="w-full h-[32px] px-[8px] rounded border outline-none"
              style={{
                backgroundColor: "var(--lp-surface-container-low)",
                borderColor: "var(--lp-outline-variant)",
                color: "var(--lp-on-surface)",
              }}
            />
          ) : (
            row.displayName
          )}
        </td>
        <td
          className="px-[16px] py-[10px] text-[12px]"
          style={{ color: "var(--lp-on-surface-variant)" }}
        >
          <div>{row.username}</div>
          {row.email && <div className="text-[11px]">{row.email}</div>}
        </td>
        <td className="px-[16px] py-[10px]">
          {editing ? (
            <select
              value={draft.role}
              onChange={(e) => setDraft({ ...draft, role: e.target.value as LeadPulseRoleSlug })}
              className="h-[32px] px-[8px] rounded border text-[13px]"
              style={{
                backgroundColor: "var(--lp-surface-container-low)",
                borderColor: "var(--lp-outline-variant)",
                color: "var(--lp-on-surface)",
              }}
            >
              {LEAD_PULSE_ROLE_SLUGS.map((r) => (
                <option key={r} value={r}>
                  {leadPulseRoleLabel(r)}
                </option>
              ))}
            </select>
          ) : (
            <span
              className={
                "inline-flex items-center px-[10px] py-[3px] rounded-full text-[11px] font-bold uppercase tracking-widest " +
                leadPulseRoleBadgeClass(row.role)
              }
            >
              {leadPulseRoleLabel(row.role).replace(" BDE", "")}
            </span>
          )}
        </td>
        <td className="px-[16px] py-[10px]">
          {editing ? (
            <div className="flex flex-wrap gap-[4px]">
              {regions.map((r) => {
                const checked = draft.regionFocus.includes(r.code);
                return (
                  <button
                    key={r.code}
                    type="button"
                    onClick={() => toggleRegion(r.code)}
                    className="px-[8px] h-[24px] rounded-full text-[11px] font-semibold border"
                    style={
                      checked
                        ? {
                            backgroundColor: "var(--lp-primary)",
                            color: "var(--lp-on-primary)",
                            borderColor: "var(--lp-primary)",
                          }
                        : {
                            backgroundColor: "transparent",
                            color: "var(--lp-on-surface-variant)",
                            borderColor: "var(--lp-outline-variant)",
                          }
                    }
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <div
              className="text-[12px]"
              style={{ color: "var(--lp-on-surface-variant)" }}
            >
              {row.regionFocus.length === 0
                ? "All regions"
                : row.regionFocus
                    .map((code) => regions.find((r) => r.code === code)?.label ?? code)
                    .join(", ")}
            </div>
          )}
        </td>
        <td className="px-[16px] py-[10px]">
          <span
            className="inline-flex items-center px-[10px] py-[3px] rounded-full text-[11px] font-bold"
            style={
              row.active
                ? { backgroundColor: "rgba(51,228,255,0.15)", color: "#33e4ff" }
                : { backgroundColor: "var(--lp-surface-container-high)", color: "var(--lp-on-surface-variant)" }
            }
          >
            {row.active ? "Active" : "Inactive"}
          </span>
        </td>
        <td className="px-[16px] py-[10px] text-right whitespace-nowrap">
          {editing ? (
            <span className="inline-flex items-center gap-[4px]">
              <button
                onClick={save}
                disabled={busy}
                className="h-[28px] px-[12px] rounded text-[12px] font-semibold"
                style={{
                  backgroundColor: "var(--lp-primary)",
                  color: "var(--lp-on-primary)",
                  opacity: busy ? 0.6 : 1,
                }}
              >
                {busy ? "…" : "Save"}
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setDraft(row);
                  setError(null);
                }}
                className="h-[28px] px-[12px] rounded border text-[12px]"
                style={{
                  borderColor: "var(--lp-outline-variant)",
                  color: "var(--lp-on-surface-variant)",
                }}
              >
                Cancel
              </button>
            </span>
          ) : (
            <span className="inline-flex items-center gap-[4px]">
              <IconBtn icon={row.active ? "toggle_on" : "toggle_off"} onClick={toggleActive} disabled={busy} />
              <IconBtn icon="edit" onClick={() => setEditing(true)} />
              <IconBtn icon="delete" onClick={remove} disabled={busy} variant="danger" />
            </span>
          )}
        </td>
      </tr>
      {editing && error && (
        <tr style={{ borderColor: "var(--lp-outline-variant)" }}>
          <td colSpan={6} className="px-[16px] pb-[10px]">
            <div
              className="rounded px-[12px] py-[8px] text-[13px]"
              style={{ backgroundColor: "rgba(255,180,171,0.15)", color: "var(--lp-error)" }}
            >
              {error}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function IconBtn({
  icon,
  onClick,
  disabled,
  variant,
}: {
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="p-[4px] transition disabled:opacity-40"
      style={{
        color: variant === "danger" ? "var(--lp-error)" : "var(--lp-on-surface-variant)",
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
        {icon}
      </span>
    </button>
  );
}

export function AddBdeButton({
  assignableUsers,
  regions,
}: {
  assignableUsers: { id: string; username: string; email: string | null }[];
  regions: RegionOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    userId: assignableUsers[0]?.id ?? "",
    role: "l1" as LeadPulseRoleSlug,
    displayName: "",
    regionFocus: [] as string[],
  });

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Sync default displayName from picked user
  useEffect(() => {
    if (!form.userId) return;
    const u = assignableUsers.find((x) => x.id === form.userId);
    if (u && !form.displayName) {
      setForm((f) => ({ ...f, displayName: u.username }));
    }
  }, [form.userId, assignableUsers, form.displayName]);

  function toggleRegion(code: string) {
    setForm((f) => ({
      ...f,
      regionFocus: f.regionFocus.includes(code)
        ? f.regionFocus.filter((c) => c !== code)
        : [...f.regionFocus, code],
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await fetch("/api/marketing/lead-pulse/roles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: form.userId,
        role: form.role,
        displayName: form.displayName.trim() || undefined,
        regionFocus: form.regionFocus,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(errorLabels[data?.error as string] ?? "Failed.");
      return;
    }
    setOpen(false);
    setForm({
      userId: assignableUsers[0]?.id ?? "",
      role: "l1",
      displayName: "",
      regionFocus: [],
    });
    router.refresh();
  }

  const noUsers = assignableUsers.length === 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={noUsers}
        title={noUsers ? "Every DESGRO user is already rostered" : "Add a BDE"}
        className="inline-flex items-center gap-[6px] h-[36px] px-[16px] rounded-[8px] text-[13px] font-semibold transition disabled:opacity-50"
        style={{
          backgroundColor: "var(--lp-primary)",
          color: "var(--lp-on-primary)",
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          person_add
        </span>
        Add BDE
      </button>
      {open &&
        mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-[1000] grid place-items-center p-[16px]"
            style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
            onClick={() => !busy && setOpen(false)}
          >
            <form
              onSubmit={submit}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-[12px] p-[24px] border space-y-[16px]"
              style={{
                backgroundColor: "var(--lp-surface-container-high)",
                borderColor: "var(--lp-outline-variant)",
                color: "var(--lp-on-surface)",
              }}
            >
              <h3 className="text-[18px] font-semibold">Add BDE</h3>
              <Field label="DESGRO user">
                <select
                  value={form.userId}
                  onChange={(e) => setForm({ ...form, userId: e.target.value, displayName: "" })}
                  required
                  className={inputCls}
                >
                  {assignableUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.username} {u.email ? `· ${u.email}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-[12px]">
                <Field label="Role">
                  <select
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value as LeadPulseRoleSlug })}
                    className={inputCls}
                  >
                    {LEAD_PULSE_ROLE_SLUGS.map((r) => (
                      <option key={r} value={r}>
                        {leadPulseRoleLabel(r)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Display name">
                  <input
                    value={form.displayName}
                    onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                    placeholder="Shown in reports"
                    className={inputCls}
                  />
                </Field>
              </div>
              <Field label="Region focus (optional — empty = all regions)">
                <div className="flex flex-wrap gap-[6px]">
                  {regions.map((r) => {
                    const checked = form.regionFocus.includes(r.code);
                    return (
                      <button
                        type="button"
                        key={r.code}
                        onClick={() => toggleRegion(r.code)}
                        className="h-[28px] px-[10px] rounded-full text-[12px] font-semibold border"
                        style={
                          checked
                            ? {
                                backgroundColor: "var(--lp-primary)",
                                color: "var(--lp-on-primary)",
                                borderColor: "var(--lp-primary)",
                              }
                            : {
                                backgroundColor: "transparent",
                                color: "var(--lp-on-surface-variant)",
                                borderColor: "var(--lp-outline-variant)",
                              }
                        }
                      >
                        {r.label}
                      </button>
                    );
                  })}
                </div>
              </Field>
              {error && (
                <div
                  className="rounded px-[12px] py-[8px] text-[13px]"
                  style={{ backgroundColor: "rgba(255,180,171,0.15)", color: "var(--lp-error)" }}
                >
                  {error}
                </div>
              )}
              <div className="flex items-center gap-[8px] pt-[8px]">
                <button
                  type="submit"
                  disabled={busy}
                  className="h-[40px] px-[20px] rounded-[8px] text-[14px] font-semibold transition disabled:opacity-60"
                  style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
                >
                  {busy ? "Adding…" : "Add to roster"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={busy}
                  className="h-[40px] px-[20px] rounded-[8px] border text-[14px]"
                  style={{
                    borderColor: "var(--lp-outline-variant)",
                    color: "var(--lp-on-surface-variant)",
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>,
          document.body,
        )}
    </>
  );
}

const inputCls = "w-full h-[40px] px-[12px] rounded-[8px] border text-[14px] outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span
        className="block text-[11px] font-bold uppercase tracking-widest mb-[6px]"
        style={{ color: "var(--lp-on-surface-variant)" }}
      >
        {label}
      </span>
      <div
        style={{
          // Apply the dark input styling via CSS vars, since inputCls only sets
          // structural classes.
          ["--tw-ring-color" as string]: "var(--lp-primary)",
        }}
      >
        {children}
      </div>
    </label>
  );
}
