"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  HIRING_PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLE_LABELS,
  type HiringPermission,
  type HiringBaseRole,
} from "@/lib/hiring/rbac";

type MemberDTO = {
  id: string;
  userId: string;
  username: string;
  email: string | null;
  userIsActive: boolean;
  baseRole: string;
  customRoleName: string | null;
  extraPermissions: string[];
  deniedPermissions: string[];
  isActive: boolean;
  lastActiveAt: string | null;
};
type UserLite = { id: string; username: string; email: string | null };

const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md";
const primaryBtn =
  "h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-60";
const secondaryBtn =
  "h-10 px-lg rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition disabled:opacity-60";

// The roles a Desgro user can hold. `partner` is deliberately absent: an
// external agency is not a Desgro login, it is a HiringPartner with a magic
// link, managed on the Sourcing partners rail.
const ASSIGNABLE_ROLES: HiringBaseRole[] = ["owner", "hr_manager", "recruiter", "employee"];

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <span className="material-symbols-outlined" style={{ fontSize: size }} aria-hidden>
      {name}
    </span>
  );
}

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.ok) return { ok: true as const };
  const d = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  return { ok: false as const, error: d.message || d.error || "That didn't save." };
}

/** Effective keys for a member — mirrors resolveHiringAccess() exactly. */
function effectiveKeys(m: MemberDTO): Set<string> {
  const base = ROLE_PERMISSIONS[(m.baseRole as HiringBaseRole) ?? "employee"] ?? [];
  const set = new Set<string>(base);
  if (m.isActive) for (const k of m.extraPermissions) set.add(k);
  for (const k of m.deniedPermissions) set.delete(k);
  return set;
}

function fmtDay(iso: string | null): string {
  if (!iso) return "Never";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

export function SettingsClient({
  members,
  allUsers,
  currentUserId,
}: {
  members: MemberDTO[];
  allUsers: UserLite[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newUserId, setNewUserId] = useState("");
  const [newRole, setNewRole] = useState<HiringBaseRole>("recruiter");
  const [expanded, setExpanded] = useState<string | null>(null);

  const memberUserIds = useMemo(() => new Set(members.map((m) => m.userId)), [members]);
  const addable = useMemo(
    () => allUsers.filter((u) => !memberUserIds.has(u.id)),
    [allUsers, memberUserIds],
  );
  const seats = members.filter((m) => m.isActive).length;

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(label);
    setError(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) setError(r.error ?? "That didn't save.");
    else router.refresh();
  }

  return (
    <div className="space-y-lg">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-error bg-error-container px-md py-sm text-body-md text-on-error-container"
        >
          {error}
        </div>
      )}

      {/* ---- Team members ------------------------------------------------ */}
      <section className="rounded-xl border border-outline-variant bg-surface-container-lowest">
        <div className="flex flex-wrap items-center justify-between gap-md p-lg pb-md">
          <div>
            <h3 className="text-h3 text-on-surface">Hiring team</h3>
            <p className="text-body-sm text-on-surface-variant">
              {seats === 0
                ? "Nobody is on the hiring team yet."
                : `${seats} active ${seats === 1 ? "seat" : "seats"}.`}{" "}
              Everyone here already has a Desgro login — this decides what they can do in Hiring.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className={primaryBtn + " inline-flex items-center gap-xs"}
            disabled={addable.length === 0}
            title={addable.length === 0 ? "Every active user is already on the team." : undefined}
          >
            <Icon name="person_add" /> Add team member
          </button>
        </div>

        {adding && (
          <div className="mx-lg mb-md rounded-lg border border-outline-variant bg-surface-container-low p-md">
            <div className="grid gap-md sm:grid-cols-[2fr,1fr,auto] sm:items-end">
              <label className="block">
                <span className="block text-label-sm text-on-surface-variant mb-xs">Person</span>
                <select
                  className={inputCls}
                  value={newUserId}
                  onChange={(e) => setNewUserId(e.target.value)}
                >
                  <option value="">Choose a Desgro user…</option>
                  {addable.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.username}
                      {u.email ? ` · ${u.email}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-label-sm text-on-surface-variant mb-xs">Hiring role</span>
                <select
                  className={inputCls}
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as HiringBaseRole)}
                >
                  {ASSIGNABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex gap-xs">
                <button
                  type="button"
                  className={primaryBtn}
                  disabled={!newUserId || busy === "add"}
                  onClick={() =>
                    run("add", async () => {
                      const r = await api("/api/hiring/members", "POST", {
                        userId: newUserId,
                        baseRole: newRole,
                        extraPermissions: [],
                        deniedPermissions: [],
                      });
                      if (r.ok) {
                        setAdding(false);
                        setNewUserId("");
                      }
                      return r;
                    })
                  }
                >
                  {busy === "add" ? "Adding…" : "Add"}
                </button>
                <button type="button" className={secondaryBtn} onClick={() => setAdding(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {members.length === 0 ? (
          <div className="mx-lg mb-lg rounded-lg border border-dashed border-outline-variant p-xl text-center">
            <div className="text-body-lg text-on-surface mb-xs">No hiring team yet</div>
            <p className="text-body-sm text-on-surface-variant mb-md max-w-prose mx-auto">
              Add the people who will post jobs and move candidates. Until then, access falls back to
              Desgro role page-grants: admins act as Owners, and anyone granted a hiring page acts as
              a Recruiter.
            </p>
            <button
              type="button"
              className={primaryBtn}
              onClick={() => setAdding(true)}
              disabled={addable.length === 0}
            >
              Add the first team member
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body-md">
              <thead className="text-left border-y border-outline-variant bg-surface-container-low">
                <tr className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                  <th className="px-lg py-sm">Person</th>
                  <th className="px-md py-sm">Hiring role</th>
                  <th className="px-md py-sm">Custom role</th>
                  <th className="px-md py-sm">Last active</th>
                  <th className="px-md py-sm">Status</th>
                  <th className="px-md py-sm sr-only">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const keys = effectiveKeys(m);
                  const isSelf = m.userId === currentUserId;
                  return (
                    <Fragment key={m.id}>
                      <tr className="border-b border-outline-variant align-middle">
                        <td className="px-lg py-sm">
                          <div className="text-on-surface font-medium">
                            {m.username}
                            {isSelf && (
                              <span className="ml-xs text-label-sm text-on-surface-variant">(you)</span>
                            )}
                          </div>
                          <div className="text-caption text-on-surface-variant">
                            {m.email ?? "no email on file"}
                            {!m.userIsActive && " · Desgro login deactivated"}
                          </div>
                        </td>
                        <td className="px-md py-sm">
                          <select
                            aria-label={`Hiring role for ${m.username}`}
                            className="h-9 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
                            value={m.baseRole}
                            disabled={busy !== null}
                            onChange={(e) =>
                              run(m.id, () =>
                                api(`/api/hiring/members/${m.id}`, "PATCH", {
                                  baseRole: e.target.value,
                                }),
                              )
                            }
                          >
                            {ASSIGNABLE_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABELS[r]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-md py-sm">
                          <CustomRoleCell
                            member={m}
                            disabled={busy !== null}
                            onSave={(name) =>
                              run(m.id, () =>
                                api(`/api/hiring/members/${m.id}`, "PATCH", {
                                  customRoleName: name,
                                }),
                              )
                            }
                          />
                        </td>
                        <td className="px-md py-sm text-on-surface-variant tabular-nums">
                          {fmtDay(m.lastActiveAt)}
                        </td>
                        <td className="px-md py-sm">
                          <span
                            className={
                              "inline-flex items-center h-6 px-sm rounded-full text-label-sm " +
                              (m.isActive
                                ? "bg-primary text-on-primary"
                                : "bg-surface-container text-on-surface-variant")
                            }
                          >
                            {m.isActive ? "Active" : "Deactivated"}
                          </span>
                        </td>
                        <td className="px-md py-sm">
                          <div className="flex items-center gap-xs justify-end">
                            <button
                              type="button"
                              className="h-9 px-sm rounded-lg border border-outline-variant text-label-sm text-on-surface-variant hover:bg-surface-container-low transition inline-flex items-center gap-xs"
                              aria-expanded={expanded === m.id}
                              onClick={() => setExpanded(expanded === m.id ? null : m.id)}
                            >
                              <Icon name="tune" size={16} />
                              {keys.size} permissions
                            </button>
                            <button
                              type="button"
                              className="h-9 px-sm rounded-lg border border-outline-variant text-label-sm hover:bg-surface-container-low transition"
                              disabled={busy !== null}
                              onClick={() =>
                                run(m.id, () =>
                                  api(`/api/hiring/members/${m.id}`, "PATCH", {
                                    isActive: !m.isActive,
                                  }),
                                )
                              }
                            >
                              {m.isActive ? "Deactivate" : "Reactivate"}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded === m.id && (
                        <tr className="border-b border-outline-variant">
                          <td colSpan={6} className="px-lg py-md bg-surface-container-low">
                            <PermissionEditor
                              member={m}
                              disabled={busy !== null}
                              onChange={(patch) =>
                                run(m.id, () => api(`/api/hiring/members/${m.id}`, "PATCH", patch))
                              }
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- Permission matrix ------------------------------------------- */}
      <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
        <h3 className="text-h3 text-on-surface mb-xs">What each role can do</h3>
        <p className="text-body-sm text-on-surface-variant mb-md">
          The base grant for every role. A custom role starts from one of these and adds or removes
          individual keys — every check in the app reads the same list.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-body-md">
            <thead>
              <tr className="text-label-sm uppercase tracking-wider text-on-surface-variant border-b border-outline-variant">
                <th className="px-md py-sm text-left">Permission</th>
                {(["owner", "hr_manager", "recruiter", "partner", "employee"] as HiringBaseRole[]).map(
                  (r) => (
                    <th key={r} className="px-md py-sm text-center whitespace-nowrap">
                      {ROLE_LABELS[r]}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {HIRING_PERMISSIONS.map((key) => (
                <tr key={key} className="border-b border-outline-variant last:border-0">
                  <td className="px-md py-xs font-mono text-label-sm text-on-surface">{key}</td>
                  {(["owner", "hr_manager", "recruiter", "partner", "employee"] as HiringBaseRole[]).map(
                    (r) => {
                      const has = ROLE_PERMISSIONS[r].includes(key);
                      return (
                        <td key={r} className="px-md py-xs text-center">
                          <span className={has ? "text-accent" : "text-outline"}>
                            <Icon name={has ? "check_circle" : "remove"} size={16} />
                            <span className="sr-only">
                              {has ? "granted" : "not granted"}
                            </span>
                          </span>
                        </td>
                      );
                    },
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-caption text-on-surface-variant mt-md">
          A <strong>hiring manager</strong> is not a role here: whoever is named on a requisition can
          review its candidates and submit scorecards whatever role their login holds.
        </p>
      </section>
    </div>
  );
}

function CustomRoleCell({
  member,
  disabled,
  onSave,
}: {
  member: MemberDTO;
  disabled: boolean;
  onSave: (name: string | null) => void;
}) {
  const [value, setValue] = useState(member.customRoleName ?? "");
  const dirty = (member.customRoleName ?? "") !== value;
  return (
    <div className="flex items-center gap-xs">
      <input
        aria-label={`Custom role name for ${member.username}`}
        className="h-9 w-40 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md"
        placeholder="—"
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
      />
      {dirty && (
        <button
          type="button"
          className="h-9 px-sm rounded-lg bg-primary text-on-primary text-label-sm font-semibold"
          disabled={disabled}
          onClick={() => onSave(value.trim() || null)}
        >
          Save
        </button>
      )}
    </div>
  );
}

/** The custom-role builder: base role + explicit grants − explicit denials. */
function PermissionEditor({
  member,
  disabled,
  onChange,
}: {
  member: MemberDTO;
  disabled: boolean;
  onChange: (patch: { extraPermissions: string[]; deniedPermissions: string[] }) => void;
}) {
  const base = new Set(ROLE_PERMISSIONS[(member.baseRole as HiringBaseRole) ?? "employee"] ?? []);
  const extra = new Set(member.extraPermissions);
  const denied = new Set(member.deniedPermissions);

  function toggle(key: HiringPermission) {
    const inBase = base.has(key);
    const nextExtra = new Set(extra);
    const nextDenied = new Set(denied);
    const currentlyHas = inBase ? !denied.has(key) : extra.has(key);
    if (currentlyHas) {
      if (inBase) nextDenied.add(key);
      else nextExtra.delete(key);
    } else {
      if (inBase) nextDenied.delete(key);
      else nextExtra.add(key);
    }
    onChange({ extraPermissions: [...nextExtra], deniedPermissions: [...nextDenied] });
  }

  return (
    <div>
      <div className="text-label-sm text-on-surface-variant mb-sm">
        Based on <strong className="text-on-surface">{ROLE_LABELS[member.baseRole as HiringBaseRole]}</strong>.
        Tick to grant, untick to revoke — changes save immediately.
      </div>
      <div className="grid gap-xs sm:grid-cols-2 lg:grid-cols-4">
        {HIRING_PERMISSIONS.map((key) => {
          const inBase = base.has(key);
          const has = inBase ? !denied.has(key) : extra.has(key);
          const changed = inBase ? denied.has(key) : extra.has(key);
          return (
            <label
              key={key}
              className={
                "flex items-center gap-xs px-sm py-xs rounded-lg border cursor-pointer transition " +
                (changed
                  ? "border-primary bg-primary-fixed/30"
                  : "border-outline-variant bg-surface-container-lowest")
              }
            >
              <input
                type="checkbox"
                className="accent-primary"
                checked={has}
                disabled={disabled}
                onChange={() => toggle(key)}
              />
              <span className="font-mono text-label-sm text-on-surface">{key}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
