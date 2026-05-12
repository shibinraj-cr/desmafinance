"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type RoleOption = { id: string; name: string };

const errorLabels: Record<string, string> = {
  username_taken: "That username is already in use.",
  email_taken: "That email is already in use.",
  validation_failed: "Check the values entered (username 3+ chars, password 8+ chars).",
  forbidden: "Only admins can do that.",
  cannot_delete_self: "You can't delete your own account.",
  cannot_delete_last_admin: "Refusing to delete the only remaining admin.",
  cannot_demote_last_admin: "Refusing to demote the only remaining admin.",
  not_found: "User no longer exists.",
  role_not_found: "That role no longer exists.",
};

export function NewUserButton({ roles }: { roles: RoleOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const defaultRoleId =
    roles.find((r) => r.name === "Executive")?.id ?? roles[0]?.id ?? "";
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    roleId: defaultRoleId,
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(errorLabels[data?.error as string] ?? "Failed to create user.");
      return;
    }
    setOpen(false);
    setForm({ username: "", email: "", password: "", roleId: defaultRoleId });
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-xs h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold hover:bg-primary-container transition"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          person_add
        </span>
        Add user
      </button>
      {open &&
        mounted &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[1000] grid place-items-center bg-black/50 p-md"
            onClick={() => !busy && setOpen(false)}
          >
            <form
              onSubmit={submit}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg p-lg space-y-md"
            >
              <h3 className="text-h3 text-on-surface">New user</h3>
              <Field label="Username">
                <input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  className={inputCls}
                  required
                  autoFocus
                />
              </Field>
              <Field label="Email (optional)">
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="Password (min 8 characters)">
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className={inputCls}
                  required
                  minLength={8}
                />
              </Field>
              <Field label="Role">
                <select
                  value={form.roleId}
                  onChange={(e) => setForm({ ...form, roleId: e.target.value })}
                  className={inputCls}
                  required
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </Field>
              {error && (
                <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm">
                  {error}
                </div>
              )}
              <div className="flex items-center gap-base pt-base">
                <button
                  type="submit"
                  disabled={busy}
                  className="h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-60"
                >
                  {busy ? "Creating…" : "Create user"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={busy}
                  className="h-10 px-lg rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition"
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

export function UserActions({
  userId,
  username,
  currentRoleId,
  isSelf,
  roles,
}: {
  userId: string;
  username: string;
  currentRoleId: string | null;
  isSelf: boolean;
  roles: RoleOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function changeRole(roleId: string) {
    if (roleId === currentRoleId) return;
    const targetName = roles.find((r) => r.id === roleId)?.name ?? roleId;
    if (!confirm(`Change ${username}'s role to ${targetName}?`)) return;
    setBusy(true);
    const res = await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roleId }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(errorLabels[data?.error as string] ?? "Failed to update role.");
      return;
    }
    router.refresh();
  }

  async function resetPassword() {
    const pw = prompt(`Set a new password for ${username} (min 8 chars):`);
    if (!pw) return;
    if (pw.length < 8) {
      alert("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(errorLabels[data?.error as string] ?? "Failed to reset password.");
      return;
    }
    alert("Password updated.");
  }

  async function remove() {
    if (!confirm(`Permanently delete ${username}? This cannot be undone.`)) return;
    setBusy(true);
    const res = await fetch(`/api/users/${userId}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(errorLabels[data?.error as string] ?? "Failed to delete user.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex items-center gap-xs justify-end">
      <select
        value={currentRoleId ?? ""}
        onChange={(e) => changeRole(e.target.value)}
        disabled={busy || isSelf}
        title={isSelf ? "Can't change your own role" : "Change role"}
        className="h-8 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-label-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition disabled:opacity-50"
      >
        {!currentRoleId && <option value="">— No role —</option>}
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={resetPassword}
        disabled={busy}
        title="Reset password"
        className="p-xs text-on-surface-variant hover:text-accent transition disabled:opacity-40"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          lock_reset
        </span>
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={busy || isSelf}
        title={isSelf ? "Can't delete yourself" : "Delete user"}
        className="p-xs text-on-surface-variant hover:text-error transition disabled:opacity-40"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          delete
        </span>
      </button>
    </div>
  );
}

const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-label-sm text-on-surface-variant mb-xs">{label}</span>
      {children}
    </label>
  );
}

/**
 * Admin-only one-shot reset for users created with `@desfin.local`
 * placeholder emails (i.e. those auto-spawned by the Lead Pulse
 * historical importer). Sets all to a known temp password and lists
 * them so the admin can hand out credentials.
 */
export function ResetPlaceholderPasswordsButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{
    tempPassword: string;
    users: { username: string; email: string }[];
    note?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await fetch("/api/admin/reset-placeholder-passwords", {
      method: "POST",
    });
    setBusy(false);
    setConfirming(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError((data as { error?: string }).error ?? "reset_failed");
      return;
    }
    const data = (await res.json()) as {
      tempPassword: string;
      users: { username: string; email: string }[];
      note?: string;
    };
    setResult(data);
    router.refresh();
  }

  async function copyAll() {
    if (!result || result.users.length === 0) return;
    const text = result.users
      .map((u) => `${u.username}\t${result.tempPassword}\t${u.email}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // navigator.clipboard requires HTTPS in some browsers; fail quietly.
    }
  }

  return (
    <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md space-y-sm">
      <div className="flex items-start gap-md">
        <div className="flex-1 min-w-0">
          <h3 className="text-label-md font-semibold text-on-surface">
            Reset placeholder-user passwords
          </h3>
          <p className="text-label-sm text-on-surface-variant mt-xs">
            Finds users with <code>@desfin.local</code> emails (the
            placeholders the Lead Pulse historical importer auto-created
            for each BDE) and sets them all to a known temporary
            password. The list of usernames + the temp password is shown
            below so you can distribute credentials. Safe to re-run.
          </p>
        </div>
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy}
            className="shrink-0 h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold disabled:opacity-60"
          >
            Reset passwords
          </button>
        ) : (
          <div className="shrink-0 flex items-center gap-xs">
            <button
              type="button"
              onClick={run}
              disabled={busy}
              className="h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold disabled:opacity-60"
            >
              {busy ? "Resetting…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="h-9 px-md rounded-lg border border-outline-variant text-label-sm text-on-surface-variant"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
      {error && (
        <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm text-label-sm">
          {error === "forbidden_admin_only" ? "Admin-only action." : `Failed: ${error}`}
        </div>
      )}
      {result && (
        <div className="rounded-lg border border-outline-variant bg-surface-container-low px-md py-sm text-label-sm space-y-xs">
          {result.note && (
            <p className="text-on-surface-variant">{result.note}</p>
          )}
          {result.users.length > 0 && (
            <>
              <p className="font-semibold text-on-surface">
                Reset complete — {result.users.length} user
                {result.users.length === 1 ? "" : "s"}.
              </p>
              <p className="text-on-surface-variant">
                Temporary password:{" "}
                <code className="px-xs py-[1px] rounded bg-surface-container-high text-on-surface font-mono">
                  {result.tempPassword}
                </code>
                {" "}
                — share this with each BDE.
              </p>
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={copyAll}
                  className="h-7 px-sm rounded text-[11px] font-semibold border border-outline-variant text-on-surface-variant hover:text-on-surface"
                >
                  Copy as TSV
                </button>
              </div>
              <details>
                <summary className="cursor-pointer text-on-surface-variant">
                  Users ({result.users.length})
                </summary>
                <table className="w-full mt-xs text-[11px] font-mono">
                  <thead>
                    <tr className="text-on-surface-variant">
                      <th className="text-left px-xs">Username</th>
                      <th className="text-left px-xs">Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.users.map((u) => (
                      <tr key={u.username}>
                        <td className="px-xs">{u.username}</td>
                        <td className="px-xs text-on-surface-variant">{u.email}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Admin-only one-shot link of placeholder users (the historical-
 * import accounts with `@desfin.local` emails and no roleId) to the
 * Finance Executive Role record. Required after running the
 * Sync-role-pages button — otherwise the new Lead Pulse nav entries
 * never reach those users (their perms fall through to the
 * hardcoded fromLegacyString fallback).
 */
export function LinkPlaceholderRolesButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{
    summary: { linked: number; role: string };
    log: string[];
    note?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await fetch("/api/admin/link-placeholder-roles", { method: "POST" });
    setBusy(false);
    setConfirming(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(
        (data as { message?: string }).message ??
          (data as { error?: string }).error ??
          "link_failed",
      );
      return;
    }
    const data = (await res.json()) as {
      summary: { linked: number; role: string };
      log: string[];
      note?: string;
    };
    setResult(data);
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md space-y-sm">
      <div className="flex items-start gap-md">
        <div className="flex-1 min-w-0">
          <h3 className="text-label-md font-semibold text-on-surface">
            Link placeholder users to the Executive role
          </h3>
          <p className="text-label-sm text-on-surface-variant mt-xs">
            Finds users with <code>@desfin.local</code> emails and no
            <code>roleId</code> (the historical-import placeholders) and
            assigns them the <strong>Finance Executive</strong> role so
            they pick up the role&apos;s page list (Finance + Lead Pulse
            after the Sync-role-pages button has been run). Each user
            must sign out and back in for their session to refresh.
            Safe to re-run.
          </p>
        </div>
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy}
            className="shrink-0 h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold disabled:opacity-60"
          >
            Link role
          </button>
        ) : (
          <div className="shrink-0 flex items-center gap-xs">
            <button
              type="button"
              onClick={run}
              disabled={busy}
              className="h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold disabled:opacity-60"
            >
              {busy ? "Linking…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="h-9 px-md rounded-lg border border-outline-variant text-label-sm text-on-surface-variant"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
      {error && (
        <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm text-label-sm">
          {error === "forbidden_admin_only" ? "Admin-only action." : `Failed: ${error}`}
        </div>
      )}
      {result && (
        <div className="rounded-lg border border-outline-variant bg-surface-container-low px-md py-sm text-label-sm space-y-xs">
          <p className="font-semibold text-on-surface">
            Linked {result.summary.linked} user
            {result.summary.linked === 1 ? "" : "s"} to{" "}
            <span className="font-mono">{result.summary.role}</span>.
          </p>
          {result.note && (
            <p className="text-on-surface-variant">{result.note}</p>
          )}
          {result.log.length > 0 && (
            <details>
              <summary className="cursor-pointer text-on-surface-variant">
                Detail ({result.log.length})
              </summary>
              <ul
                className="mt-xs text-[11px] font-mono text-on-surface-variant max-h-64 overflow-y-auto"
              >
                {result.log.map((l, i) => (
                  <li key={i}>· {l}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
