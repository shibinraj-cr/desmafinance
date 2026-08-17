"use client";

import { useState } from "react";

type LoginRole = { id: string; name: string };

// Role names that also make the person an active CRM BDE (lead assignment,
// Team Activity dashboard) via a LeadPulseRole row, not just page access.
const BDE_ROLE_TO_LEAD_PULSE_SLUG: Record<string, "l1" | "l2"> = {
  L2: "l2",
  "L1 CRM": "l1",
};

export function CreateLoginPanel({
  employeeId,
  defaultDisplayName,
  defaultPhone,
  roles,
  onDone,
  onCancel,
}: {
  employeeId: string;
  defaultDisplayName: string;
  defaultPhone: string | null;
  roles: LoginRole[];
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [roleId, setRoleId] = useState("");
  const [displayName, setDisplayName] = useState(defaultDisplayName);
  const [phone, setPhone] = useState(defaultPhone ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ username: string; temporaryPassword: string } | null>(null);

  const selectedRole = roles.find((r) => r.id === roleId);
  const leadPulseSlug = selectedRole ? BDE_ROLE_TO_LEAD_PULSE_SLUG[selectedRole.name] : undefined;

  async function create() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/hr/ess-credentials/${employeeId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roleId: roleId || null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Failed to create login");

      if (leadPulseSlug) {
        const lpRes = await fetch("/api/marketing/lead-pulse/roles", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            userId: j.userId,
            role: leadPulseSlug,
            displayName: displayName || defaultDisplayName,
            phone: phone || null,
          }),
        });
        if (!lpRes.ok) {
          const lpj = await lpRes.json().catch(() => ({}));
          throw new Error(
            `Login created (username: ${j.username}), but CRM BDE setup failed: ${
              lpj.error || "unknown error"
            }. Add them manually in CRM → Team, or ask an admin.`,
          );
        }
      }
      setResult({ username: j.username, temporaryPassword: j.temporaryPassword });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create login");
    } finally {
      setPending(false);
    }
  }

  if (result) {
    return (
      <div className="rounded-lg border border-outline-variant bg-surface-container p-md space-y-sm">
        <p className="text-label-sm font-semibold">
          Login created — copy this now, it won&apos;t be shown again:
        </p>
        <div className="flex flex-wrap items-center gap-sm">
          <code className="px-sm py-xs rounded bg-surface text-label-sm">{result.username}</code>
          <code className="px-sm py-xs rounded bg-surface text-label-sm">{result.temporaryPassword}</code>
          <button
            type="button"
            onClick={() =>
              navigator.clipboard.writeText(`${result.username} / ${result.temporaryPassword}`)
            }
            className="px-sm py-xs rounded border border-outline-variant text-label-sm"
          >
            Copy
          </button>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onDone}
            className="px-md py-sm rounded bg-primary text-on-primary font-bold"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-outline-variant bg-surface-container p-md space-y-sm">
      <label className="flex flex-col gap-xs">
        <span className="text-caption text-on-surface-variant">Role</span>
        <select
          className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
          value={roleId}
          onChange={(e) => setRoleId(e.target.value)}
        >
          <option value="">— No role (login only) —</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {leadPulseSlug && (
        <>
          <label className="flex flex-col gap-xs">
            <span className="text-caption text-on-surface-variant">CRM display name</span>
            <input
              className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-xs">
            <span className="text-caption text-on-surface-variant">CRM phone (optional)</span>
            <input
              className="w-full px-sm py-sm rounded border border-outline-variant bg-surface"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <p className="text-caption text-on-surface-variant">
            This role also makes them an active CRM BDE — eligible for lead assignment and shown on
            the Team dashboard.
          </p>
        </>
      )}
      {error && <p className="text-red-700 text-label-sm">{error}</p>}
      <div className="flex justify-end gap-sm">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="px-md py-sm rounded border border-outline-variant"
          >
            Skip
          </button>
        )}
        <button
          type="button"
          onClick={create}
          disabled={pending}
          className="px-md py-sm rounded bg-primary text-on-primary font-bold disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create login"}
        </button>
      </div>
    </div>
  );
}
