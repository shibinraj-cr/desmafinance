"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ApprovalActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function act(action: "approve" | "reject") {
    setError(null);
    if (action === "reject" && !note.trim()) {
      setError("Add a short note explaining the rejection.");
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/finance/approvals/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, note: note.trim() || undefined }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error ?? "Failed to record action.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-base">
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note (required when rejecting)…"
        rows={2}
        className="w-full px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md"
      />
      {error && <div className="rounded-lg bg-error-container text-on-error-container px-md py-sm">{error}</div>}
      <div className="flex gap-base">
        <button
          type="button"
          onClick={() => act("approve")}
          disabled={busy}
          className="h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-60"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => act("reject")}
          disabled={busy}
          className="h-10 px-lg rounded-lg border border-error text-error font-semibold hover:bg-error/10 transition disabled:opacity-60"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
