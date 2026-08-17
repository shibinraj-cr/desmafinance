"use client";

import { useState } from "react";
import { Section } from "@/components/Cards";

export function ChangePasswordClient() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const ERROR_MESSAGES: Record<string, string> = {
    incorrect_password: "Current password is incorrect.",
    validation_failed: "New password must be at least 8 characters.",
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);

    if (newPassword.length < 8) {
      setErr("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setErr("New password and confirmation don't match.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/me/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(ERROR_MESSAGES[data.error] ?? "Couldn't change password.");
      setOk("Password changed successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't change password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Change password">
      <form onSubmit={submit} className="space-y-base">
        {err && <p className="text-error text-label-sm">{err}</p>}
        {ok && <p className="text-green-700 text-label-sm">{ok}</p>}

        <label className="block space-y-xs">
          <span className="text-label-sm text-on-surface-variant">Current password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
          />
        </label>

        <label className="block space-y-xs">
          <span className="text-label-sm text-on-surface-variant">New password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
            className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
          />
        </label>

        <label className="block space-y-xs">
          <span className="text-label-sm text-on-surface-variant">Confirm new password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="px-md py-sm rounded-lg bg-primary text-on-primary font-semibold disabled:opacity-50"
        >
          {busy ? "Changing…" : "Change password"}
        </button>
      </form>
    </Section>
  );
}
