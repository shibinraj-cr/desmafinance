"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ROLES, type Role } from "@/lib/rbac";

const errorLabels: Record<string, string> = {
  username_taken: "That username is already in use.",
  email_taken: "That email is already in use.",
  validation_failed: "Check the values entered (username 3+ chars, password 8+ chars).",
  forbidden: "Only admins can do that.",
  cannot_delete_self: "You can't delete your own account.",
  cannot_delete_last_admin: "Refusing to delete the only remaining admin.",
  cannot_demote_last_admin: "Refusing to demote the only remaining admin.",
  not_found: "User no longer exists.",
};

export function NewUserButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    role: "executive" as Role,
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock body scroll while the modal is open so the page behind doesn't drift.
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
    setForm({ username: "", email: "", password: "", role: "executive" });
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
      {open && mounted && createPortal(
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
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
                className={inputCls}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r[0].toUpperCase() + r.slice(1)}
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
  role,
  isSelf,
}: {
  userId: string;
  username: string;
  role: string;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function changeRole(next: Role) {
    if (next === role) return;
    if (!confirm(`Change ${username}'s role from ${role} to ${next}?`)) return;
    setBusy(true);
    const res = await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: next }),
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
        value={role}
        onChange={(e) => changeRole(e.target.value as Role)}
        disabled={busy || isSelf}
        title={isSelf ? "Can't change your own role" : "Change role"}
        className="h-8 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-label-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition disabled:opacity-50"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r[0].toUpperCase() + r.slice(1)}
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
