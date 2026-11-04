"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btnPrimary } from "@/components/sales-training/ui";
import { CRM_GUIDE_MODULE_ID } from "@/lib/crm-guide";

export function CreateGuideModuleButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setPending(true);
    setError(null);
    const res = await fetch("/api/hr/sales-training/crm-guide", { method: "POST" }).catch(() => null);
    if (!res?.ok) {
      const body = await res?.json().catch(() => null);
      setError(body?.error ?? "Could not create the module.");
      setPending(false);
      return;
    }
    router.push(`/hr/sales-training/modules/${CRM_GUIDE_MODULE_ID}`);
  }

  return (
    <div className="flex flex-col items-start gap-xs">
      <button className={btnPrimary} disabled={pending} onClick={create}>
        <span className="material-symbols-outlined text-[18px]">add</span>
        {pending ? "Creating…" : "Add as a training module"}
      </button>
      {error && <p className="text-label-sm text-red-700">{error}</p>}
    </div>
  );
}
