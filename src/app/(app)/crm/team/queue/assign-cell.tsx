"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Bde = { userId: string; displayName: string };

/** Inline reassign dropdown for one queue row — same POST as the Leads list's AssignSelect. */
export function QueueAssignCell({
  leadId,
  assigneeId,
  bdes,
}: {
  leadId: string;
  assigneeId: string | null;
  bdes: Bde[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onChange(value: string) {
    setBusy(true);
    const res = await fetch(`/api/crm/leads/${leadId}/assign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assignedToId: value || null }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <select
      disabled={busy}
      value={assigneeId ?? ""}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Reassign lead"
      className="h-8 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-label-sm focus:border-primary outline-none disabled:opacity-50"
    >
      <option value="">Unassigned</option>
      {bdes.map((b) => (
        <option key={b.userId} value={b.userId}>
          {b.displayName}
        </option>
      ))}
    </select>
  );
}
