"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteRowButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (!confirm("Delete this transaction?")) return;
    setBusy(true);
    const res = await fetch(`/api/finance/transactions/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      alert("Could not delete. Please try again.");
      return;
    }
    // 202 means an executive's delete went into the approval queue
    // rather than removing the row directly. Surface that explicitly so
    // the user knows the row will only disappear once a manager approves.
    if (res.status === 202) {
      alert(
        "Delete submitted for approval. The transaction stays visible until a manager approves the deletion. You'll see it under Approvals → Pending.",
      );
    }
    router.refresh();
  }

  return (
    <button
      onClick={onClick}
      disabled={busy}
      title="Delete"
      className="text-on-surface-variant hover:text-error disabled:opacity-40"
    >
      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete</span>
    </button>
  );
}
