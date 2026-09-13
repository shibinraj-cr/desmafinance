"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, ErrorNote, Icon, sopApi } from "@/components/sop/ui";

/**
 * Restore an archived SOP.
 *
 * Confirmed rather than one-click: bringing a retired procedure back into the
 * library is exactly as consequential as taking it out, and the published
 * version goes live again the moment it happens.
 */
export function RestoreButton({ sopId, sopNumber }: { sopId: string; sopNumber: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-xs text-label-sm text-accent hover:underline"
      >
        <Icon name="unarchive" size={16} /> Restore
      </button>
      {error && (
        <div className="mt-xs">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {open && (
        <ConfirmDialog
          title={`Restore ${sopNumber}?`}
          confirmLabel="Restore SOP"
          busy={busy}
          message="The SOP returns to the library and its published version goes back into force. Any draft revision that was in progress when it was archived stays archived."
          onCancel={() => setOpen(false)}
          onConfirm={async () => {
            setBusy(true);
            const r = await sopApi(`/api/sop/sops/${sopId}/archive`, "DELETE");
            setBusy(false);
            setOpen(false);
            if (!r.ok) {
              setError(r.error);
              return;
            }
            router.refresh();
          }}
        />
      )}
    </>
  );
}
