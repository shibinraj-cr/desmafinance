"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteRowButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (!confirm("Delete this transaction? This cannot be undone.")) return;
    setBusy(true);
    const res = await fetch(`/api/transactions/${id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) router.refresh();
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
